import "server-only";
import { db } from "@/lib/db";
import { getSettingsSection } from "@/lib/settings";
import { ROLE_LABEL } from "@/lib/roles";
import { replayExpiresAt } from "@/lib/access";
import { emailEnabled, sendMail } from "./transport";
import {
  accountDeletedEmail,
  caseStaffReplyEmail,
  eventStartingEmail,
  paymentNeedsReviewEmail,
  paymentRejectedEmail,
  paymentVerifiedEmail,
  replayExpiringEmail,
  teamInviteEmail,
  type RenderedEmail,
  type TemplateContext,
} from "./templates";

/**
 * Email notifications contract. Callers only use `notify(...)`; it never throws (failures are
 * logged to EmailLog) and respects the user's notification preferences and deletedAt.
 *
 * Implementation (templates, SMTP transport, EmailLog writes) is owned by src/lib/email/*.
 */

export type EmailEvent =
  | { kind: "payment.verified"; orderId: string } // ticket issued
  | { kind: "payment.rejected"; paymentId: string } // includes reject reason
  | { kind: "payment.needs_review"; paymentId: string } // slip waiting for staff
  | { kind: "event.starting"; eventId: string } // ~15 min before start, ticket holders
  | { kind: "replay.expiring"; eventId: string } // ~24h before replay expires
  | { kind: "case.staff_reply"; caseId: string }
  | { kind: "team.invite"; inviteId: string } // sent to invite.email (no user yet)
  | { kind: "account.deleted"; email: string }; // sent before anonymising

type Pref = "notifyPayment" | "notifyEvent" | "notifySupport";

const PREF_OF: Record<EmailEvent["kind"], Pref | null> = {
  "payment.verified": "notifyPayment",
  "payment.rejected": "notifyPayment",
  "payment.needs_review": "notifyPayment",
  "event.starting": "notifyEvent",
  "replay.expiring": "notifyEvent",
  "case.staff_reply": "notifySupport",
  "team.invite": null,
  "account.deleted": null,
};

/**
 * EmailLog.template value: "<kind>:<entity id>" (e.g. "event.starting:<eventId>"), used for
 * idempotency of reminders. account.deleted has no id (the address is in EmailLog.to).
 */
export function emailTemplateKey(event: EmailEvent): string {
  switch (event.kind) {
    case "payment.verified":
      return `${event.kind}:${event.orderId}`;
    case "payment.rejected":
    case "payment.needs_review":
      return `${event.kind}:${event.paymentId}`;
    case "event.starting":
    case "replay.expiring":
      return `${event.kind}:${event.eventId}`;
    case "case.staff_reply":
      return `${event.kind}:${event.caseId}`;
    case "team.invite":
      return `${event.kind}:${event.inviteId}`;
    case "account.deleted":
      return event.kind;
  }
}

export async function getTemplateContext(): Promise<TemplateContext> {
  let shop: TemplateContext["shop"];
  try {
    shop = await getSettingsSection("shop");
  } catch (err) {
    console.error("[email] failed to load shop settings, using defaults", err);
    shop = { name: "TERMTEE", supportEmail: null, supportLine: null, supportPhone: null, supportHours: null };
  }
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return { shop, appUrl };
}

/** A resolved message: who gets it and how to render it. */
interface Prepared {
  userId: string | null; // EmailLog.userId + preference owner (null for non-user recipients)
  to: string;
  template: string;
  pref: Pref | null;
  /** Recipient user state (null for non-user recipients). */
  user: { deletedAt: Date | null; notifyPayment: boolean; notifyEvent: boolean; notifySupport: boolean } | null;
  render: (ctx: TemplateContext) => RenderedEmail;
}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  deletedAt: true,
  notifyPayment: true,
  notifyEvent: true,
  notifySupport: true,
} as const;

type RecipientUser = { id: string; email: string; name: string | null } & NonNullable<Prepared["user"]>;

async function loadUser(id: string): Promise<RecipientUser | null> {
  return db.user.findUnique({ where: { id }, select: USER_SELECT });
}

function forUser(user: RecipientUser, event: EmailEvent, render: Prepared["render"]): Prepared {
  return { userId: user.id, to: user.email, template: emailTemplateKey(event), pref: PREF_OF[event.kind], user, render };
}

/** Loads whatever the template needs. Returns null when the target no longer exists. */
async function prepare(userId: string | null, event: EmailEvent): Promise<Prepared | null> {
  switch (event.kind) {
    case "payment.verified": {
      const order = await db.order.findUnique({
        where: { id: event.orderId },
        select: { id: true, userId: true, amountSatang: true, event: { select: { title: true, slug: true, startsAt: true } } },
      });
      if (!order) return null;
      const user = await loadUser(userId ?? order.userId);
      if (!user) return null;
      return forUser(user, event, (ctx) =>
        paymentVerifiedEmail(ctx, {
          name: user.name,
          orderId: order.id,
          eventTitle: order.event.title,
          eventSlug: order.event.slug,
          startsAt: order.event.startsAt,
          amountSatang: order.amountSatang,
        }),
      );
    }
    case "payment.rejected":
    case "payment.needs_review": {
      const payment = await db.payment.findUnique({
        where: { id: event.paymentId },
        select: { rejectReason: true, order: { select: { id: true, userId: true, event: { select: { title: true } } } } },
      });
      if (!payment) return null;
      const user = await loadUser(userId ?? payment.order.userId);
      if (!user) return null;
      const base = { name: user.name, orderId: payment.order.id, eventTitle: payment.order.event.title };
      return forUser(user, event, (ctx) =>
        event.kind === "payment.rejected"
          ? paymentRejectedEmail(ctx, { ...base, reason: payment.rejectReason })
          : paymentNeedsReviewEmail(ctx, base),
      );
    }
    case "event.starting":
    case "replay.expiring": {
      if (!userId) return null;
      const [ev, user] = await Promise.all([
        db.event.findUnique({
          where: { id: event.eventId },
          select: { title: true, slug: true, startsAt: true, endedAt: true, replayDays: true },
        }),
        loadUser(userId),
      ]);
      if (!ev || !user) return null;
      return prepareEventReminder(user, event, ev);
    }
    case "case.staff_reply": {
      const c = await db.supportCase.findUnique({
        where: { id: event.caseId },
        select: {
          id: true,
          number: true,
          subject: true,
          userId: true,
          messages: {
            where: { isStaff: true, internal: false },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { body: true },
          },
        },
      });
      if (!c) return null;
      const user = await loadUser(userId ?? c.userId);
      if (!user) return null;
      return forUser(user, event, (ctx) =>
        caseStaffReplyEmail(ctx, {
          name: user.name,
          caseId: c.id,
          caseNumber: c.number,
          subject: c.subject,
          message: c.messages[0]?.body ?? null,
        }),
      );
    }
    case "team.invite": {
      const invite = await db.teamInvite.findUnique({
        where: { id: event.inviteId },
        select: { email: true, role: true, token: true, expiresAt: true, invitedBy: { select: { name: true } } },
      });
      if (!invite) return null;
      return {
        userId: null,
        to: invite.email,
        template: emailTemplateKey(event),
        pref: null,
        user: null,
        render: (ctx) =>
          teamInviteEmail(ctx, {
            roleLabel: ROLE_LABEL[invite.role],
            inviterName: invite.invitedBy.name,
            token: invite.token,
            expiresAt: invite.expiresAt,
          }),
      };
    }
    case "account.deleted": {
      // Always sent, even though the account is being deleted: no preference / deletedAt check.
      return {
        userId,
        to: event.email,
        template: emailTemplateKey(event),
        pref: null,
        user: null,
        render: (ctx) => accountDeletedEmail(ctx, { email: event.email }),
      };
    }
  }
}

type EventForReminder = { title: string; slug: string; startsAt: Date; endedAt: Date | null; replayDays: number };

function prepareEventReminder(
  user: RecipientUser,
  event: Extract<EmailEvent, { kind: "event.starting" | "replay.expiring" }>,
  ev: EventForReminder,
): Prepared | null {
  if (event.kind === "event.starting") {
    return forUser(user, event, (ctx) =>
      eventStartingEmail(ctx, { name: user.name, eventTitle: ev.title, eventSlug: ev.slug, startsAt: ev.startsAt }),
    );
  }
  const expiresAt = replayExpiresAt(ev.endedAt, ev.replayDays);
  if (!expiresAt) return null;
  return forUser(user, event, (ctx) =>
    replayExpiringEmail(ctx, { name: user.name, eventTitle: ev.title, eventSlug: ev.slug, expiresAt }),
  );
}

async function writeLog(p: Pick<Prepared, "userId" | "to" | "template">, status: "SENT" | "FAILED" | "SKIPPED", error?: string) {
  try {
    await db.emailLog.create({
      data: { userId: p.userId, to: p.to, template: p.template, status, error: error ? error.slice(0, 1000) : null },
    });
  } catch (err) {
    console.error("[email] failed to write EmailLog", { template: p.template, status, err });
  }
}

/** Applies preferences / deletedAt, renders, sends, logs. Never throws. */
async function deliver(p: Prepared, ctx?: TemplateContext): Promise<"SENT" | "FAILED" | "SKIPPED"> {
  if (p.user?.deletedAt) {
    await writeLog(p, "SKIPPED", "user deleted");
    return "SKIPPED";
  }
  if (p.user && p.pref && !p.user[p.pref]) {
    await writeLog(p, "SKIPPED", `opted out (${p.pref})`);
    return "SKIPPED";
  }
  if (!emailEnabled()) {
    console.info(`[email] SMTP_URL not set, skipping ${p.template} to ${p.to}`);
    await writeLog(p, "SKIPPED", "SMTP_URL not configured");
    return "SKIPPED";
  }
  try {
    const mail = p.render(ctx ?? (await getTemplateContext()));
    await sendMail({ to: p.to, ...mail });
    await writeLog(p, "SENT");
    return "SENT";
  } catch (err) {
    console.error(`[email] send failed: ${p.template} to ${p.to}`, err);
    await writeLog(p, "FAILED", err instanceof Error ? err.message : String(err));
    return "FAILED";
  }
}

/** Fire-and-forget safe: resolves even when sending fails. `userId` null for non-user recipients. */
export async function notify(userId: string | null, event: EmailEvent): Promise<void> {
  try {
    const prepared = await prepare(userId, event);
    if (!prepared) {
      console.warn("[email] notify target not found, nothing sent", { userId, kind: event.kind });
      return;
    }
    await deliver(prepared);
  } catch (err) {
    console.error("[email] notify failed", { userId, kind: event.kind, err });
  }
}

/** Internal helpers for broadcast.ts (bulk sends reuse one loaded event + context). */
export const internal = { prepareEventReminder, deliver, getTemplateContext, USER_SELECT };

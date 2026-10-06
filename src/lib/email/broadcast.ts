import "server-only";
import { db } from "@/lib/db";
import { emailTemplateKey, internal, type EmailEvent } from "./index";

export type BroadcastKind = "event.starting" | "replay.expiring";

export interface BroadcastResult {
  eventId: string;
  kind: BroadcastKind;
  holders: number;
  alreadySent: number;
  sent: number;
  skipped: number;
  failed: number;
}

const CONCURRENCY = 4;

/**
 * Sends `kind` to every non-revoked ticket holder of the event, once per user: users with a
 * SENT or SKIPPED EmailLog for "<kind>:<eventId>" are not sent again (FAILED ones are retried
 * on the next run). Never throws.
 */
export async function notifyTicketHolders(eventId: string, kind: BroadcastKind): Promise<BroadcastResult> {
  const result: BroadcastResult = { eventId, kind, holders: 0, alreadySent: 0, sent: 0, skipped: 0, failed: 0 };
  try {
    const ev = await db.event.findUnique({
      where: { id: eventId },
      select: { title: true, slug: true, startsAt: true, endedAt: true, replayDays: true },
    });
    if (!ev) return result;

    const event = { kind, eventId } as Extract<EmailEvent, { kind: BroadcastKind }>;
    const template = emailTemplateKey(event);

    const tickets = await db.ticket.findMany({
      where: { eventId, revoked: false, user: { deletedAt: null } },
      select: { user: { select: internal.USER_SELECT } },
    });
    result.holders = tickets.length;

    const done = await db.emailLog.findMany({
      where: { template, status: { in: ["SENT", "SKIPPED"] }, userId: { in: tickets.map((t) => t.user.id) } },
      select: { userId: true },
    });
    const doneIds = new Set(done.map((d) => d.userId));
    const pending = tickets.map((t) => t.user).filter((u) => !doneIds.has(u.id));
    result.alreadySent = tickets.length - pending.length;
    if (!pending.length) return result;

    const ctx = await internal.getTemplateContext();
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      const statuses = await Promise.all(
        batch.map(async (user) => {
          const prepared = internal.prepareEventReminder(user, event, ev);
          return prepared ? internal.deliver(prepared, ctx) : ("SKIPPED" as const);
        }),
      );
      for (const s of statuses) {
        if (s === "SENT") result.sent++;
        else if (s === "FAILED") result.failed++;
        else result.skipped++;
      }
    }
  } catch (err) {
    console.error("[email] notifyTicketHolders failed", { eventId, kind, err });
  }
  return result;
}

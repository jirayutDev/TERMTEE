import type { RenderedEmail, TemplateContext } from "./layout";
import { paymentNeedsReviewEmail, paymentRejectedEmail, paymentVerifiedEmail } from "./payment";
import { eventStartingEmail, replayExpiringEmail } from "./event";
import { caseStaffReplyEmail } from "./support";
import { accountDeletedEmail, teamInviteEmail } from "./account";

export * from "./layout";
export * from "./payment";
export * from "./event";
export * from "./support";
export * from "./account";

/** Sample renders for /api/dev/email-preview, keyed by EmailEvent kind. */
export const SAMPLE_TEMPLATES: Record<string, (ctx: TemplateContext) => RenderedEmail> = {
  "payment.verified": (ctx) =>
    paymentVerifiedEmail(ctx, {
      name: "สมชาย",
      orderId: "cmabc123sample0order01",
      eventTitle: "คอนเสิร์ตตัวอย่าง Live 2026",
      eventSlug: "sample-live-2026",
      startsAt: new Date(Date.now() + 3 * 24 * 3600_000),
      amountSatang: 49900,
    }),
  "payment.rejected": (ctx) =>
    paymentRejectedEmail(ctx, {
      name: "สมชาย",
      orderId: "cmabc123sample0order01",
      eventTitle: "คอนเสิร์ตตัวอย่าง Live 2026",
      reason: "ยอดเงินในสลิปไม่ตรงกับคำสั่งซื้อ",
    }),
  "payment.needs_review": (ctx) =>
    paymentNeedsReviewEmail(ctx, {
      name: "สมชาย",
      orderId: "cmabc123sample0order01",
      eventTitle: "คอนเสิร์ตตัวอย่าง Live 2026",
    }),
  "event.starting": (ctx) =>
    eventStartingEmail(ctx, {
      name: "สมชาย",
      eventTitle: "คอนเสิร์ตตัวอย่าง Live 2026",
      eventSlug: "sample-live-2026",
      startsAt: new Date(Date.now() + 20 * 60_000),
    }),
  "replay.expiring": (ctx) =>
    replayExpiringEmail(ctx, {
      name: "สมชาย",
      eventTitle: "คอนเสิร์ตตัวอย่าง Live 2026",
      eventSlug: "sample-live-2026",
      expiresAt: new Date(Date.now() + 20 * 3600_000),
    }),
  "case.staff_reply": (ctx) =>
    caseStaffReplyEmail(ctx, {
      name: "สมชาย",
      caseId: "cmcase0sample000000001",
      caseNumber: 1024,
      subject: "ดูไลฟ์แล้วภาพค้าง",
      message: "สวัสดีครับ ลองล้างแคชเบราว์เซอร์แล้วเข้าใหม่อีกครั้ง หากยังมีปัญหาแจ้งรุ่นอุปกรณ์มาได้เลยครับ",
    }),
  "team.invite": (ctx) =>
    teamInviteEmail(ctx, {
      roleLabel: "การเงิน",
      inviterName: "แอดมิน",
      token: "sample-invite-token",
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    }),
  "account.deleted": (ctx) => accountDeletedEmail(ctx, { email: "somchai@example.com" }),
};

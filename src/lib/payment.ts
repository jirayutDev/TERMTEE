import "server-only";
import QRCode from "qrcode";
import generatePayload from "promptpay-qr";
import { db } from "@/lib/db";
import type { PaymentStatus, Prisma } from "@/generated/prisma/client";
import type { SlipCheckResult } from "@/lib/slip/types";

type Tx = Prisma.TransactionClient;

export type FulfilResult = "fulfilled" | "already_paid" | "not_found" | "not_payable";

/**
 * Marks an order PAID and issues (or reactivates) its ticket. Must run inside a transaction.
 * The conditional status update acts as an optimistic lock against concurrent approvals.
 */
export async function fulfilOrder(tx: Tx, orderId: string): Promise<FulfilResult> {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) return "not_found";
  if (order.status === "PAID") return "already_paid";
  if (order.status === "REFUNDED") return "not_payable";

  const updated = await tx.order.updateMany({
    where: { id: orderId, status: { in: ["PENDING", "CANCELLED"] } },
    data: { status: "PAID", paidAt: new Date() },
  });
  if (updated.count === 0) return "already_paid";

  // One ticket per user+event (@@unique([userId, eventId])). A revoked ticket
  // (earlier rejected/refunded payment) is re-issued against this order.
  const existing = await tx.ticket.findUnique({
    where: { userId_eventId: { userId: order.userId, eventId: order.eventId } },
  });
  if (!existing) {
    await tx.ticket.create({ data: { userId: order.userId, eventId: order.eventId, orderId } });
  } else if (existing.orderId === orderId || existing.revoked) {
    await tx.ticket.update({ where: { id: existing.id }, data: { orderId, revoked: false } });
  } else {
    // Paid twice for the same event (two orders). Keep the original ticket; refund manually.
    console.warn("[payment] duplicate paid order, refund manually", { orderId, ticketId: existing.id });
  }
  return "fulfilled";
}

/**
 * Reverses a fulfilment (admin rejected a slip that was VERIFIED): revoke the ticket,
 * put the order back to PENDING so the user can upload again, and kick playback.
 */
export async function unfulfilOrder(tx: Tx, orderId: string): Promise<void> {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== "PAID") return;
  await tx.order.update({ where: { id: orderId }, data: { status: "PENDING", paidAt: null } });
  await tx.ticket.updateMany({ where: { orderId }, data: { revoked: true } });
  await tx.viewSession.deleteMany({ where: { userId: order.userId, eventId: order.eventId } });
}

/** Payment.checks is stored as Json; parse defensively. */
export function parseChecks(json: unknown): SlipCheckResult[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (c): c is SlipCheckResult =>
      !!c && typeof c === "object" && typeof c.name === "string" && typeof c.result === "string",
  );
}

/** Only failed checks are shown to customers (never reveal what we could not read). */
export function customerChecks(json: unknown): { name: string; detail: string }[] {
  return parseChecks(json)
    .filter((c) => c.result === "fail")
    .map(({ name, detail }) => ({ name, detail }));
}

export type PublicPayment = {
  id: string;
  status: PaymentStatus;
  rejectReason: string | null;
  checks: { name: string; detail: string }[];
  createdAt: string;
};

export function toPublicPayment(p: {
  id: string;
  status: PaymentStatus;
  rejectReason: string | null;
  checks: unknown;
  createdAt: Date;
}): PublicPayment {
  return {
    id: p.id,
    status: p.status,
    rejectReason: p.status === "REJECTED" ? p.rejectReason : null,
    checks: customerChecks(p.checks),
    createdAt: p.createdAt.toISOString(),
  };
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PROCESSING: "กำลังตรวจสอบ",
  VERIFIED: "ยืนยันแล้ว",
  NEEDS_REVIEW: "รอเจ้าหน้าที่ตรวจสอบ",
  REJECTED: "ไม่ผ่าน",
};

export const PAYMENT_STATUS_STYLE: Record<PaymentStatus, string> = {
  PROCESSING: "badge-soon",
  VERIFIED: "badge-success",
  NEEDS_REVIEW: "badge-warning",
  REJECTED: "badge-danger",
};

/** Max slip uploads per user in RATE_WINDOW_MS. */
export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 10 * 60 * 1000;

export async function recentUploadCount(userId: string): Promise<number> {
  return db.payment.count({
    where: { order: { userId }, createdAt: { gt: new Date(Date.now() - RATE_WINDOW_MS) } },
  });
}

/**
 * PromptPay QR for an exact amount, as an SVG data URL. Null when no PromptPay id is configured.
 * Pass `settings.payment.promptPayId` (see src/lib/settings.ts).
 */
export async function promptPayQrDataUrl(amountSatang: number, promptPayId: string | null): Promise<string | null> {
  const id = promptPayId?.replace(/[^0-9]/g, "");
  if (!id) return null;
  const payload = generatePayload(id, { amount: amountSatang / 100 });
  const svg = await QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

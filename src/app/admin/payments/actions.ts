"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/roles";
import { db } from "@/lib/db";
import { fulfilOrder, unfulfilOrder } from "@/lib/payment";
import { after } from "next/server";
import { notify } from "@/lib/email";

async function requireAdminId(): Promise<string> {
  const user = await requirePermission("payments", "/admin/payments");
  return user.id;
}

function refresh(orderId: string) {
  revalidatePath("/admin", "layout");
  revalidatePath(`/pay/${orderId}`);
  revalidatePath("/library");
}

/** Admin approves a slip: payment VERIFIED, order PAID, ticket issued/reactivated. */
export async function approvePaymentAction(paymentId: string) {
  const adminId = await requireAdminId();
  const { orderId, wasVerified } = await db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("Payment not found");
    const res = await fulfilOrder(tx, payment.orderId);
    if (res === "not_found" || res === "not_payable") {
      throw new Error(`ไม่สามารถอนุมัติได้: คำสั่งซื้ออยู่ในสถานะที่ชำระไม่ได้ (${res})`);
    }
    if (res === "already_paid" && payment.status !== "VERIFIED") {
      // Order already paid by another slip: this would be a second payment.
      console.warn("[admin] approving a slip for an order that is already paid", { paymentId });
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "VERIFIED",
        verifiedBy: `admin:${adminId}`,
        reviewedAt: new Date(),
        rejectReason: null,
      },
    });
    return { orderId: payment.orderId, wasVerified: payment.status === "VERIFIED" };
  });
  refresh(orderId);
  // Email after the response; recipient is the order owner (userId null -> derived).
  if (!wasVerified) after(() => notify(null, { kind: "payment.verified", orderId }));
}

/**
 * Admin rejects a slip. If it had been VERIFIED (spot-checked fake), the ticket is revoked,
 * the order goes back to PENDING so the user can upload a real slip, and playback is kicked.
 */
export async function rejectPaymentAction(paymentId: string, formData: FormData) {
  const adminId = await requireAdminId();
  const raw = formData.get("reason");
  const reason = (typeof raw === "string" ? raw.trim().slice(0, 500) : "") || "เจ้าหน้าที่ตรวจสอบแล้วสลิปไม่ถูกต้อง";

  const orderId = await db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("Payment not found");
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: "REJECTED", rejectReason: reason, verifiedBy: `admin:${adminId}`, reviewedAt: new Date() },
    });
    if (payment.status === "VERIFIED") {
      const otherVerified = await tx.payment.count({
        where: { orderId: payment.orderId, status: "VERIFIED", id: { not: paymentId } },
      });
      if (otherVerified === 0) await unfulfilOrder(tx, payment.orderId);
    }
    return payment.orderId;
  });
  refresh(orderId);
  after(() => notify(null, { kind: "payment.rejected", paymentId }));
}

import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import {
  evaluateSlip,
  expectedForOrder,
  getSlipProvider,
  readSlip,
  sha256Hex,
  validateSlipFile,
} from "@/lib/slip";
import type { SlipCheckResult, SlipData, SlipEvaluation } from "@/lib/slip/types";
import { getSlipStorage, slipKey, sniffImage } from "@/lib/slip-storage";
import { RATE_LIMIT, customerChecks, fulfilOrder, recentUploadCount } from "@/lib/payment";
import { after } from "next/server";
import { notify } from "@/lib/email";

// QR decoding + OCR need Node APIs (sharp, tesseract.js) and can take 5–15 s.
export const runtime = "nodejs";
export const maxDuration = 60;

/** A PROCESSING payment older than this is considered crashed and no longer blocks re-upload. */
const STALE_PROCESSING_MS = 2 * 60 * 1000;

function error(code: string, message: string, status: number) {
  return Response.json({ error: code, message }, { status });
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user?.id) return error("unauthorized", "กรุณาเข้าสู่ระบบ", 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error("invalid_body", "ข้อมูลที่ส่งมาไม่ถูกต้อง", 400);
  }
  const orderId = form.get("orderId");
  const slip = form.get("slip");
  if (typeof orderId !== "string" || !orderId) return error("invalid_order", "ไม่พบคำสั่งซื้อ", 400);
  if (!(slip instanceof File)) return error("invalid_file", "กรุณาเลือกไฟล์สลิป", 400);

  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || order.userId !== user.id) return error("order_not_found", "ไม่พบคำสั่งซื้อ", 404);
  if (order.status === "PAID") return error("already_paid", "คำสั่งซื้อนี้ชำระเงินแล้ว", 409);
  if (order.status !== "PENDING") return error("order_closed", "คำสั่งซื้อนี้ถูกยกเลิกแล้ว", 409);

  const blocking = await db.payment.findFirst({
    where: {
      orderId,
      OR: [
        { status: "NEEDS_REVIEW" },
        { status: "PROCESSING", createdAt: { gt: new Date(Date.now() - STALE_PROCESSING_MS) } },
      ],
    },
    select: { status: true },
  });
  if (blocking) {
    return blocking.status === "NEEDS_REVIEW"
      ? error("awaiting_review", "มีสลิปที่รอเจ้าหน้าที่ตรวจสอบอยู่ กรุณารอผลก่อนอัปโหลดใหม่", 409)
      : error("in_progress", "กำลังตรวจสอบสลิปก่อนหน้า กรุณารอสักครู่", 409);
  }

  if ((await recentUploadCount(user.id)) >= RATE_LIMIT) {
    return error("rate_limited", "อัปโหลดสลิปบ่อยเกินไป กรุณารอ 10 นาทีแล้วลองใหม่", 429);
  }

  let image: Buffer;
  try {
    image = await validateSlipFile(slip);
  } catch (err) {
    return error("invalid_file", (err as Error).message || "ไฟล์สลิปไม่ถูกต้อง", 400);
  }

  const slipHash = sha256Hex(image);
  const duplicateMsg = "สลิปนี้ถูกใช้ไปแล้ว";
  if (await db.payment.findUnique({ where: { slipHash }, select: { id: true } })) {
    return error("duplicate", duplicateMsg, 409);
  }

  const key = slipKey(slipHash, image);
  await getSlipStorage().put(key, image, sniffImage(image).contentType);

  let paymentId: string;
  try {
    const created = await db.payment.create({
      data: { orderId, slipHash, slipPath: key, status: "PROCESSING", checks: [] },
    });
    paymentId = created.id;
  } catch (err) {
    if (isUniqueViolation(err)) return error("duplicate", duplicateMsg, 409);
    throw err;
  }

  // ---- Read + decide ----
  let data: SlipData | null = null;
  let evaluation: SlipEvaluation;
  let verifiedBy: string | null = null;
  let duplicateRef = false;

  try {
    let slip: SlipData = await readSlip(image);
    data = slip;
    const expected = await expectedForOrder({ amountSatang: order.amountSatang, createdAt: order.createdAt });
    const isDuplicateRef = async (ref: string | null) =>
      !!ref &&
      !!(await db.payment.findFirst({ where: { transRef: ref, id: { not: paymentId } }, select: { id: true } }));

    const provider = getSlipProvider();
    let providerCheck: SlipCheckResult | null = null;
    let providerName: string | null = null;

    if (provider) {
      try {
        const res = await provider.verify({ image, qrPayload: slip.qrPayload });
        if (res.ok) {
          // Bank-confirmed data replaces what we read from the image.
          slip = {
            ...slip,
            transRef: res.transRef,
            amountSatang: res.amountSatang,
            transferredAt: res.transferredAt,
            receiverAccount: res.receiverAccount ?? slip.receiverAccount,
            receiverName: res.receiverName ?? slip.receiverName,
          };
          data = slip;
          providerName = res.via ?? provider.name;
          providerCheck = { name: "provider", result: "pass", detail: `ยืนยันกับธนาคารผ่าน ${providerName} แล้ว` };
        } else {
          providerCheck = { name: "provider", result: "fail", detail: res.reason };
        }
      } catch (err) {
        console.error("[payment] slip provider failed, falling back to local checks", err);
        providerCheck = { name: "provider", result: "unknown", detail: "เรียกระบบตรวจสลิปกับธนาคารไม่สำเร็จ ใช้การตรวจภายในแทน" };
      }
    }

    duplicateRef = await isDuplicateRef(slip.transRef);
    const local: SlipEvaluation = evaluateSlip(slip, expected, { duplicateTransRef: duplicateRef });
    const checks = [...local.checks.filter((c: SlipCheckResult) => c.name !== "provider"), ...(providerCheck ? [providerCheck] : [])];

    if (duplicateRef && local.decision !== "REJECTED") {
      // Defensive: a reused transaction reference must never pass.
      evaluation = { decision: "REJECTED", checks, rejectReason: duplicateMsg };
    } else if (providerCheck?.result === "fail") {
      evaluation = { decision: "REJECTED", checks, rejectReason: providerCheck.detail || "ธนาคารไม่ยืนยันรายการโอนนี้" };
    } else {
      evaluation = { ...local, checks };
      if (local.decision === "VERIFIED") verifiedBy = providerCheck?.result === "pass" ? `provider:${providerName}` : "auto";
    }
  } catch (err) {
    console.error("[payment] slip read failed", { paymentId, err });
    evaluation = {
      decision: "NEEDS_REVIEW",
      checks: [{ name: "qr", result: "unknown", detail: "อ่านสลิปอัตโนมัติไม่สำเร็จ" }],
      rejectReason: null,
    };
  }

  const fields = {
    sendingBank: data?.sendingBank ?? null,
    amountSatang: data?.amountSatang ?? null,
    transferredAt: data?.transferredAt ?? null,
    receiverName: data?.receiverName ?? null,
    receiverAccount: data?.receiverAccount ?? null,
    qrPayload: data?.qrPayload ?? null,
    ocrText: data?.ocrText ?? null,
    checks: evaluation.checks as unknown as Prisma.InputJsonValue,
    rejectReason: evaluation.decision === "REJECTED" ? evaluation.rejectReason : null,
  };

  try {
    await db.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          ...fields,
          // A duplicate transRef cannot be stored (unique); it is reflected in checks instead.
          transRef: duplicateRef ? null : (data?.transRef ?? null),
          status: evaluation.decision,
          verifiedBy,
          reviewedAt: evaluation.decision === "VERIFIED" ? new Date() : null,
        },
      });
      if (evaluation.decision === "VERIFIED") {
        const res = await fulfilOrder(tx, orderId);
        if (res !== "fulfilled") throw new Error(`fulfil failed: ${res}`);
      }
    });
  } catch (err) {
    // Lost a race on transRef (same slip uploaded twice concurrently as different files),
    // or the order was paid/cancelled meanwhile: record as needs-review / duplicate.
    const dup = isUniqueViolation(err);
    if (!dup) console.error("[payment] finalize failed", { paymentId, err });
    evaluation = dup
      ? {
          decision: "REJECTED",
          checks: [...evaluation.checks, { name: "duplicate", result: "fail", detail: duplicateMsg }],
          rejectReason: duplicateMsg,
        }
      : { ...evaluation, decision: "NEEDS_REVIEW", rejectReason: null };
    await db.payment.update({
      where: { id: paymentId },
      data: {
        ...fields,
        checks: evaluation.checks as unknown as Prisma.InputJsonValue,
        rejectReason: evaluation.rejectReason,
        transRef: null,
        status: evaluation.decision,
        verifiedBy: null,
      },
    });
  }

  // Email the outcome after the response is sent (decision is committed above).
  const decision = evaluation.decision;
  const userId = user.id;
  after(() =>
    notify(
      userId,
      decision === "VERIFIED"
        ? { kind: "payment.verified", orderId }
        : decision === "REJECTED"
          ? { kind: "payment.rejected", paymentId }
          : { kind: "payment.needs_review", paymentId },
    ),
  );

  return Response.json({
    paymentId,
    status: evaluation.decision,
    rejectReason: evaluation.decision === "REJECTED" ? evaluation.rejectReason : null,
    checks: customerChecks(evaluation.checks),
  });
}

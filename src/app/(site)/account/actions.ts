"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { emailTemplateKey, notify } from "@/lib/email";
import {
  HEAD_OFFICE_BRANCH,
  deleteConfirmMatches,
  digitsOnly,
  isThaiBankCode,
  isValidBankAccountNo,
  isValidThaiTaxId,
  normalizeThaiPhone,
} from "@/lib/account";
import { SESSION_COOKIES, currentSessionToken, sessionRef } from "@/lib/sessions";

async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

// ---------- Profile / billing / refund / notifications (one form, one save bar) ----------

export type SettingsFormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  /** Submitted values, to re-seed the form after a validation error. */
  values?: Record<string, string>;
  /** Changes on every response so the client can remount / show a toast. */
  at?: number;
};

const str = (max: number) => z.string().trim().max(max, `ยาวได้ไม่เกิน ${max} ตัวอักษร`);

const settingsSchema = z
  .object({
    name: str(80).min(1, "กรุณากรอกชื่อที่แสดง"),
    phone: z
      .string()
      .trim()
      .transform((v, ctx) => {
        if (!v) return null;
        const n = normalizeThaiPhone(v);
        if (!n) {
          ctx.addIssue({ code: "custom", message: "เบอร์โทรไม่ถูกต้อง (เช่น 081-234-5678 หรือ 02-123-4567)" });
          return z.NEVER;
        }
        return n;
      }),

    billingType: z.enum(["PERSON", "COMPANY"], "กรุณาเลือกประเภท"),
    billingName: str(200),
    billingTaxId: z.string().transform(digitsOnly),
    billingBranch: z.string().transform(digitsOnly),
    billingAddress: str(500),

    refundBankCode: z.string().trim(),
    refundAccountNo: z.string().transform(digitsOnly),
    refundAccountName: str(120),

    notifyPayment: z.boolean(),
    notifyEvent: z.boolean(),
    notifySupport: z.boolean(),
  })
  .superRefine((v, ctx) => {
    // Billing: all-or-nothing (leave everything blank to skip tax invoices).
    const billingUsed = !!(v.billingName || v.billingTaxId || v.billingAddress);
    if (billingUsed) {
      if (!v.billingName)
        ctx.addIssue({
          code: "custom",
          path: ["billingName"],
          message: v.billingType === "COMPANY" ? "กรุณากรอกชื่อบริษัท" : "กรุณากรอกชื่อ-นามสกุล",
        });
      if (!v.billingTaxId) ctx.addIssue({ code: "custom", path: ["billingTaxId"], message: "กรุณากรอกเลขประจำตัวผู้เสียภาษี" });
      else if (!/^\d{13}$/.test(v.billingTaxId))
        ctx.addIssue({ code: "custom", path: ["billingTaxId"], message: "เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก" });
      else if (!isValidThaiTaxId(v.billingTaxId))
        ctx.addIssue({ code: "custom", path: ["billingTaxId"], message: "เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (หลักตรวจสอบไม่ตรง)" });
      if (v.billingType === "COMPANY" && !/^\d{5}$/.test(v.billingBranch))
        ctx.addIssue({
          code: "custom",
          path: ["billingBranch"],
          message: "รหัสสาขาต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)",
        });
      if (!v.billingAddress) ctx.addIssue({ code: "custom", path: ["billingAddress"], message: "กรุณากรอกที่อยู่" });
    }

    // Refund account: all-or-nothing.
    const refundUsed = !!(v.refundBankCode || v.refundAccountNo || v.refundAccountName);
    if (refundUsed) {
      if (!v.refundBankCode || !isThaiBankCode(v.refundBankCode))
        ctx.addIssue({ code: "custom", path: ["refundBankCode"], message: "กรุณาเลือกธนาคาร" });
      if (!v.refundAccountNo) ctx.addIssue({ code: "custom", path: ["refundAccountNo"], message: "กรุณากรอกเลขบัญชี" });
      else if (!isValidBankAccountNo(v.refundAccountNo))
        ctx.addIssue({ code: "custom", path: ["refundAccountNo"], message: "เลขบัญชีต้องเป็นตัวเลข 10–15 หลัก" });
      if (!v.refundAccountName) ctx.addIssue({ code: "custom", path: ["refundAccountName"], message: "กรุณากรอกชื่อบัญชี" });
    }
  });

function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  return out;
}

export async function saveSettingsAction(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const user = await requireUser();
  const s = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : "";
  };

  const parsed = settingsSchema.safeParse({
    name: s("name"),
    phone: s("phone"),
    billingType: s("billingType") || "PERSON",
    billingName: s("billingName"),
    billingTaxId: s("billingTaxId"),
    billingBranch: s("billingBranch"),
    billingAddress: s("billingAddress"),
    refundBankCode: s("refundBankCode"),
    refundAccountNo: s("refundAccountNo"),
    refundAccountName: s("refundAccountName"),
    notifyPayment: formData.get("notifyPayment") === "on",
    notifyEvent: formData.get("notifyEvent") === "on",
    notifySupport: formData.get("notifySupport") === "on",
  });
  if (!parsed.success) {
    return {
      error: "กรุณาตรวจสอบข้อมูลที่ไฮไลต์",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values: formValues(formData),
      at: Date.now(),
    };
  }

  const v = parsed.data;
  const billingUsed = !!(v.billingName || v.billingTaxId || v.billingAddress);
  const refundUsed = !!(v.refundBankCode || v.refundAccountNo || v.refundAccountName);

  // Scoped to the signed-in user only; deleted users have no session so cannot reach this.
  await db.user.update({
    where: { id: user.id },
    data: {
      name: v.name,
      phone: v.phone,
      billingType: billingUsed ? v.billingType : null,
      billingName: billingUsed ? v.billingName : null,
      billingTaxId: billingUsed ? v.billingTaxId : null,
      billingBranch: billingUsed ? (v.billingType === "COMPANY" ? v.billingBranch || HEAD_OFFICE_BRANCH : null) : null,
      billingAddress: billingUsed ? v.billingAddress : null,
      refundBankCode: refundUsed ? v.refundBankCode : null,
      refundAccountNo: refundUsed ? v.refundAccountNo : null,
      refundAccountName: refundUsed ? v.refundAccountName : null,
      notifyPayment: v.notifyPayment,
      notifyEvent: v.notifyEvent,
      notifySupport: v.notifySupport,
    },
  });

  revalidatePath("/account");
  revalidatePath("/", "layout"); // header shows the display name
  return { ok: true, at: Date.now() };
}

// ---------- Devices (Auth.js Session rows) ----------

export type DeviceActionResult = { ok: boolean; message: string };

/** Sign out one other device, identified by sessionRef() (the raw token never leaves the server). */
export async function signOutDeviceAction(ref: string): Promise<DeviceActionResult> {
  const user = await requireUser();
  const parsed = z.string().regex(/^[0-9a-f]{24}$/).safeParse(ref);
  if (!parsed.success) return { ok: false, message: "ไม่พบเครื่องนี้" };

  const current = await currentSessionToken();
  const sessions = await db.session.findMany({ where: { userId: user.id }, select: { sessionToken: true } });
  const target = sessions.find((s) => sessionRef(s.sessionToken) === parsed.data);
  if (!target) return { ok: false, message: "เครื่องนี้ออกจากระบบไปแล้ว" };
  if (target.sessionToken === current) return { ok: false, message: "ใช้เมนูออกจากระบบเพื่อออกจากเครื่องนี้" };

  await db.session.deleteMany({ where: { userId: user.id, sessionToken: target.sessionToken } });
  revalidatePath("/account");
  return { ok: true, message: "ออกจากระบบเครื่องนั้นแล้ว" };
}

export async function signOutOtherDevicesAction(): Promise<DeviceActionResult> {
  const user = await requireUser();
  const current = await currentSessionToken();
  if (!current) return { ok: false, message: "ไม่พบ session ปัจจุบัน" };

  const { count } = await db.session.deleteMany({ where: { userId: user.id, sessionToken: { not: current } } });
  revalidatePath("/account");
  return {
    ok: true,
    message: count > 0 ? `ออกจากระบบเครื่องอื่นแล้ว ${count.toLocaleString("th-TH")} เครื่อง` : "ไม่มีเครื่องอื่นที่ login อยู่",
  };
}

// ---------- Delete account ----------

export type DeleteAccountState = { error?: string };

/**
 * Anonymise the account. Orders/Payments are kept for accounting; tickets are revoked; the Google
 * link (Account rows) and all sessions are deleted, so signing in again with the same Google
 * account creates a brand-new, empty user (the old email is freed by the anonymised address).
 */
export async function deleteAccountAction(_prev: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  const user = await requireUser();
  const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { email: true, deletedAt: true } });
  if (!dbUser || dbUser.deletedAt) return { error: "ไม่พบบัญชี" };

  const confirm = formData.get("confirm");
  if (typeof confirm !== "string" || !deleteConfirmMatches(confirm, dbUser.email)) {
    return { error: "email ที่พิมพ์ไม่ตรงกับบัญชีนี้" };
  }

  const reviewing = await db.payment.count({
    where: { status: { in: ["PROCESSING", "NEEDS_REVIEW"] }, order: { userId: user.id } },
  });
  if (reviewing > 0) {
    return { error: "มีสลิปที่กำลังรอตรวจ กรุณารอให้ตรวจเสร็จก่อนลบบัญชี" };
  }

  // Send the goodbye email while we still know the address (never throws).
  const goodbye = { kind: "account.deleted", email: dbUser.email } as const;
  await notify(null, goodbye);

  const now = new Date();
  const anonEmail = `deleted-${user.id}@deleted.invalid`;
  await db.$transaction([
    // PDPA: scrub the address from the email log too (the goodbye email row has userId null).
    db.emailLog.updateMany({ where: { userId: user.id }, data: { to: anonEmail } }),
    db.emailLog.updateMany({ where: { template: emailTemplateKey(goodbye), to: dbUser.email }, data: { to: anonEmail } }),
    db.user.update({
      where: { id: user.id },
      data: {
        name: null,
        email: anonEmail,
        emailVerified: null,
        image: null,
        phone: null,
        billingType: null,
        billingName: null,
        billingTaxId: null,
        billingBranch: null,
        billingAddress: null,
        refundBankCode: null,
        refundAccountNo: null,
        refundAccountName: null,
        notifyPayment: false,
        notifyEvent: false,
        notifySupport: false,
        role: "VIEWER",
        deletedAt: now,
      },
    }),
    db.account.deleteMany({ where: { userId: user.id } }),
    db.session.deleteMany({ where: { userId: user.id } }),
    db.viewSession.deleteMany({ where: { userId: user.id } }),
    db.ticket.updateMany({ where: { userId: user.id, revoked: false }, data: { revoked: true } }),
    // Unpaid orders can never be completed now (no slip under review, checked above).
    db.order.updateMany({ where: { userId: user.id, status: "PENDING" }, data: { status: "CANCELLED" } }),
  ]);

  // The Session rows are gone, so Auth.js signOut() would fail deleting it; just drop the cookie.
  const store = await cookies();
  for (const name of SESSION_COOKIES) {
    // __Secure- cookies can only be overwritten with the Secure attribute set.
    if (store.has(name)) store.set(name, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: name.startsWith("__Secure-") });
  }

  revalidatePath("/", "layout");
  redirect("/");
}

import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUploadStorage, UploadError, validateImageUpload } from "@/lib/uploads";
import type { CaseCategory, CasePriority, CaseStatus } from "@/generated/prisma/client";

/** Customer-facing case number, e.g. "TT-C1042". */
export function caseRef(n: number): string {
  return `TT-C${n}`;
}

export const MAX_ATTACHMENTS = 3;
export const MAX_NEW_CASES_PER_DAY = 5;
export const MAX_BODY_CHARS = 5000;
export const MAX_SUBJECT_CHARS = 140;

export const CATEGORY_LABEL: Record<CaseCategory, string> = {
  PLAYBACK: "ดูไม่ได้ / ภาพมีปัญหา",
  DEVICE: "อุปกรณ์ / เครื่องไม่รองรับ",
  PAYMENT: "ชำระเงิน / สลิป",
  REFUND: "ขอคืนเงิน",
  ACCOUNT: "บัญชี / login",
  OTHER: "อื่นๆ",
};

export const CATEGORY_HINT: Record<CaseCategory, { sub: string; example: string }> = {
  PLAYBACK: { sub: "จอดำ กระตุก ไม่มีเสียง", example: "เช่น ดูบน Mac แล้วจอดำแต่มีเสียง" },
  DEVICE: { sub: "เครื่อง/browser ไม่รองรับ", example: "เช่น ขึ้นว่าเครื่องนี้ไม่รองรับ" },
  PAYMENT: { sub: "โอนแล้วตั๋วไม่ขึ้น สลิปไม่ผ่าน", example: "เช่น โอนแล้วแต่ตั๋วยังไม่ขึ้น" },
  REFUND: { sub: "event ยกเลิก โอนผิดยอด", example: "เช่น โอนเกิน ขอคืนส่วนต่าง" },
  ACCOUNT: { sub: "เข้าไม่ได้ ถูกนำออก", example: "เช่น ถูกนำออกจากการดูโดยไม่ทราบสาเหตุ" },
  OTHER: { sub: "คำถามทั่วไป", example: "หัวข้อของคุณ" },
};

export const CATEGORY_ORDER: readonly CaseCategory[] = ["PLAYBACK", "DEVICE", "PAYMENT", "REFUND", "ACCOUNT", "OTHER"];

/** Status as the customer sees it. */
export const CUSTOMER_STATUS_LABEL: Record<CaseStatus, string> = {
  OPEN: "รอทีมงาน",
  PENDING_CUSTOMER: "ทีมงานตอบแล้ว",
  RESOLVED: "แก้ไขแล้ว",
  CLOSED: "ปิดแล้ว",
};

/** Status as staff sees it. */
export const STAFF_STATUS_LABEL: Record<CaseStatus, string> = {
  OPEN: "รอตอบ",
  PENDING_CUSTOMER: "รอลูกค้า",
  RESOLVED: "แก้แล้ว",
  CLOSED: "ปิดแล้ว",
};

export const STATUS_BADGE: Record<CaseStatus, string> = {
  OPEN: "badge-warning",
  PENDING_CUSTOMER: "badge-soon",
  RESOLVED: "badge-success",
  CLOSED: "badge-neutral",
};

export const STATUS_ORDER: readonly CaseStatus[] = ["OPEN", "PENDING_CUSTOMER", "RESOLVED", "CLOSED"];

export const PRIORITY_LABEL: Record<CasePriority, string> = {
  URGENT: "ด่วนมาก",
  HIGH: "สูง",
  NORMAL: "ปกติ",
  LOW: "ต่ำ",
};

export const PRIORITY_RANK: Record<CasePriority, number> = { URGENT: 3, HIGH: 2, NORMAL: 1, LOW: 0 };
export const PRIORITY_ORDER: readonly CasePriority[] = ["URGENT", "HIGH", "NORMAL", "LOW"];

export const PRIORITY_BADGE: Record<CasePriority, string> = {
  URGENT: "badge-danger",
  HIGH: "badge-warning",
  NORMAL: "badge-neutral",
  LOW: "badge-neutral",
};

// ---------- attachments ----------

export interface CaseAttachment {
  key: string;
  name: string;
  size: number;
  type: string;
}

const attachmentSchema = z.object({
  key: z.string(),
  name: z.string(),
  size: z.number(),
  type: z.string(),
});

/** Parses CaseMessage.attachments (Json) defensively. */
export function parseAttachments(json: unknown): CaseAttachment[] {
  const res = z.array(attachmentSchema).safeParse(json);
  return res.success ? res.data : [];
}

export function attachmentUrl(messageId: string, key: string): string {
  return `/api/support/attachments/${messageId}/${key}`;
}

/** Display-safe file name (no paths / control chars), max 120 chars. */
function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>]/g, "").trim().slice(0, 120);
  return cleaned || "image";
}

/** Reads the `files` entries of a multipart form (empty file inputs are ignored). */
export function filesFromForm(form: FormData): File[] {
  return form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
}

/** Validates (JPEG/PNG/WebP, <= 5 MB, <= 3 files) and stores attachments. Throws UploadError. */
export async function saveAttachments(files: File[]): Promise<CaseAttachment[]> {
  if (files.length > MAX_ATTACHMENTS) throw new UploadError(`แนบรูปได้สูงสุด ${MAX_ATTACHMENTS} รูป`);
  const validated = [];
  for (const f of files) validated.push({ file: f, ...(await validateImageUpload(f)) });
  const storage = getUploadStorage();
  const out: CaseAttachment[] = [];
  for (const v of validated) {
    await storage.put(v.key, v.buffer, v.contentType);
    out.push({ key: v.key, name: cleanName(v.file.name), size: v.buffer.length, type: v.contentType });
  }
  return out;
}

// ---------- device info ----------

const deviceInfoSchema = z.object({
  userAgent: z.string().max(512).optional(),
  platform: z.string().max(64).optional(),
  drm: z.string().max(64).nullable().optional(),
  screen: z.string().max(32).optional(),
  language: z.string().max(32).optional(),
  downlinkMbps: z.number().min(0).max(100000).nullable().optional(),
});

export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

export function parseDeviceInfo(raw: unknown): DeviceInfo | null {
  let value = raw;
  if (typeof raw === "string") {
    if (!raw || raw.length > 4096) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const res = deviceInfoSchema.safeParse(value);
  return res.success ? res.data : null;
}

/** Rough "OS · Browser" summary from a user agent. */
export function describeUserAgent(ua: string | undefined): string {
  if (!ua) return "ไม่ทราบ";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : "อื่นๆ";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome|CriOS/.test(ua)
            ? "Chrome"
            : /Safari/.test(ua)
              ? "Safari"
              : "อื่นๆ";
  return `${os} · ${browser}`;
}

// ---------- queries ----------

/** OPEN cases (waiting for staff) — for the admin nav badge. */
export async function openCaseCount(): Promise<number> {
  return db.supportCase.count({ where: { status: "OPEN" } });
}

/** New cases created by this user in the last 24 h (rate limit). */
export async function recentCaseCount(userId: string): Promise<number> {
  return db.supportCase.count({
    where: { userId, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } },
  });
}

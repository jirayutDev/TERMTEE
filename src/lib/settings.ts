import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Typed shop settings stored in the Setting table (one row per section) and edited in
 * /admin/settings. Values not saved yet fall back to env vars, then to defaults, so the app
 * keeps working before anyone opens the settings page.
 *
 * Once a section is saved in /admin/settings it is authoritative (env is only the default).
 */
export interface Settings {
  shop: {
    name: string;
    supportEmail: string | null;
    supportLine: string | null; // LINE OA id or URL
    supportPhone: string | null;
    supportHours: string | null; // e.g. "ทุกวัน 10:00–22:00"
  };
  payment: {
    promptPayId: string | null;
    displayName: string | null;
    displayBank: string | null;
    accounts: string[]; // receiving account numbers / PromptPay ids accepted on slips
    names: string[]; // receiver names accepted on slips
    unpaidOrderTtlMinutes: number; // auto-cancel PENDING orders without slips (0 = never)
    rejectReasons: string[]; // presets for admin reject dialog
  };
  protection: {
    defaultReplayDays: number;
    watermarkShowEmail: boolean;
  };
  receipt: {
    issueReceipts: boolean;
    companyName: string | null;
    taxId: string | null;
    branch: string | null;
    address: string | null;
    vatRegistered: boolean;
  };
  policies: {
    terms: string; // markdown-ish plain text shown at /terms
    privacy: string; // shown at /privacy
  };
}

export type SettingsSection = keyof Settings;

export const SETTINGS_SECTIONS: readonly SettingsSection[] = ["shop", "payment", "protection", "receipt", "policies"];

function csv(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function defaultSettings(): Settings {
  const env = process.env;
  return {
    shop: { name: "TERMTEE", supportEmail: null, supportLine: null, supportPhone: null, supportHours: null },
    payment: {
      promptPayId: env.PROMPTPAY_ID || null,
      displayName: env.PAYMENT_DISPLAY_NAME || null,
      displayBank: env.PAYMENT_DISPLAY_BANK || null,
      accounts: csv(env.PAYMENT_ACCOUNTS),
      names: csv(env.PAYMENT_NAMES),
      unpaidOrderTtlMinutes: 60,
      rejectReasons: [
        "ยอดเงินในสลิปไม่ตรงกับคำสั่งซื้อ",
        "บัญชีผู้รับไม่ใช่บัญชีของร้าน",
        "สลิปไม่ชัด อ่านข้อมูลไม่ได้",
        "สลิปนี้ถูกใช้ไปแล้ว",
        "ไม่พบรายการโอนในบัญชีของร้าน",
      ],
    },
    protection: { defaultReplayDays: 7, watermarkShowEmail: true },
    receipt: { issueReceipts: false, companyName: null, taxId: null, branch: null, address: null, vatRegistered: false },
    policies: { terms: "", privacy: "" },
  };
}

/** All sections, saved values merged over defaults. */
export async function getSettings(): Promise<Settings> {
  const defaults = defaultSettings();
  const rows = await db.setting.findMany();
  const out = { ...defaults } as Record<string, unknown>;
  for (const row of rows) {
    if (row.key in defaults && row.value && typeof row.value === "object") {
      out[row.key] = { ...(defaults as unknown as Record<string, object>)[row.key], ...(row.value as object) };
    }
  }
  return out as unknown as Settings;
}

export async function getSettingsSection<K extends SettingsSection>(key: K): Promise<Settings[K]> {
  const row = await db.setting.findUnique({ where: { key } });
  const def = defaultSettings()[key];
  return row?.value && typeof row.value === "object" ? { ...def, ...(row.value as object) } : def;
}

/** When each section was last saved (for the settings page). */
export async function settingsUpdatedAt(): Promise<Partial<Record<SettingsSection, Date>>> {
  const rows = await db.setting.findMany({ select: { key: true, updatedAt: true } });
  return Object.fromEntries(rows.map((r) => [r.key, r.updatedAt]));
}

// ---------- Validation ----------
// Schemas accept both typed values and raw form strings (FormData), so server actions can pass
// Object.fromEntries(formData) straight in: "" -> null, "on" -> true, textarea lines -> string[].

const text = (max: number) =>
  z.preprocess(
    (v) => (v == null ? null : typeof v === "string" ? v.trim() || null : v),
    z.string().max(max, `ยาวได้ไม่เกิน ${max} ตัวอักษร`).nullable(),
  );

const requiredText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(1, "กรุณากรอก").max(max, `ยาวได้ไม่เกิน ${max} ตัวอักษร`),
  );

const longText = (max: number) =>
  z.preprocess(
    (v) => (v == null ? "" : typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : v),
    z.string().max(max, `ยาวได้ไม่เกิน ${max.toLocaleString("th-TH")} ตัวอักษร`),
  );

/** One item per line (textarea) or an array. Blank lines and duplicates dropped. */
const lines = (maxItems: number, maxLen: number) =>
  z.preprocess(
    (v) => {
      const arr = typeof v === "string" ? v.split(/\r?\n/) : v == null ? [] : v;
      if (!Array.isArray(arr)) return arr;
      return [...new Set(arr.map((s) => (typeof s === "string" ? s.trim() : s)).filter((s) => s !== ""))];
    },
    z
      .array(z.string().max(maxLen, `แต่ละรายการยาวได้ไม่เกิน ${maxLen} ตัวอักษร`))
      .max(maxItems, `ได้ไม่เกิน ${maxItems} รายการ`),
  );

const bool = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());

const int = (min: number, max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? NaN : Number(v)) : v),
    z
      .number({ error: "กรุณากรอกตัวเลข" })
      .int("ต้องเป็นจำนวนเต็ม")
      .min(min, `ต้องไม่น้อยกว่า ${min}`)
      .max(max, `ต้องไม่เกิน ${max.toLocaleString("th-TH")}`),
  );

const digits = (v: string) => v.replace(/[^0-9]/g, "");

export const settingsSchemas = {
  shop: z.object({
    name: requiredText(80),
    supportEmail: text(200).refine((v) => v === null || z.email().safeParse(v).success, "รูปแบบ email ไม่ถูกต้อง"),
    supportLine: text(200),
    supportPhone: text(40),
    supportHours: text(120),
  }),
  payment: z.object({
    promptPayId: text(40).refine(
      (v) => v === null || [10, 13, 15].includes(digits(v).length),
      "พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก เลขประจำตัว 13 หลัก หรือ e-Wallet 15 หลัก",
    ),
    displayName: text(120),
    displayBank: text(200),
    accounts: lines(20, 40),
    names: lines(20, 120),
    unpaidOrderTtlMinutes: int(0, 7 * 24 * 60),
    rejectReasons: lines(12, 200).refine((v) => v.length > 0, "ต้องมีอย่างน้อย 1 เหตุผล"),
  }),
  protection: z.object({
    defaultReplayDays: int(0, 365),
    watermarkShowEmail: bool,
  }),
  receipt: z.object({
    issueReceipts: bool,
    companyName: text(200),
    taxId: text(20).refine((v) => v === null || digits(v).length === 13, "เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก"),
    branch: text(40),
    address: text(500),
    vatRegistered: bool,
  }),
  policies: z.object({
    terms: longText(50_000),
    privacy: longText(50_000),
  }),
} satisfies { [K in SettingsSection]: z.ZodType<Settings[K], unknown> };

export function isSettingsSection(key: string): key is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(key);
}

/**
 * Validates and stores one section, writing an AuditLog entry with the changed fields.
 * Throws z.ZodError on invalid input (use z.flattenError for field errors).
 */
export async function saveSettingsSection<K extends SettingsSection>(
  key: K,
  value: unknown,
  actorId: string | null,
): Promise<Settings[K]> {
  const parsed = settingsSchemas[key].parse(value) as Settings[K];
  const before = (await getSettingsSection(key)) as Record<string, unknown>;
  const after = parsed as Record<string, unknown>;
  const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const json = parsed as unknown as Prisma.InputJsonValue;
  const pick = (o: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, o[k] ?? null]));
  await db.$transaction([
    db.setting.upsert({
      where: { key },
      create: { key, value: json, updatedBy: actorId },
      update: { value: json, updatedBy: actorId },
    }),
    db.auditLog.create({
      data: {
        actorId,
        action: "settings.update",
        target: key,
        // Policy text can be long; record only which fields changed for those.
        data: (key === "policies" ? { changed } : { changed, before: pick(before), after: pick(after) }) as Prisma.InputJsonValue,
      },
    }),
  ]);
  return parsed;
}

/** Append an AuditLog row. Never throws (logging must not break the admin action). */
export async function logAudit(
  actorId: string | null,
  action: string,
  target: string | null,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: { actorId, action, target, data: data as Prisma.InputJsonValue | undefined },
    });
  } catch (err) {
    console.error("[audit] failed to write", action, err);
  }
}

import type { EventStatus } from "@/generated/prisma/client";

export const TZ = "Asia/Bangkok";

export function formatThaiDateTime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: TZ,
    dateStyle: "long",
    timeStyle: "short",
  }).format(d);
}

export function formatBaht(satang: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: satang % 100 === 0 ? 0 : 2,
  }).format(satang / 100);
}

export const STATUS_LABEL: Record<EventStatus, string> = {
  DRAFT: "ฉบับร่าง",
  SCHEDULED: "เปิดขายตั๋ว",
  LIVE: "กำลังถ่ายทอดสด",
  ENDED: "จบแล้ว (ดูย้อนหลังได้)",
  ARCHIVED: "ปิดการดูย้อนหลัง",
};

/** Badge classes (see .badge-* in globals.css). */
export const STATUS_STYLE: Record<EventStatus, string> = {
  DRAFT: "badge-neutral",
  SCHEDULED: "badge-soon",
  LIVE: "badge-live",
  ENDED: "badge-replay",
  ARCHIVED: "badge-neutral",
};

/** Short admin-facing status label. */
export const STATUS_SHORT: Record<EventStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "เปิดขาย",
  LIVE: "LIVE",
  ENDED: "จบแล้ว · Replay",
  ARCHIVED: "ลบ replay แล้ว",
};

const shortDate = new Intl.DateTimeFormat("th-TH", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const shortTime = new Intl.DateTimeFormat("th-TH", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayMonth = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "short" });

/** "ส. 10 ต.ค. 2569 · 20:00 น." */
export function formatEventDate(d: Date): string {
  return `${shortDate.format(d)} · ${shortTime.format(d)} น.`;
}

/** "ส. 10 ต.ค. 2569" */
export function formatShortDate(d: Date): string {
  return shortDate.format(d);
}

/** "5 ต.ค. 20:35" */
export function formatDayTime(d: Date): string {
  return `${dayMonth.format(d)} ${shortTime.format(d)}`;
}

/** Human order reference, e.g. "#AB12CD34". */
export function orderRef(id: string): string {
  return `#${id.slice(-8).toUpperCase()}`;
}

/** Viewer code shown on the forensic watermark (Watermark.tsx uses userId.slice(-8)). */
export function viewerCode(userId: string): string {
  return userId.slice(-8);
}

/** Convert a Date to the value of an <input type="datetime-local"> in Bangkok time. */
export function toBangkokInputValue(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

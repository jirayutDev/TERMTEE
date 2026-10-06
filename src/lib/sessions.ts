import "server-only";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";

/** Auth.js session cookie names (database strategy): plain on http, __Secure- prefixed on https. */
export const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"] as const;

/** Throttle for touchSession(): at most one write per session per window. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** The raw session token of the current request, or null. Never send it to the client. */
export async function currentSessionToken(): Promise<string | null> {
  const store = await cookies();
  for (const name of SESSION_COOKIES) {
    const v = store.get(name)?.value;
    if (v) return v;
  }
  return null;
}

/** Opaque, non-reversible id for a session row, safe to render in the page / post back in forms. */
export function sessionRef(sessionToken: string): string {
  return createHash("sha256").update(sessionToken).digest("hex").slice(0, 24);
}

/** Client IP: first hop of X-Forwarded-For, then X-Real-IP. */
export function clientIp(h: Headers): string | null {
  const xff = h.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  const ip = first || h.get("x-real-ip")?.trim() || null;
  return ip ? ip.slice(0, 64) : null;
}

/**
 * Record device info (User-Agent, IP, last seen) on the current Auth.js Session row.
 * Throttled via lastSeenAt to one write per 5 minutes; never throws. Call from server
 * components / layouts of signed-in pages.
 */
export async function touchSession(): Promise<void> {
  try {
    const token = await currentSessionToken();
    if (!token) return;
    const h = await headers();
    const now = new Date();
    await db.session.updateMany({
      where: {
        sessionToken: token,
        expires: { gt: now },
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - TOUCH_INTERVAL_MS) } }],
      },
      data: {
        userAgent: h.get("user-agent")?.slice(0, 512) ?? null,
        ipAddress: clientIp(h),
        lastSeenAt: now,
      },
    });
  } catch (err) {
    console.error("[sessions] touchSession failed", err);
  }
}

// ---------- Display helpers (pure) ----------

export type DeviceKind = "phone" | "tablet" | "desktop";

/** Tiny User-Agent parser -> "Safari บน iPhone" style label. No dependency; good enough for a device list. */
export function describeUserAgent(ua: string | null | undefined): { label: string; kind: DeviceKind } {
  if (!ua) return { label: "อุปกรณ์ที่ไม่รู้จัก", kind: "desktop" };

  let os: string | null = null;
  let kind: DeviceKind = "desktop";
  if (/iPhone|iPod/.test(ua)) [os, kind] = ["iPhone", "phone"];
  else if (/iPad/.test(ua)) [os, kind] = ["iPad", "tablet"];
  else if (/Android/.test(ua)) [os, kind] = /Mobile/.test(ua) ? ["Android", "phone"] : ["แท็บเล็ต Android", "tablet"];
  else if (/CrOS/.test(ua)) os = "Chromebook";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Macintosh|Mac OS X/.test(ua)) os = "Mac";
  else if (/Linux/.test(ua)) os = "Linux";

  const browsers: [RegExp, string][] = [
    [/\bLine\//, "LINE"],
    [/FBAN|FBAV/, "Facebook"],
    [/Instagram/, "Instagram"],
    [/EdgA?\/|EdgiOS\//, "Edge"],
    [/OPR\/|Opera/, "Opera"],
    [/SamsungBrowser\//, "Samsung Internet"],
    [/Firefox\/|FxiOS\//, "Firefox"],
    [/Chrome\/|CriOS\//, "Chrome"],
    [/Version\/[\d.]+.*Safari\//, "Safari"],
  ];
  const browser = browsers.find(([re]) => re.test(ua))?.[1] ?? null;

  const label =
    browser && os ? `${browser} บน ${os}` : browser ?? os ?? "อุปกรณ์ที่ไม่รู้จัก";
  return { label, kind };
}

/** "203.150.12.34" -> "203.150.•.•", IPv6 keeps the first two groups. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const [a, b] = v4.split(".");
    return `${a}.${b}.•.•`;
  }
  if (ip.includes(":")) {
    const groups = ip.split(":").filter(Boolean);
    return `${groups.slice(0, 2).join(":")}:…`;
  }
  return "•••";
}

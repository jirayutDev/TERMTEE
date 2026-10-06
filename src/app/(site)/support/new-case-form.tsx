"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { detectDrmSupport } from "@/components/player/drm-support";
import AttachmentInput from "./attachment-input";

export interface CategoryOption {
  value: string;
  label: string;
  sub: string;
  example: string;
}

export interface RelatedOption {
  value: string; // "order:<id>" | "event:<id>"
  label: string;
  group: "order" | "event";
}

interface DeviceInfo {
  userAgent: string;
  platform?: string;
  drm: string | null;
  screen?: string;
  language?: string;
  downlinkMbps?: number | null;
}

function summarize(d: DeviceInfo): string {
  const ua = d.userAgent;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "อุปกรณ์อื่น";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox|FxiOS/.test(ua)
      ? "Firefox"
      : /Chrome|CriOS/.test(ua)
        ? "Chrome"
        : /Safari/.test(ua)
          ? "Safari"
          : "browser อื่น";
  const parts = [os, browser, `DRM: ${d.drm ?? "ไม่รองรับระดับฮาร์ดแวร์"}`];
  if (d.downlinkMbps) parts.push(`เน็ต ~${d.downlinkMbps} Mbps`);
  return parts.join(" · ");
}

/** "แจ้งปัญหาใหม่" form. Posts multipart to /api/support/cases, then opens the new case. */
export default function NewCaseForm({
  categories,
  related,
  defaultRelated,
  defaultCategory,
}: {
  categories: CategoryOption[];
  related: RelatedOption[];
  defaultRelated?: string;
  defaultCategory?: string;
}) {
  const router = useRouter();
  const ids = { subject: useId(), message: useId(), related: useId(), err: useId() };
  const [category, setCategory] = useState(defaultCategory ?? categories[0]?.value ?? "OTHER");
  const [files, setFiles] = useState<File[]>([]);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [shareDevice, setShareDevice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const current = categories.find((c) => c.value === category) ?? categories[0];

  useEffect(() => {
    let cancelled = false;
    detectDrmSupport()
      .catch(() => null)
      .then((drm) => {
        if (cancelled) return;
        const conn = (navigator as Navigator & { connection?: { downlink?: number } }).connection;
        setDevice({
          userAgent: navigator.userAgent.slice(0, 512),
          platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform,
          drm: drm?.system ?? null,
          screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}`,
          language: navigator.language,
          downlinkMbps: typeof conn?.downlink === "number" ? conn.downlink : null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const body = new FormData(e.currentTarget);
    body.set("category", category);
    body.delete("files");
    for (const f of files) body.append("files", f);
    if (device && shareDevice) body.set("deviceInfo", JSON.stringify(device));
    try {
      const res = await fetch("/api/support/cases", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok || !data.id) {
        setError(data.message ?? "ส่งเคสไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        setSubmitting(false);
        return;
      }
      router.push(`/support/${data.id}?created=1`);
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      setSubmitting(false);
    }
  }

  const orders = related.filter((r) => r.group === "order");
  const events = related.filter((r) => r.group === "event");

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-describedby={error ? ids.err : undefined}>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="label mb-2">เรื่องอะไร</legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(170px,100%),1fr))] gap-2">
          {categories.map((c) => {
            const on = c.value === category;
            return (
              <label
                key={c.value}
                className={`flex min-h-16 cursor-pointer flex-col gap-0.5 rounded-[12px] px-3 py-2.5 focus-within:outline-2 focus-within:outline-link ${
                  on ? "border-[1.5px] border-accent-hover bg-accent/12" : "border border-white/12 bg-bg/50 hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name="categoryPick"
                  value={c.value}
                  checked={on}
                  onChange={() => setCategory(c.value)}
                  className="sr-only"
                />
                <span className="text-sm font-semibold">{c.label}</span>
                <span className="text-xs text-muted">{c.sub}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.related} className="label">
          เกี่ยวกับคำสั่งซื้อ / event
        </label>
        <select id={ids.related} name="related" defaultValue={defaultRelated ?? ""} className="field">
          <option value="">ไม่เกี่ยวกับคำสั่งซื้อ</option>
          {orders.length > 0 && (
            <optgroup label="คำสั่งซื้อของฉัน">
              {orders.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          {events.length > 0 && (
            <optgroup label="Event">
              {events.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.subject} className="label">
          หัวข้อ
        </label>
        <input
          id={ids.subject}
          name="subject"
          required
          minLength={3}
          maxLength={140}
          placeholder={current?.example}
          className="field"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.message} className="label">
          รายละเอียด
        </label>
        <textarea
          id={ids.message}
          name="message"
          required
          rows={5}
          maxLength={5000}
          placeholder="เล่าสิ่งที่เกิดขึ้น เวลาที่เจอปัญหา และสิ่งที่ลองทำไปแล้ว"
          className="field"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="label">แนบรูป / screenshot</span>
        <AttachmentInput files={files} onChange={setFiles} onError={setError} disabled={submitting} />
      </div>

      <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm">
        <input
          type="checkbox"
          checked={shareDevice}
          onChange={(e) => setShareDevice(e.target.checked)}
          className="mt-0.5 size-[18px] shrink-0 accent-accent"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">แนบข้อมูลเครื่องให้ทีมงาน</span>
          <span className="text-xs text-muted">{device ? summarize(device) : "กำลังตรวจข้อมูลเครื่อง…"}</span>
        </span>
      </label>

      {error && (
        <p id={ids.err} role="alert" className="rounded-md border border-danger/45 bg-danger/10 px-3.5 py-3 text-sm text-[#FFC2CD]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2.5">
        <Link href="/support" className="btn btn-outline">
          ยกเลิก
        </Link>
        <button type="submit" disabled={submitting} className="btn btn-primary shadow-none">
          {submitting && <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />}
          ส่งเคส
        </button>
      </div>
    </form>
  );
}

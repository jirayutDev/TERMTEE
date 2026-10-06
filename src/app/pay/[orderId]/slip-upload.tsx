"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { PaymentStatus } from "@/generated/prisma/enums";
import { CheckIcon, UploadIcon } from "@/components/ui/icons";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // matches SLIP_MAX_BYTES in src/lib/slip/image.ts

function fmtSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Step 2 of the pay page: pick a slip image and submit it to /api/payment/verify.
 * The server page renders the outcome (paid / pending / failed) after refresh.
 */
export default function SlipUpload({ orderId, isRetry }: { orderId: string; isRetry: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const inputId = useId();
  const cameraId = useId();

  // Release the object URL on unmount.
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  // Elapsed-seconds counter while the slip is read.
  useEffect(() => {
    if (!submitting) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [submitting]);

  function pick(f: File | null) {
    setError(null);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreview(null);
    setFile(null);
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("ไฟล์นี้ใช้ไม่ได้ · กรุณาเลือกไฟล์รูปภาพสลิป");
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setError("ไฟล์ใหญ่เกินไป · ใช้รูปขนาดไม่เกิน 5 MB");
      return;
    }
    const url = URL.createObjectURL(f);
    previewRef.current = url;
    setPreview(url);
    setFile(f);
  }

  /** Re-render the server page so it shows the outcome. */
  function showOutcome() {
    if (isRetry) router.replace(pathname);
    else router.refresh();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || submitting) return;
    setSubmitting(true);
    setElapsed(0);
    setError(null);
    try {
      const body = new FormData();
      body.set("orderId", orderId);
      body.set("slip", file);
      const res = await fetch("/api/payment/verify", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as {
        status?: PaymentStatus;
        paymentId?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.status || !data.paymentId) {
        if (data.error === "already_paid") showOutcome();
        setError(data.message ?? "ตรวจสอบสลิปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        setSubmitting(false);
      } else {
        // Keep the spinner until the server page swaps in the result screen.
        showOutcome();
      }
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      setSubmitting(false);
    }
  }

  const fileInput = (id: string, capture?: boolean) => (
    <input
      id={id}
      type="file"
      accept="image/*"
      {...(capture ? { capture: "environment" as const } : {})}
      className="sr-only"
      disabled={submitting}
      onChange={(e) => {
        pick(e.target.files?.[0] ?? null);
        e.target.value = "";
      }}
    />
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <section
        aria-labelledby="s2"
        className="glass-strong flex flex-col gap-3.5 rounded-xl p-[clamp(16px,2vw,24px)]"
      >
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-full bg-accent text-sm font-bold">2</span>
          <h2 id="s2" className="text-[17px] font-bold">
            แนบสลิปการโอน
          </h2>
        </div>

        {!file ? (
          <>
            <label
              htmlFor={inputId}
              className={`flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-lg border-[1.5px] border-dashed bg-accent/6 p-5 text-center focus-within:outline-2 focus-within:outline-link ${
                error ? "border-danger" : "border-link/50"
              }`}
            >
              <UploadIcon size={36} className="text-link" />
              <span className="text-[15px] font-semibold">แตะเพื่อเลือกรูปสลิป</span>
              <span className="text-xs text-muted">
                ไฟล์รูปภาพ · ไม่เกิน 5 MB · เห็นยอด วันเวลา และ QR/เลขอ้างอิงชัดเจน
              </span>
              {fileInput(inputId)}
            </label>
            <label htmlFor={cameraId} className="btn btn-secondary sm:hidden">
              ถ่ายรูปสลิป
              {fileInput(cameraId, true)}
            </label>
          </>
        ) : (
          <div className="flex items-start gap-3.5 rounded-lg border border-success/40 bg-bg/60 p-3">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="ตัวอย่างสลิป"
                className="aspect-[3/4] w-24 shrink-0 rounded-[10px] bg-white object-cover"
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-success-fg">
                <CheckIcon size={16} className="text-success" />
                แนบสลิปแล้ว
              </span>
              <span className="truncate text-[13px] text-soft">
                {file.name} · {fmtSize(file.size)}
              </span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <label
                  htmlFor={inputId}
                  className={`btn btn-sm btn-outline cursor-pointer text-[13px] focus-within:outline-2 focus-within:outline-link ${submitting ? "pointer-events-none opacity-50" : ""}`}
                >
                  เปลี่ยนรูป
                  {fileInput(inputId)}
                </label>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => pick(null)}
                  className="btn btn-sm text-[13px] text-danger-fg hover:bg-danger/10 disabled:opacity-50"
                >
                  ลบ
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-[13px] text-[#FFC2CD]"
          >
            {error}
          </div>
        )}
      </section>

      <button type="submit" disabled={!file || submitting} className="btn btn-lg btn-primary w-full">
        {submitting ? (
          <>
            <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />
            กำลังตรวจสลิป… {elapsed > 0 && `${elapsed} วินาที`}
          </>
        ) : file ? (
          "ส่งสลิป"
        ) : (
          "แนบสลิปก่อนส่ง"
        )}
      </button>
      <p aria-live="polite" className="text-center text-xs leading-[18px] text-muted">
        {submitting
          ? "อาจใช้เวลา 5–15 วินาที กรุณาอย่าปิดหน้านี้"
          : "ระบบตรวจยอด เวลาโอน และบัญชีผู้รับจากสลิปอัตโนมัติ ผ่านแล้วได้ตั๋วทันที · สลิปปลอมหรือสลิปซ้ำจะถูกปฏิเสธ"}
      </p>
    </form>
  );
}

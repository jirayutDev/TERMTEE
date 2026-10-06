"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import AttachmentInput from "./attachment-input";

/**
 * Reply box for a case thread. Posts multipart to /api/support/cases/[id]/messages.
 * mode "staff" adds canned replies, an internal-note toggle and "send & resolve".
 */
export default function ReplyForm({
  caseId,
  mode,
  canned = [],
  placeholder,
}: {
  caseId: string;
  mode: "customer" | "staff";
  canned?: { id: string; title: string; body: string }[];
  placeholder?: string;
}) {
  const router = useRouter();
  const ids = { body: useId(), err: useId() };
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<null | "send" | "resolve">(null);

  function insertCanned(text: string) {
    const el = textRef.current;
    if (!el) return setBody((b) => (b ? `${b}\n${text}` : text));
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + text + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }

  async function send(resolve: boolean) {
    if (submitting) return;
    if (!body.trim() && files.length === 0) {
      setError("กรุณาพิมพ์ข้อความหรือแนบรูป");
      return;
    }
    setSubmitting(resolve ? "resolve" : "send");
    setError(null);
    setNotice(null);
    const fd = new FormData();
    fd.set("body", body);
    for (const f of files) fd.append("files", f);
    if (mode === "staff") {
      fd.set("as", "staff");
      fd.set("internal", internal ? "1" : "0");
      fd.set("resolve", resolve ? "1" : "0");
    }
    try {
      const res = await fetch(`/api/support/cases/${caseId}/messages`, { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? "ส่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      } else {
        setBody("");
        setFiles([]);
        setNotice(
          mode === "customer"
            ? "ส่งข้อความแล้ว · ทีมงานจะตอบกลับทาง email"
            : internal
              ? "บันทึกโน้ตภายในแล้ว"
              : resolve
                ? "ส่งคำตอบและปิดเคสแล้ว"
                : "ส่งคำตอบแล้ว · แจ้งลูกค้าทาง email",
        );
        router.refresh();
      }
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
    setSubmitting(null);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(false);
      }}
      className={`flex flex-col gap-3 rounded-lg border p-3.5 ${
        internal ? "border-warning/45 bg-warning/6" : "border-white/10 bg-bg/40"
      }`}
    >
      {mode === "staff" && canned.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">คำตอบสำเร็จรูป</span>
          <div className="flex flex-wrap gap-1.5">
            {canned.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => insertCanned(c.body)}
                className="btn btn-sm btn-secondary min-h-9 text-[13px]"
                title={c.body}
              >
                {c.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <label htmlFor={ids.body} className="label">
        {internal ? "โน้ตภายใน (ลูกค้าไม่เห็น)" : "ตอบกลับ"}
      </label>
      <textarea
        id={ids.body}
        ref={textRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={5000}
        placeholder={placeholder ?? "พิมพ์ข้อความ"}
        aria-describedby={error ? ids.err : undefined}
        className="field"
      />

      <AttachmentInput files={files} onChange={setFiles} onError={setError} disabled={!!submitting} />

      {error && (
        <p id={ids.err} role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {mode === "staff" ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
              className="size-[18px] accent-warning"
            />
            โน้ตภายใน
          </label>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-2">
          {mode === "staff" && !internal && (
            <button type="button" disabled={!!submitting} onClick={() => void send(true)} className="btn btn-sm btn-outline min-h-11">
              {submitting === "resolve" && <Spinner />}
              ส่งและปิดเคส
            </button>
          )}
          <button type="submit" disabled={!!submitting} className="btn btn-sm btn-primary min-h-11 shadow-none">
            {submitting === "send" && <Spinner />}
            {mode === "staff" ? (internal ? "บันทึกโน้ต" : "ส่งคำตอบ") : "ส่ง"}
          </button>
        </div>
      </div>
    </form>
  );
}

function Spinner() {
  return <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />;
}

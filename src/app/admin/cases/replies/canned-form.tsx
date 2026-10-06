"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import type { CannedState } from "../actions";

/** Create / edit form for a canned reply (Server Action via useActionState). */
export default function CannedForm({
  action,
  initial,
  submitLabel,
}: {
  action: (prev: CannedState, formData: FormData) => Promise<CannedState>;
  initial?: { title: string; body: string };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const ids = { title: useId(), body: useId() };

  // Clear the "new" form after a successful create.
  useEffect(() => {
    if (state.ok && !initial) formRef.current?.reset();
  }, [state, initial]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.title} className="label">
          ชื่อปุ่ม
        </label>
        <input
          id={ids.title}
          name="title"
          required
          maxLength={60}
          defaultValue={initial?.title}
          placeholder="เช่น เครื่องไม่รองรับ"
          className="field"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.body} className="label">
          ข้อความ
        </label>
        <textarea id={ids.body} name="body" required rows={3} maxLength={2000} defaultValue={initial?.body} className="field" />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-danger-fg">
          {state.error}
        </p>
      )}
      {state.ok && !pending && (
        <p role="status" className="text-sm text-success">
          บันทึกแล้ว
        </p>
      )}
      <div className="flex justify-end">
        <button disabled={pending} className="btn btn-sm btn-primary min-h-11 shadow-none">
          {pending && <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

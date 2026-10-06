"use client";

import { useId, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

function SubmitButton({ children, tone }: { children: ReactNode; tone: "danger" | "primary" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`btn btn-sm ${tone === "danger" ? "btn-danger" : "btn-primary"}`}>
      {pending && <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />}
      {children}
    </button>
  );
}

/**
 * A trigger button that opens a native modal <dialog>; confirming submits `action`
 * (a Server Action) with any extra form fields passed as `children`.
 */
export default function ConfirmDialog({
  action,
  trigger,
  triggerClassName,
  triggerDisabled = false,
  title,
  body,
  confirmLabel,
  tone = "danger",
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  trigger: ReactNode;
  triggerClassName: string;
  triggerDisabled?: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        disabled={triggerDisabled}
        className={triggerClassName}
        onClick={() => ref.current?.showModal()}
      >
        {trigger}
      </button>
      <dialog ref={ref} className="modal" aria-labelledby={titleId}>
        <form
          action={async (fd) => {
            // Close first: actions that redirect back to this page never resolve here.
            ref.current?.close();
            await action(fd);
          }}
          className="flex flex-col gap-3"
        >
          <h2 id={titleId} className="text-xl leading-7 font-bold">
            {title}
          </h2>
          {body && <div className="text-sm leading-[22px] text-muted">{body}</div>}
          {children}
          <div className="mt-2 flex flex-wrap justify-end gap-2.5">
            <button type="button" className="btn btn-sm btn-outline" onClick={() => ref.current?.close()}>
              ยกเลิก
            </button>
            <SubmitButton tone={tone}>{confirmLabel}</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}

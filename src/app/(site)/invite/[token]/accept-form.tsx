"use client";

import { useActionState } from "react";
import type { AcceptState } from "./actions";

export default function AcceptForm({ action }: { action: (prev: AcceptState, fd: FormData) => Promise<AcceptState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col items-center gap-3">
      {state.error && (
        <p role="alert" className="rounded-md border border-danger/45 bg-danger/10 p-3 text-sm text-[#FFC2CD]">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="btn btn-primary min-w-[220px]">
        {pending && <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />}
        ตอบรับคำเชิญ
      </button>
    </form>
  );
}

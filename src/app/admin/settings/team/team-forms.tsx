"use client";

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import type { TeamFormState } from "./actions";

type RoleOption = { value: string; label: string };

function Submit({ children, className }: { children: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className={className}>
      {pending && <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />}
      {children}
    </button>
  );
}

export function InviteForm({
  action,
  roles,
}: {
  action: (prev: TeamFormState, fd: FormData) => Promise<TeamFormState>;
  roles: RoleOption[];
}) {
  const [state, formAction] = useActionState(action, {});
  const id = useId();
  const emailErr = state.fieldErrors?.email?.[0];
  const roleErr = state.fieldErrors?.role?.[0];
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-[999_1_260px] flex-col gap-1.5">
          <label htmlFor={`${id}-email`} className="label">
            เชิญด้วย Google email
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            placeholder="name@gmail.com"
            aria-invalid={emailErr ? true : undefined}
            aria-describedby={emailErr ? `${id}-email-err` : undefined}
            className="field"
          />
        </div>
        <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-1.5">
          <label htmlFor={`${id}-role`} className="label">
            บทบาท
          </label>
          <select id={`${id}-role`} name="role" defaultValue={roles[0]?.value} aria-invalid={roleErr ? true : undefined} className="field">
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <Submit className="btn btn-primary min-h-11 shadow-none">ส่งคำเชิญ</Submit>
      </div>
      {(emailErr || roleErr || state.error) && (
        <span id={`${id}-email-err`} role="alert" className="text-xs text-danger-fg">
          {emailErr ?? roleErr ?? state.error}
        </span>
      )}
      {state.ok && (
        <span role="status" className="text-xs text-success-fg">
          {state.ok}
        </span>
      )}
    </form>
  );
}

export function RoleForm({
  action,
  current,
  roles,
  label,
}: {
  action: (prev: TeamFormState, fd: FormData) => Promise<TeamFormState>;
  current: string;
  roles: RoleOption[];
  label: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <select name="role" defaultValue={current} aria-label={label} className="field min-h-10 w-auto text-sm">
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <Submit className="btn btn-sm btn-outline min-h-10">บันทึก</Submit>
      </div>
      {state.error && (
        <span role="alert" className="text-xs text-danger-fg">
          {state.error}
        </span>
      )}
      {state.ok && (
        <span role="status" className="text-xs text-success-fg">
          {state.ok}
        </span>
      )}
    </form>
  );
}

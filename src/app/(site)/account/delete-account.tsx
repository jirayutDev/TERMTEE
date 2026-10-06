"use client";

import { useActionState, useId, useRef, useState } from "react";
import { deleteConfirmMatches } from "@/lib/account";
import { deleteAccountAction, type DeleteAccountState } from "./actions";

export default function DeleteAccount({
  email,
  activeTickets,
  blocked,
}: {
  email: string;
  activeTickets: number;
  /** A slip is still PROCESSING / NEEDS_REVIEW: deletion is refused server-side too. */
  blocked: boolean;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [state, formAction, pending] = useActionState(deleteAccountAction, {} as DeleteAccountState);
  const matches = deleteConfirmMatches(typed, email);

  return (
    <section
      aria-labelledby={`${id}-h`}
      className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-danger/35 bg-danger/5 p-[clamp(16px,2vw,24px)]"
    >
      <div className="flex flex-[1_1_280px] flex-col gap-0.5">
        <h2 id={`${id}-h`} className="text-[17px] font-bold">
          ลบบัญชี
        </h2>
        <span className="text-[13px] leading-5 text-muted">
          ตั๋วที่ยังดูได้จะถูกยกเลิกทั้งหมด และกู้คืนไม่ได้ · ประวัติการซื้อเก็บไว้ตามกฎหมายบัญชี
        </span>
        {blocked && (
          <span className="mt-1 text-[13px] leading-5 text-warning-fg">
            มีสลิปที่กำลังรอตรวจ จะลบบัญชีได้หลังตรวจเสร็จ
          </span>
        )}
      </div>
      <button
        type="button"
        disabled={blocked}
        className="btn btn-danger-outline"
        onClick={() => {
          setTyped("");
          dialogRef.current?.showModal();
        }}
      >
        ลบบัญชี…
      </button>

      <dialog ref={dialogRef} className="modal" aria-labelledby={`${id}-dlg`}>
        <form action={formAction} className="flex flex-col gap-3">
          <h2 id={`${id}-dlg`} className="text-xl leading-7 font-bold">
            ลบบัญชีถาวร?
          </h2>
          <p className="text-sm leading-[22px] text-muted">
            {activeTickets > 0
              ? `คุณมีตั๋วที่ยังดูได้ ${activeTickets.toLocaleString("th-TH")} ใบ ตั๋วเหล่านี้จะถูกยกเลิกและไม่ได้รับเงินคืน`
              : "ข้อมูลโปรไฟล์ ใบเสร็จ บัญชีรับเงินคืน และการ login ทุกเครื่องจะถูกลบ"}
            {" · "}ถ้า login ด้วย Google บัญชีเดิมอีกครั้ง จะได้บัญชีใหม่ที่ว่างเปล่า
          </p>
          <label htmlFor={`${id}-confirm`} className="label">
            พิมพ์ <span className="font-mono text-fg">{email}</span> เพื่อยืนยัน
          </label>
          <input
            id={`${id}-confirm`}
            name="confirm"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? `${id}-err` : undefined}
            className="field"
          />
          {state.error && (
            <span id={`${id}-err`} role="alert" className="text-xs text-danger-fg">
              {state.error}
            </span>
          )}
          <div className="mt-2 flex flex-wrap justify-end gap-2.5">
            <button type="button" className="btn btn-sm btn-outline" onClick={() => dialogRef.current?.close()}>
              ยกเลิก
            </button>
            <button type="submit" disabled={!matches || pending} className="btn btn-sm btn-danger">
              {pending && <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />}
              ลบบัญชี
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}

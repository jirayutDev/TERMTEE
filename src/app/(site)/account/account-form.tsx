"use client";

import { useActionState, useId, useRef, useState, type ReactNode } from "react";
import { THAI_BANKS } from "@/lib/account";
import { saveSettingsAction, type SettingsFormState } from "./actions";
import { Toast } from "./toast";

export type AccountFormValues = {
  name: string;
  phone: string;
  billingType: "PERSON" | "COMPANY";
  billingName: string;
  billingTaxId: string;
  billingBranch: string;
  billingAddress: string;
  refundBankCode: string;
  refundAccountNo: string;
  refundAccountName: string;
  notifyPayment: boolean;
  notifyEvent: boolean;
  notifySupport: boolean;
};

const NOTIFY = [
  { name: "notifyPayment", label: "ผลตรวจสลิป", sub: "แจ้งทันทีเมื่ออนุมัติหรือปฏิเสธสลิป" },
  { name: "notifyEvent", label: "เตือนก่อน live เริ่ม", sub: "ก่อนเริ่มถ่ายทอดสด และก่อนหมดเวลาดูย้อนหลัง" },
  { name: "notifySupport", label: "ทีมงานตอบกลับเคสที่แจ้ง", sub: "เมื่อมีข้อความใหม่จากทีมงาน" },
] as const;

const section = "glass-admin flex flex-col gap-4 rounded-[20px] p-[clamp(16px,2vw,24px)]";
const grid = "grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-4";

/** Merge server values with what was submitted (after a validation error React resets the form). */
function seed(initial: AccountFormValues, submitted: Record<string, string> | undefined): AccountFormValues {
  if (!submitted) return initial;
  return {
    ...initial,
    ...Object.fromEntries(Object.entries(submitted).filter(([k]) => typeof initial[k as keyof AccountFormValues] === "string")),
    billingType: submitted.billingType === "COMPANY" ? "COMPANY" : "PERSON",
    notifyPayment: submitted.notifyPayment === "on",
    notifyEvent: submitted.notifyEvent === "on",
    notifySupport: submitted.notifySupport === "on",
  };
}

export default function AccountForm({
  initial,
  email,
  avatar,
}: {
  initial: AccountFormValues;
  email: string;
  avatar: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(saveSettingsAction, {} as SettingsFormState);
  const values = seed(initial, state.values);
  return (
    <>
      {/* Remount on every response so uncontrolled fields pick up the new defaults. */}
      <Fields
        key={state.at ?? 0}
        values={values}
        email={email}
        avatar={avatar}
        state={state}
        formAction={formAction}
        pending={pending}
      />
      <Toast
        toast={
          state.at
            ? state.ok
              ? { text: "บันทึกแล้ว", tone: "ok", at: state.at }
              : { text: state.error ?? "บันทึกไม่สำเร็จ", tone: "error", at: state.at }
            : null
        }
      />
    </>
  );
}

function Fields({
  values,
  email,
  avatar,
  state,
  formAction,
  pending,
}: {
  values: AccountFormValues;
  email: string;
  avatar: ReactNode;
  state: SettingsFormState;
  formAction: (fd: FormData) => void;
  pending: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(!!state.error);
  const [billingType, setBillingType] = useState(values.billingType);
  const id = useId();
  const err = (k: string) => state.fieldErrors?.[k]?.[0];

  const field = (
    name: keyof AccountFormValues,
    label: ReactNode,
    opts: {
      type?: string;
      inputMode?: "numeric" | "tel" | "text";
      placeholder?: string;
      hint?: string;
      mono?: boolean;
      maxLength?: number;
      autoComplete?: string;
    } = {},
  ) => {
    const fid = `${id}-${name}`;
    const e = err(name);
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fid} className="label">
          {label}
        </label>
        <input
          id={fid}
          name={name}
          type={opts.type ?? "text"}
          inputMode={opts.inputMode}
          placeholder={opts.placeholder}
          maxLength={opts.maxLength}
          autoComplete={opts.autoComplete ?? "off"}
          defaultValue={values[name] as string}
          aria-invalid={e ? true : undefined}
          aria-describedby={e || opts.hint ? `${fid}-h` : undefined}
          className={`field ${opts.mono ? "font-mono" : ""}`}
        />
        {(e || opts.hint) && (
          <span id={`${fid}-h`} className={`text-xs ${e ? "text-danger-fg" : "text-subtle"}`}>
            {e ?? opts.hint}
          </span>
        )}
      </div>
    );
  };

  const optional = <span className="font-normal text-subtle">(ไม่บังคับ)</span>;

  return (
    <form
      ref={formRef}
      action={formAction}
      onChange={() => setDirty(true)}
      noValidate
      className="flex flex-col gap-[clamp(18px,2vw,24px)]"
    >
      {/* Profile */}
      <section aria-labelledby={`${id}-h-profile`} className={section}>
        <h2 id={`${id}-h-profile`} className="text-[17px] font-bold">
          โปรไฟล์
        </h2>
        <div className="flex items-center gap-3.5">
          {avatar}
          <div className="flex flex-col">
            <span className="text-[13px] text-muted">รูปโปรไฟล์จาก Google</span>
            <span className="text-xs text-subtle">เปลี่ยนได้ที่บัญชี Google</span>
          </div>
        </div>
        <div className={grid}>
          {field("name", "ชื่อที่แสดง", { maxLength: 80, autoComplete: "name" })}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-email`} className="label">
              Email
            </label>
            <input
              id={`${id}-email`}
              type="email"
              value={email}
              readOnly
              aria-describedby={`${id}-email-h`}
              className="field border-white/8 bg-white/[0.03] text-muted"
            />
            <span id={`${id}-email-h`} className="text-xs text-subtle">
              ผูกกับ Login with Google · ใช้แสดงบนลายน้ำ
            </span>
          </div>
          {field("phone", <>เบอร์โทร {optional}</>, {
            type: "tel",
            inputMode: "tel",
            placeholder: "08x-xxx-xxxx",
            hint: "ให้ทีมงานติดต่อเมื่อสลิปมีปัญหา",
            autoComplete: "tel-national",
          })}
        </div>
      </section>

      {/* Tax invoice */}
      <section aria-labelledby={`${id}-h-billing`} className={section}>
        <div className="flex flex-col gap-0.5">
          <h2 id={`${id}-h-billing`} className="text-[17px] font-bold">
            ข้อมูลใบเสร็จ / ใบกำกับภาษี
          </h2>
          <span className="text-[13px] text-muted">ใช้ออกใบเสร็จในประวัติการซื้อ · เว้นว่างได้</span>
        </div>
        <div role="radiogroup" aria-label="ประเภทผู้เสียภาษี" className="segmented self-start bg-bg/60">
          {(
            [
              ["PERSON", "บุคคล"],
              ["COMPANY", "นิติบุคคล"],
            ] as const
          ).map(([v, label]) => (
            <label
              key={v}
              className={`cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-accent-hover ${
                billingType === v ? "bg-accent! font-semibold text-white!" : ""
              }`}
            >
              <input
                type="radio"
                name="billingType"
                value={v}
                checked={billingType === v}
                onChange={() => setBillingType(v)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        <div className={grid}>
          {field("billingName", billingType === "COMPANY" ? "ชื่อบริษัท" : "ชื่อ-นามสกุล", { maxLength: 200 })}
          {field("billingTaxId", "เลขประจำตัวผู้เสียภาษี", {
            inputMode: "numeric",
            placeholder: "13 หลัก",
            mono: true,
            maxLength: 17,
            hint: billingType === "PERSON" ? "บุคคลธรรมดาใช้เลขบัตรประชาชน" : undefined,
          })}
          {billingType === "COMPANY" &&
            field("billingBranch", "รหัสสาขา", {
              inputMode: "numeric",
              placeholder: "00000",
              mono: true,
              maxLength: 5,
              hint: "00000 = สำนักงานใหญ่",
            })}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-billingAddress`} className="label">
            ที่อยู่
          </label>
          <textarea
            id={`${id}-billingAddress`}
            name="billingAddress"
            rows={3}
            maxLength={500}
            autoComplete="street-address"
            defaultValue={values.billingAddress}
            aria-invalid={err("billingAddress") ? true : undefined}
            aria-describedby={err("billingAddress") ? `${id}-billingAddress-h` : undefined}
            className="field"
          />
          {err("billingAddress") && (
            <span id={`${id}-billingAddress-h`} className="text-xs text-danger-fg">
              {err("billingAddress")}
            </span>
          )}
        </div>
      </section>

      {/* Refund account */}
      <section aria-labelledby={`${id}-h-refund`} className={section}>
        <div className="flex flex-col gap-0.5">
          <h2 id={`${id}-h-refund`} className="text-[17px] font-bold">
            บัญชีรับเงินคืน
          </h2>
          <span className="text-[13px] text-muted">
            ใช้เมื่อ event ถูกยกเลิกหรือได้รับอนุมัติคืนเงิน · ชื่อบัญชีต้องตรงกับชื่อผู้ซื้อ
          </span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-refundBankCode`} className="label">
              ธนาคาร
            </label>
            <select
              id={`${id}-refundBankCode`}
              name="refundBankCode"
              defaultValue={values.refundBankCode}
              aria-invalid={err("refundBankCode") ? true : undefined}
              aria-describedby={err("refundBankCode") ? `${id}-refundBankCode-h` : undefined}
              className="field"
            >
              <option value="">เลือกธนาคาร</option>
              {THAI_BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
            {err("refundBankCode") && (
              <span id={`${id}-refundBankCode-h`} className="text-xs text-danger-fg">
                {err("refundBankCode")}
              </span>
            )}
          </div>
          {field("refundAccountNo", "เลขบัญชี", { inputMode: "numeric", mono: true, maxLength: 20 })}
          {field("refundAccountName", "ชื่อบัญชี", { maxLength: 120 })}
        </div>
      </section>

      {/* Notifications */}
      <section aria-labelledby={`${id}-h-notify`} className={`${section} gap-1.5`}>
        <h2 id={`${id}-h-notify`} className="mb-1.5 text-[17px] font-bold">
          การแจ้งเตือนทาง email
        </h2>
        {NOTIFY.map((n) => (
          <label
            key={n.name}
            className="flex min-h-14 cursor-pointer items-center gap-3.5 border-t border-border-soft py-1.5"
          >
            <span className="flex flex-1 flex-col">
              <span className="text-[15px]">{n.label}</span>
              <span className="text-xs text-subtle">{n.sub}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              name={n.name}
              defaultChecked={values[n.name]}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="relative h-7 w-12 flex-none rounded-full bg-white/16 transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent-hover peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg peer-checked:[&>span]:left-[23px]"
            >
              <span className="absolute top-[3px] left-[3px] size-[22px] rounded-full bg-white transition-[left]" />
            </span>
          </label>
        ))}
      </section>

      {dirty && (
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-white/10 bg-bg-elevated/92 backdrop-blur-lg sm:-mx-6">
          <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3 sm:px-6">
            <span className="text-sm text-soft">มีการแก้ไขที่ยังไม่บันทึก</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                className="btn btn-outline"
                onClick={() => {
                  formRef.current?.reset();
                  setBillingType(values.billingType);
                  setDirty(false);
                }}
              >
                ยกเลิก
              </button>
              <button type="submit" disabled={pending} className="btn btn-primary px-5 shadow-none">
                {pending && <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />}
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

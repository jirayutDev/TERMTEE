"use client";

import { startTransition, useActionState, useId, useState, type ReactNode } from "react";
import { BankIcon } from "@/components/ui/icons";
import { saveSettingsAction, type SettingsFormState } from "./actions";

// Client-safe copies of the section shapes (src/lib/settings.ts is server-only).
type Shop = { name: string; supportEmail: string | null; supportLine: string | null; supportPhone: string | null; supportHours: string | null };
type Payment = {
  promptPayId: string | null;
  displayName: string | null;
  displayBank: string | null;
  accounts: string[];
  names: string[];
  unpaidOrderTtlMinutes: number;
  rejectReasons: string[];
};
type Protection = { defaultReplayDays: number; watermarkShowEmail: boolean };
type Receipt = {
  issueReceipts: boolean;
  companyName: string | null;
  taxId: string | null;
  branch: string | null;
  address: string | null;
  vatRegistered: boolean;
};
type Policies = { terms: string; privacy: string };
type Section = "shop" | "payment" | "protection" | "receipt" | "policies";

const card = "glass-admin m-0 flex min-w-0 flex-col gap-[18px] rounded-lg p-[clamp(16px,2vw,24px)]";
const legend = "px-1.5 text-[15px] font-semibold";
const row = "flex flex-wrap gap-4 *:min-w-0 *:flex-[1_1_220px]";

type Err = (name: string) => string | undefined;

/**
 * Form shell: submits without React's automatic form reset (so values survive validation
 * errors), remounts the fields with fresh server values after a successful save, and shows
 * a sticky save bar once something was edited.
 */
function SettingsForm({
  section,
  children,
  onInput,
}: {
  section: Section;
  children: (err: Err) => ReactNode;
  onInput?: (target: HTMLInputElement) => void;
}) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(
    saveSettingsAction.bind(null, section),
    {},
  );
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState(state.savedAt);
  if (state.savedAt !== lastSaved) {
    // Reset "dirty" once per successful save (render-time state adjustment, no effect needed).
    setLastSaved(state.savedAt);
    setDirty(false);
  }
  const showSaved = !!state.savedAt;

  const err: Err = (name) => state.fieldErrors?.[name]?.[0];

  return (
    <form
      key={state.savedAt ?? 0}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      onInput={(e) => {
        setDirty(true);
        onInput?.(e.target as HTMLInputElement);
      }}
      onChange={() => setDirty(true)}
      className="flex flex-col gap-5"
    >
      {state.error && (
        <p role="alert" className="rounded-md border border-danger/45 bg-danger/10 p-3 text-sm text-[#FFC2CD]">
          {state.error}
        </p>
      )}
      {children(err)}
      <div
        className={`sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
          dirty ? "border-accent/50 bg-toast shadow-card" : "border-border bg-bg-elevated/80"
        }`}
      >
        <span role="status" className="text-[13px] text-muted">
          {dirty
            ? "มีการแก้ไขที่ยังไม่บันทึก · บันทึกแล้วมีผลกับลูกค้าทันที"
            : showSaved
              ? <span className="font-semibold text-success-fg">บันทึกแล้ว</span>
              : "บันทึกแล้วมีผลกับลูกค้าทันที"}
        </span>
        <button disabled={pending} className="btn btn-primary btn-sm min-h-11 px-6 shadow-none">
          {pending && <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />}
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (id: string, aria: { "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  const aria = error ? { "aria-invalid": true as const, "aria-describedby": msgId } : hint ? { "aria-describedby": msgId } : {};
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id, aria)}
      {error ? (
        <span id={msgId} className="text-xs text-danger-fg">
          {error}
        </span>
      ) : hint ? (
        <span id={msgId} className="text-xs leading-[18px] text-subtle">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function Toggle({
  name,
  label,
  sub,
  defaultChecked,
  onChange,
}: {
  name: string;
  label: string;
  sub?: string;
  defaultChecked: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        {sub && <span className="text-xs leading-[18px] text-muted">{sub}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          name={name}
          defaultChecked={defaultChecked}
          onChange={(e) => onChange?.(e.target.checked)}
          className="peer absolute inset-0 size-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden
          className="h-7 w-12 rounded-full bg-white/16 transition-colors peer-checked:bg-accent peer-focus-visible:ring-4 peer-focus-visible:ring-accent/30"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-[3px] left-[3px] size-[22px] rounded-full bg-white transition-transform peer-checked:translate-x-5"
        />
      </span>
    </label>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <legend className={legend}>
      {title}
      {sub && <span className="mt-0.5 block text-xs font-normal text-muted">{sub}</span>}
    </legend>
  );
}

const linesValue = (v: string[]) => v.join("\n");

// ---------- Shop ----------

export function ShopForm({ values }: { values: Shop }) {
  return (
    <SettingsForm section="shop">
      {(err) => (
        <fieldset className={card}>
          <SectionHead title="ข้อมูลร้าน" sub="ลูกค้าเห็นข้อมูลนี้ในหน้าแจ้งปัญหา ท้ายเว็บ และใน email" />
          <Field label="ชื่อร้าน / แบรนด์" error={err("name")}>
            {(id, a) => <input id={id} {...a} name="name" defaultValue={values.name} maxLength={80} required className="field" />}
          </Field>
          <div className={row}>
            <Field label="Email ซัพพอร์ต" hint="แสดงในหน้าแจ้งปัญหาและ email ทุกฉบับ" error={err("supportEmail")}>
              {(id, a) => (
                <input id={id} {...a} name="supportEmail" type="email" defaultValue={values.supportEmail ?? ""} placeholder="support@example.com" className="field" />
              )}
            </Field>
            <Field label="เบอร์ติดต่อ" error={err("supportPhone")}>
              {(id, a) => (
                <input id={id} {...a} name="supportPhone" type="tel" defaultValue={values.supportPhone ?? ""} placeholder="02-xxx-xxxx" className="field tabular" />
              )}
            </Field>
          </div>
          <div className={row}>
            <Field label="LINE OA / Facebook" hint="ไอดี LINE OA (เช่น @termtee) หรือ URL" error={err("supportLine")}>
              {(id, a) => <input id={id} {...a} name="supportLine" defaultValue={values.supportLine ?? ""} placeholder="@termtee" className="field" />}
            </Field>
            <Field label="เวลาทำการ (แสดงให้ลูกค้าเห็น)" error={err("supportHours")}>
              {(id, a) => (
                <input id={id} {...a} name="supportHours" defaultValue={values.supportHours ?? ""} placeholder="ทุกวัน 10:00–22:00" className="field" />
              )}
            </Field>
          </div>
        </fieldset>
      )}
    </SettingsForm>
  );
}

// ---------- Payment ----------

export function PaymentForm({ values }: { values: Payment }) {
  const [preview, setPreview] = useState({
    displayBank: values.displayBank ?? "",
    displayName: values.displayName ?? "",
    promptPayId: values.promptPayId ?? "",
  });
  return (
    <SettingsForm
      section="payment"
      onInput={(t) => {
        if (t.name in preview) setPreview((p) => ({ ...p, [t.name]: t.value }));
      }}
    >
      {(err) => (
        <>
          <div className="flex flex-wrap items-start gap-5">
            <fieldset className={`${card} flex-[999_1_420px]`}>
              <SectionHead title="บัญชีรับเงิน" sub="ลูกค้าเห็นบัญชีนี้ในหน้าชำระเงิน · เปลี่ยนแล้วมีผลกับคำสั่งซื้อใหม่ทันที" />
              <Field
                label="พร้อมเพย์ (สร้าง QR ยอดเงินอัตโนมัติ)"
                hint="เบอร์มือถือ 10 หลัก เลขประจำตัว 13 หลัก หรือ e-Wallet 15 หลัก · เว้นว่าง = ไม่แสดง QR"
                error={err("promptPayId")}
              >
                {(id, a) => (
                  <input id={id} {...a} name="promptPayId" inputMode="numeric" defaultValue={values.promptPayId ?? ""} className="field tabular font-mono" />
                )}
              </Field>
              <Field label="ธนาคาร / เลขบัญชี (ที่แสดง)" hint="ขึ้นบรรทัดใหม่ได้ เช่น ชื่อธนาคาร แล้วเลขบัญชี" error={err("displayBank")}>
                {(id, a) => (
                  <textarea id={id} {...a} name="displayBank" rows={2} defaultValue={values.displayBank ?? ""} placeholder={"กสิกรไทย\n123-4-56789-0"} className="field" />
                )}
              </Field>
              <Field label="ชื่อบัญชี (ที่แสดง)" error={err("displayName")}>
                {(id, a) => <input id={id} {...a} name="displayName" defaultValue={values.displayName ?? ""} placeholder="บจก. เทอมตี" className="field" />}
              </Field>
            </fieldset>

            <aside aria-label="ตัวอย่างที่ลูกค้าเห็น" className="glass flex min-w-0 flex-[1_1_260px] flex-col gap-3 rounded-lg p-5">
              <span className="text-xs font-semibold text-muted">ตัวอย่างที่ลูกค้าเห็น</span>
              <div className="flex items-center gap-3">
                <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-white/8 text-accent-fg">
                  <BankIcon size={26} />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-base font-semibold break-words whitespace-pre-line">{preview.displayBank || "[ธนาคาร / เลขบัญชี]"}</span>
                  <span className="text-[13px] text-muted">ชื่อบัญชี {preview.displayName || "[ชื่อบัญชี]"}</span>
                </div>
              </div>
              <span className="text-[13px] text-muted">
                พร้อมเพย์ <span className="tabular font-mono text-fg">{preview.promptPayId || "— ไม่แสดง QR"}</span>
              </span>
            </aside>
          </div>

          <fieldset className={card}>
            <SectionHead title="การตรวจสลิป" sub="สลิปที่โอนเข้าบัญชี/ชื่ออื่นนอกจากนี้จะไม่ผ่านการตรวจอัตโนมัติ" />
            <div className={row}>
              <Field label="เลขบัญชี / พร้อมเพย์ที่รับเงิน" hint="หนึ่งบรรทัดต่อหนึ่งบัญชี" error={err("accounts")}>
                {(id, a) => (
                  <textarea id={id} {...a} name="accounts" rows={4} defaultValue={linesValue(values.accounts)} placeholder={"123-4-56789-0\n0812345678"} className="field tabular font-mono" />
                )}
              </Field>
              <Field label="ชื่อผู้รับที่ยอมรับ" hint="ชื่อตามที่พิมพ์บนสลิป ไทยและ/หรืออังกฤษ หนึ่งบรรทัดต่อหนึ่งชื่อ" error={err("names")}>
                {(id, a) => (
                  <textarea id={id} {...a} name="names" rows={4} defaultValue={linesValue(values.names)} placeholder={"บจก. เทอมตี\nTERMTEE CO., LTD."} className="field" />
                )}
              </Field>
            </div>
            <Field
              label="ยกเลิกคำสั่งซื้อที่ไม่ส่งสลิปภายใน (นาที)"
              hint="0 = ไม่ยกเลิกอัตโนมัติ · ไม่ยกเลิกคำสั่งซื้อที่มีสลิปรอตรวจ"
              error={err("unpaidOrderTtlMinutes")}
            >
              {(id, a) => (
                <input
                  id={id}
                  {...a}
                  name="unpaidOrderTtlMinutes"
                  type="number"
                  min={0}
                  max={10080}
                  step={1}
                  defaultValue={values.unpaidOrderTtlMinutes}
                  className="field tabular max-w-[220px]"
                />
              )}
            </Field>
            <Field label="เหตุผลปฏิเสธสลิป (ตัวเลือกในหน้าตรวจสลิป)" hint="หนึ่งบรรทัดต่อหนึ่งเหตุผล · ลูกค้าจะเห็นเหตุผลที่เลือก" error={err("rejectReasons")}>
              {(id, a) => <textarea id={id} {...a} name="rejectReasons" rows={6} defaultValue={linesValue(values.rejectReasons)} className="field" />}
            </Field>
          </fieldset>
        </>
      )}
    </SettingsForm>
  );
}

// ---------- Protection ----------

export function ProtectionForm({ values }: { values: Protection }) {
  const [showEmail, setShowEmail] = useState(values.watermarkShowEmail);
  return (
    <SettingsForm section="protection">
      {(err) => (
        <>
          <fieldset className={card}>
            <SectionHead title="การดู" sub="ค่าเริ่มต้นของ event ใหม่ · แต่ละ event ปรับเองได้ในหน้าแก้ไข" />
            <Field label="ดูย้อนหลังค่าเริ่มต้น (วัน)" hint="0 = ไม่มี replay" error={err("defaultReplayDays")}>
              {(id, a) => (
                <input
                  id={id}
                  {...a}
                  name="defaultReplayDays"
                  type="number"
                  min={0}
                  max={365}
                  step={1}
                  defaultValue={values.defaultReplayDays}
                  className="field tabular max-w-[220px]"
                />
              )}
            </Field>
          </fieldset>
          <fieldset className={card}>
            <SectionHead title="ลายน้ำ" sub="แสดงบน player ตลอดเวลา ย้ายตำแหน่งแบบสุ่มทุก 5–10 วินาที" />
            <Toggle
              name="watermarkShowEmail"
              label="แสดง email คนดูบนลายน้ำ"
              sub="ปิดแล้วจะเหลือรหัสคนดูและเวลา (ยังสืบย้อนได้จากหน้าคนดูขณะนี้)"
              defaultChecked={values.watermarkShowEmail}
              onChange={setShowEmail}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted">ตัวอย่าง</span>
              <div className="relative aspect-[16/6] overflow-hidden rounded-md bg-stage">
                <div
                  className="absolute top-[30%] left-[12%] font-mono text-[12px] leading-[1.4] whitespace-nowrap text-white/45"
                  style={{ textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
                >
                  {showEmail && <div>viewer@email.com</div>}
                  <div>#a1b2c3d4 · 2026-10-06 20:41:07</div>
                </div>
              </div>
            </div>
          </fieldset>
        </>
      )}
    </SettingsForm>
  );
}

// ---------- Receipt ----------

export function ReceiptForm({ values }: { values: Receipt }) {
  return (
    <SettingsForm section="receipt">
      {(err) => (
        <fieldset className={card}>
          <SectionHead title="ใบเสร็จและภาษี" sub="ใช้เป็นหัวใบเสร็จที่ลูกค้าโหลดจากประวัติการซื้อ" />
          <Toggle name="issueReceipts" label="ออกใบเสร็จให้ลูกค้า" sub="ปิดไว้ = ลูกค้าไม่เห็นปุ่มโหลดใบเสร็จ" defaultChecked={values.issueReceipts} />
          <div className={row}>
            <Field label="ชื่อนิติบุคคล" error={err("companyName")}>
              {(id, a) => <input id={id} {...a} name="companyName" defaultValue={values.companyName ?? ""} placeholder="บริษัท เทอมตี จำกัด" className="field" />}
            </Field>
            <Field label="เลขประจำตัวผู้เสียภาษี" hint="13 หลัก" error={err("taxId")}>
              {(id, a) => (
                <input id={id} {...a} name="taxId" inputMode="numeric" defaultValue={values.taxId ?? ""} className="field tabular font-mono" />
              )}
            </Field>
          </div>
          <Field label="สาขา" hint="เช่น สำนักงานใหญ่ หรือ 00001" error={err("branch")}>
            {(id, a) => <input id={id} {...a} name="branch" defaultValue={values.branch ?? ""} placeholder="สำนักงานใหญ่" className="field max-w-[320px]" />}
          </Field>
          <Field label="ที่อยู่" error={err("address")}>
            {(id, a) => <textarea id={id} {...a} name="address" rows={3} defaultValue={values.address ?? ""} className="field" />}
          </Field>
          <Toggle
            name="vatRegistered"
            label="จดทะเบียน VAT"
            sub="ราคาตั๋วรวม VAT 7% แล้ว · ใบเสร็จแยกยอด VAT ให้"
            defaultChecked={values.vatRegistered}
          />
        </fieldset>
      )}
    </SettingsForm>
  );
}

// ---------- Policies ----------

export function PoliciesForm({ values }: { values: Policies }) {
  return (
    <SettingsForm section="policies">
      {(err) => (
        <fieldset className={card}>
          <SectionHead title="นโยบาย (ลิงก์ท้ายเว็บ)" sub="ข้อความธรรมดา เว้นบรรทัดว่างเพื่อขึ้นย่อหน้าใหม่ · เว้นว่าง = แสดงว่ายังไม่ได้เผยแพร่" />
          <Field
            label="เงื่อนไขการใช้งาน"
            hint={
              <>
                แสดงที่{" "}
                <a href="/terms" target="_blank" className="link">
                  /terms ↗
                </a>
              </>
            }
            error={err("terms")}
          >
            {(id, a) => <textarea id={id} {...a} name="terms" rows={14} defaultValue={values.terms} className="field text-sm" />}
          </Field>
          <Field
            label="นโยบายความเป็นส่วนตัว"
            hint={
              <>
                แสดงที่{" "}
                <a href="/privacy" target="_blank" className="link">
                  /privacy ↗
                </a>
              </>
            }
            error={err("privacy")}
          >
            {(id, a) => <textarea id={id} {...a} name="privacy" rows={14} defaultValue={values.privacy} className="field text-sm" />}
          </Field>
        </fieldset>
      )}
    </SettingsForm>
  );
}

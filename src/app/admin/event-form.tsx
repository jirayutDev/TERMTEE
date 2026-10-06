"use client";

import Link from "next/link";
import { useActionState, useId, useState, type ReactNode } from "react";
import type { EventFormState } from "./actions";
import { isPushInput, type InputType } from "@/lib/media/types";

const INPUTS: { value: InputType; label: string; hint: string }[] = [
  { value: "SRT", label: "SRT", hint: "ส่งสัญญาณจาก encoder ผ่าน SRT (push) · URL ingest จะได้หลังกด Start live" },
  { value: "RTMP", label: "RTMP", hint: "ส่งสัญญาณจาก OBS / encoder ผ่าน RTMP (push) · URL ingest จะได้หลังกด Start live" },
  { value: "HLS", label: "HLS", hint: "ดึงสัญญาณจาก HLS ที่มีอยู่แล้ว (pull)" },
  { value: "DASH", label: "DASH", hint: "ดึงสัญญาณจาก DASH ที่มีอยู่แล้ว (pull)" },
  { value: "RTSP", label: "RTSP", hint: "ดึงสัญญาณจากกล้อง / RTSP server (pull)" },
  {
    value: "BROWSER",
    label: "จับภาพหน้าเว็บ",
    hint: "เปิดหน้าเว็บด้วย Chromium แล้วจับภาพ · ภาพถูก encode ใหม่ ชัดน้อยกว่าดึง feed ตรง · หน้าที่มี DRM จะจับภาพไม่ได้ · ยังไม่รองรับหน้าที่ต้อง login",
  },
];

const URL_FIELD: Record<InputType, { label: string; placeholder: string }> = {
  SRT: { label: "URL ต้นทาง (ไม่ใช้กับ SRT)", placeholder: "" },
  RTMP: { label: "URL ต้นทาง (ไม่ใช้กับ RTMP)", placeholder: "" },
  HLS: { label: "HLS URL", placeholder: "https://…/index.m3u8" },
  DASH: { label: "DASH URL", placeholder: "https://…/manifest.mpd" },
  RTSP: { label: "RTSP URL", placeholder: "rtsp://host:554/stream" },
  BROWSER: { label: "URL หน้าเว็บที่จะจับภาพ", placeholder: "https://…/player" },
};

export type EventFormValues = {
  title: string;
  slug: string;
  description: string;
  coverUrl: string;
  priceThb: string;
  startsAt: string; // datetime-local value, Bangkok time
  replayDays: string;
  inputType: InputType;
  inputUrl: string;
  status: string;
};

const fieldset = "glass-admin m-0 flex flex-col gap-[18px] rounded-lg p-[clamp(16px,2vw,24px)]";
const legend = "px-1.5 text-[15px] font-semibold";

export default function EventForm({
  action,
  initial: initialProp,
  submitLabel,
  cancelHref,
  statusEditable = true,
  mediaEditable = true,
}: {
  action: (prev: EventFormState, formData: FormData) => Promise<EventFormState>;
  initial: EventFormValues;
  submitLabel: string;
  cancelHref: string;
  statusEditable?: boolean;
  mediaEditable?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  // React resets the form after an action; re-seed defaults with what was submitted on validation errors.
  const initial = { ...initialProp, ...(state.values as Partial<EventFormValues> | undefined) };
  const [inputType, setInputType] = useState(initialProp.inputType);
  const [preview, setPreview] = useState({
    title: initial.title,
    priceThb: initial.priceThb,
    startsAt: initial.startsAt,
    coverUrl: initial.coverUrl,
  });
  const err = (k: string) => state.fieldErrors?.[k]?.[0];
  const inputHint = INPUTS.find((i) => i.value === inputType)?.hint;

  return (
    <form
      action={formAction}
      onInput={(e) => {
        const t = e.target as HTMLInputElement;
        if (t.name in preview) setPreview((p) => ({ ...p, [t.name]: t.value }));
      }}
      className="flex flex-wrap items-start gap-6"
    >
      <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-5">
        {state.error && (
          <p role="alert" className="rounded-md border border-danger/45 bg-danger/10 p-3 text-sm text-[#FFC2CD]">
            {state.error}
          </p>
        )}

        <fieldset className={fieldset}>
          <legend className={legend}>ข้อมูล event</legend>
          <Field label="ชื่อ event" error={err("title")}>
            {(id, a) => <input id={id} {...a} name="title" defaultValue={initial.title} required className="field" />}
          </Field>
          <Field label="Slug (ใช้ใน URL)" hint="a-z, 0-9 และ - เท่านั้น เช่น concert-2026" error={err("slug")}>
            {(id, a) => (
              <div className="field flex items-center gap-1 px-0! focus-within:border-accent-hover focus-within:shadow-[0_0_0_4px_rgba(43,92,255,0.22)]">
                <span className="pl-3.5 font-mono text-[13px] text-subtle">/events/</span>
                <input
                  id={id}
                  {...a}
                  name="slug"
                  defaultValue={initial.slug}
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  className="h-[42px] min-w-0 flex-1 bg-transparent pr-3.5 font-mono text-[13px] outline-none"
                />
              </div>
            )}
          </Field>
          <Field label="คำอธิบาย" error={err("description")}>
            {(id, a) => (
              <textarea
                id={id}
                {...a}
                name="description"
                defaultValue={initial.description}
                rows={5}
                placeholder="รายละเอียดที่คนดูจะเห็นในหน้า event"
                className="field"
              />
            )}
          </Field>
          <Field label="Cover URL" hint="แนะนำ 1920×1080 (16:9)" error={err("coverUrl")}>
            {(id, a) => (
              <input
                id={id}
                {...a}
                name="coverUrl"
                type="url"
                defaultValue={initial.coverUrl}
                placeholder="https://…/cover.jpg"
                className="field font-mono text-[13px]"
              />
            )}
          </Field>
        </fieldset>

        <fieldset className={`${fieldset} grid! grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))]`}>
          <legend className={legend}>ราคาและเวลา</legend>
          <Field label="ราคา (บาท)" error={err("priceThb")}>
            {(id, a) => (
              <div className="field flex items-center px-0! focus-within:border-accent-hover focus-within:shadow-[0_0_0_4px_rgba(43,92,255,0.22)]">
                <span className="pl-3.5 text-muted">฿</span>
                <input
                  id={id}
                  {...a}
                  name="priceThb"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={initial.priceThb}
                  required
                  className="h-[42px] min-w-0 flex-1 bg-transparent px-2.5 font-medium outline-none"
                />
              </div>
            )}
          </Field>
          <Field label="วันเวลาเริ่ม (เวลาไทย)" error={err("startsAt")}>
            {(id, a) => (
              <input id={id} {...a} name="startsAt" type="datetime-local" defaultValue={initial.startsAt} required className="field" />
            )}
          </Field>
          <Field label="ดูย้อนหลังได้ (วัน)" hint="0 = ไม่มี replay" error={err("replayDays")}>
            {(id, a) => (
              <input
                id={id}
                {...a}
                name="replayDays"
                type="number"
                min="0"
                max="365"
                step="1"
                defaultValue={initial.replayDays}
                required
                className="field font-medium"
              />
            )}
          </Field>
        </fieldset>

        {/* Disabled fields are not submitted, so mirror the values in hidden inputs (outside the fieldset). */}
        {!mediaEditable && (
          <>
            <input type="hidden" name="inputType" value={inputType} />
            <input type="hidden" name="inputUrl" value={initial.inputUrl} />
          </>
        )}
        <fieldset className={fieldset} disabled={!mediaEditable}>
          <legend className={legend}>Stream input</legend>
          <div role="radiogroup" aria-label="ประเภท input" className="flex flex-wrap gap-1 self-start rounded-md border border-white/10 bg-bg/60 p-1">
            {INPUTS.map((i) => (
              <label
                key={i.value}
                className={`inline-flex min-h-9 cursor-pointer items-center rounded-sm px-4 text-[13px] has-focus-visible:outline-2 has-focus-visible:outline-link ${
                  inputType === i.value ? "bg-accent font-semibold text-white" : "text-muted hover:text-fg"
                } ${!mediaEditable ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <input
                  type="radio"
                  name={mediaEditable ? "inputType" : undefined}
                  value={i.value}
                  checked={inputType === i.value}
                  onChange={() => setInputType(i.value)}
                  className="sr-only"
                />
                {i.label}
              </label>
            ))}
          </div>
          {err("inputType") && <span className="text-xs text-danger-fg">{err("inputType")}</span>}
          <span className="text-[13px] text-muted">
            {mediaEditable ? inputHint : "เปลี่ยน input ระหว่าง live ไม่ได้"}
          </span>
          {!isPushInput(inputType) && (
            <Field label={URL_FIELD[inputType].label} error={err("inputUrl")}>
              {(id, a) => (
                <input
                  id={id}
                  {...a}
                  name={mediaEditable ? "inputUrl" : undefined}
                  type="url"
                  defaultValue={initial.inputUrl}
                  required={mediaEditable}
                  placeholder={URL_FIELD[inputType].placeholder}
                  className="field font-mono text-[13px]"
                />
              )}
            </Field>
          )}
          {isPushInput(inputType) && err("inputUrl") && (
            <span className="text-xs text-danger-fg">{err("inputUrl")}</span>
          )}
        </fieldset>
      </div>

      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
        <div className="glass-admin flex flex-col gap-3 rounded-lg p-5">
          <span className="text-[13px] font-semibold text-muted">Preview การ์ด</span>
          <div className="flex flex-col overflow-hidden rounded-[14px] border border-border bg-panel">
            <div
              className="relative grid aspect-video place-items-center text-xs text-white/35"
              style={{ background: "linear-gradient(135deg,#3B2470,#1B2A6B 60%,#0B1033)" }}
            >
              {/^https?:\/\//.test(preview.coverUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                "ยังไม่มี cover"
              )}
            </div>
            <div className="flex flex-col gap-1 p-3">
              <span className="text-[15px] font-semibold">{preview.title || "ชื่อ event"}</span>
              <span className="text-xs text-muted">{preview.startsAt.replace("T", " · ")} น.</span>
              <span className="tabular text-base font-bold">฿{Number(preview.priceThb || 0).toLocaleString("th-TH")}</span>
            </div>
          </div>
        </div>

        <fieldset className="glass-admin m-0 flex flex-col gap-2.5 rounded-lg p-5">
          <legend className={legend}>สถานะ</legend>
          {statusEditable ? (
            <>
              <StatusOption value="DRAFT" title="Draft" sub="ยังไม่แสดงบนหน้าเว็บ ยังไม่ขาย" defaultChecked={initial.status !== "SCHEDULED"} />
              <StatusOption value="SCHEDULED" title="เปิดขาย" sub="แสดงในหน้าแรกและซื้อตั๋วได้ทันที" defaultChecked={initial.status === "SCHEDULED"} />
            </>
          ) : (
            <>
              <input type="hidden" name="status" value="SCHEDULED" />
              <p className="text-sm">
                <span className="font-semibold">{initial.status}</span>
                <span className="block text-xs text-muted">สถานะถูกควบคุมโดยเซิร์ฟเวอร์สื่อแล้ว</span>
              </p>
            </>
          )}
          {err("status") && <span className="text-xs text-danger-fg">{err("status")}</span>}
        </fieldset>

        <div className="flex gap-2.5">
          <Link href={cancelHref} className="btn btn-outline flex-1">
            ยกเลิก
          </Link>
          <button disabled={pending} className="btn btn-primary flex-1 shadow-none">
            {pending && <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />}
            {pending ? "กำลังบันทึก…" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

function StatusOption({
  value,
  title,
  sub,
  defaultChecked,
}: {
  value: string;
  title: string;
  sub: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-white/12 p-3 has-checked:border-[1.5px] has-checked:border-accent-hover has-checked:bg-accent/10">
      <input type="radio" name="status" value={value} defaultChecked={defaultChecked} className="mt-0.5 size-[18px] accent-accent" />
      <span className="flex flex-col">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted">{sub}</span>
      </span>
    </label>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
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
        <span id={msgId} className="text-xs text-subtle">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

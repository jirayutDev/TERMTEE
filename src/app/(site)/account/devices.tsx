"use client";

import { useId, useState, useTransition } from "react";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { LaptopIcon, PhoneIcon } from "@/components/ui/icons";
import { signOutDeviceAction, signOutOtherDevicesAction, type DeviceActionResult } from "./actions";
import { Toast, type ToastMsg } from "./toast";

export type DeviceRow = {
  ref: string; // sessionRef(), not the token
  label: string;
  kind: "phone" | "tablet" | "desktop";
  meta: string;
  current: boolean;
};

export default function Devices({ devices }: { devices: DeviceRow[] }) {
  const id = useId();
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const others = devices.filter((d) => !d.current).length;

  const show = (r: DeviceActionResult) => setToast({ text: r.message, tone: r.ok ? "ok" : "error", at: Date.now() });

  return (
    <section aria-labelledby={`${id}-h`} className="glass-admin flex flex-col gap-3 rounded-[20px] p-[clamp(16px,2vw,24px)]">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id={`${id}-h`} className="text-[17px] font-bold">
            เครื่องที่ login อยู่
          </h2>
          <span className="text-[13px] text-muted">ดู live ได้ทีละ 1 เครื่องต่อตั๋ว</span>
        </div>
        {others > 0 && (
          <ConfirmDialog
            action={async () => show(await signOutOtherDevicesAction())}
            trigger="ออกจากระบบเครื่องอื่นทั้งหมด"
            triggerClassName="btn btn-sm btn-outline"
            title="ออกจากระบบเครื่องอื่นทั้งหมด?"
            body={`เครื่องอื่น ${others.toLocaleString("th-TH")} เครื่องจะต้อง login ใหม่ · เครื่องนี้ยังใช้งานได้ตามปกติ`}
            confirmLabel="ออกจากระบบ"
          />
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {devices.map((d) => {
          const Icon = d.kind === "desktop" ? LaptopIcon : PhoneIcon;
          const busy = pending && busyRef === d.ref;
          return (
            <li key={d.ref} className="flex items-center gap-3 rounded-[14px] bg-bg/50 p-3">
              <span className="grid size-10 flex-none place-items-center rounded-xl bg-accent-soft text-accent-fg">
                <Icon size={20} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold">{d.label}</span>
                <span className="tabular text-xs text-muted">{d.meta}</span>
              </div>
              {d.current ? (
                <span className="badge badge-sm badge-success">เครื่องนี้</span>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`ออกจากระบบ ${d.label}`}
                  className="btn btn-sm btn-ghost text-danger-fg"
                  onClick={() => {
                    setBusyRef(d.ref);
                    startTransition(async () => show(await signOutDeviceAction(d.ref)));
                  }}
                >
                  {busy && <span className="spin size-4 rounded-full border-2 border-white/35 border-t-white" aria-hidden />}
                  ออกจากระบบ
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <Toast toast={toast} />
    </section>
  );
}

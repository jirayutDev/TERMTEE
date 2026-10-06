"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { detectDrmSupport } from "@/components/player/drm-support";
import { BanIcon, CheckIcon } from "@/components/ui/icons";

export type DeviceState = "checking" | "supported" | "unsupported";

const LABEL: Record<string, string> = {
  FairPlay: "Apple FairPlay",
  PlayReady: "Microsoft PlayReady",
  Widevine: "Google Widevine L1",
};

/** Detects whether this browser has hardware DRM (same probe the player uses). */
export function useDeviceSupport(): { state: DeviceState; system: string | null } {
  const [state, setState] = useState<DeviceState>("checking");
  const [system, setSystem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    detectDrmSupport().then((s) => {
      if (!alive) return;
      setSystem(s ? LABEL[s.system] : null);
      setState(s ? "supported" : "unsupported");
    });
    return () => {
      alive = false;
    };
  }, []);

  return { state, system };
}

/** Device check box (3 states). Always shown before the buy button. */
export function DeviceCheckBox({ state, system }: { state: DeviceState; system: string | null }) {
  const pathname = usePathname();

  if (state === "checking") {
    return (
      <div role="status" className="flex items-center gap-3.5 rounded-[14px] border border-white/10 bg-white/[0.04] p-3.5">
        <span className="spin size-[22px] shrink-0 rounded-full border-[2.5px] border-white/18 border-t-link" aria-hidden />
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold">กำลังเช็กเครื่องของคุณ…</span>
          <span className="text-[13px] text-muted">ใช้เวลาไม่กี่วินาที</span>
        </div>
      </div>
    );
  }

  if (state === "supported") {
    return (
      <div role="status" className="flex items-center gap-3 rounded-[14px] border border-success/40 bg-success/10 p-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success text-[#06231A]">
          <CheckIcon size={20} />
        </span>
        <div className="flex flex-col">
          <span className="text-base font-bold text-success-fg">เครื่องนี้รองรับ</span>
          <span className="text-[13px] text-soft">
            {system ? `ระบบป้องกัน ${system} · ` : ""}ดูได้ทันทีที่สลิปผ่านการตรวจ
          </span>
        </div>
      </div>
    );
  }

  return (
    <div role="status" className="flex items-start gap-3 rounded-[14px] border border-danger/45 bg-danger/10 p-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger text-[#2A0710]">
        <BanIcon size={20} />
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-base font-bold text-danger-fg">เครื่องนี้ดูไม่ได้</span>
        <span className="text-[13px] leading-5 text-soft">
          browser นี้ยังไม่รองรับระบบกันอัดหน้าจอ ซื้อตอนนี้จะดูบนเครื่องนี้ไม่ได้
        </span>
        <Link
          href={`/unsupported?next=${encodeURIComponent(pathname)}`}
          className="link inline-flex min-h-8 items-center text-sm"
        >
          ดูว่าเครื่องไหนดูได้ →
        </Link>
      </div>
    </div>
  );
}

/** Self-contained device check. */
export default function DeviceCheck() {
  const { state, system } = useDeviceSupport();
  return <DeviceCheckBox state={state} system={system} />;
}

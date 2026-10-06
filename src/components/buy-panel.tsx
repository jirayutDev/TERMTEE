"use client";

import Link from "next/link";
import BuyButton from "@/components/buy-button";
import { DeviceCheckBox, useDeviceSupport } from "@/components/device-check";
import { PlayIcon } from "@/components/ui/icons";

export type BuyCta =
  | { kind: "buy"; eventId: string; label: string }
  | { kind: "login"; label: string }
  | { kind: "watch"; href: string }
  | { kind: "wait"; href: string }
  | { kind: "disabled"; label: string };

/** Sticky buy box on the event page: device check → price → CTA → note. */
export default function BuyPanel({
  price,
  cta,
  note,
  signInAction,
  callbackUrl,
}: {
  price: string;
  cta: BuyCta;
  note: string;
  signInAction: (formData: FormData) => Promise<void>;
  callbackUrl: string;
}) {
  const { state, system } = useDeviceSupport();
  const needsDevice = cta.kind === "buy" || cta.kind === "login";
  const blocked = needsDevice && state !== "supported";
  const blockedLabel = state === "checking" ? "กำลังเช็กเครื่อง…" : "เครื่องนี้ซื้อไม่ได้";

  return (
    <section
      aria-label="ซื้อตั๋ว"
      className="glass-strong flex min-w-0 flex-[1_1_340px] flex-col gap-3.5 rounded-xl p-[clamp(16px,1.6vw,24px)] shadow-card min-[980px]:sticky min-[980px]:top-[84px]"
    >
      <DeviceCheckBox state={state} system={system} />

      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-xs text-muted">ราคาตั๋ว</span>
          <span className="tabular text-[32px] leading-10 font-bold">{price}</span>
        </div>
        <span className="text-right text-xs text-muted">โอนเงิน + แนบสลิป</span>
      </div>

      {blocked ? (
        <button type="button" disabled className="btn btn-lg w-full">
          {blockedLabel}
        </button>
      ) : cta.kind === "buy" ? (
        <BuyButton eventId={cta.eventId} label={cta.label} />
      ) : cta.kind === "login" ? (
        <form action={signInAction}>
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <button className="btn btn-lg btn-primary w-full">{cta.label}</button>
        </form>
      ) : cta.kind === "watch" ? (
        <Link href={cta.href} className="btn btn-lg btn-primary w-full">
          <PlayIcon size={18} />
          ดูเลย
        </Link>
      ) : cta.kind === "wait" ? (
        <Link href={cta.href} className="btn btn-lg btn-secondary w-full">
          เปิดหน้ารอ live
        </Link>
      ) : (
        <button type="button" disabled className="btn btn-lg w-full">
          {cta.label}
        </button>
      )}

      {note && <p className="text-center text-xs leading-[18px] text-muted">{note}</p>}
    </section>
  );
}

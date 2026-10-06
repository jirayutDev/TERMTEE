import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { safeCallback } from "@/lib/safe-redirect";
import OpenElsewhere from "@/components/open-elsewhere";
import { CheckIcon, LaptopIcon, MonitorIcon, PhoneIcon, ShieldPlayIcon } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "เครื่องที่รองรับ",
};

const OPTIONS: { browser: string; on: string; icon: ReactNode }[] = [
  { browser: "Safari", on: "Mac · iPhone · iPad (เวอร์ชันล่าสุด)", icon: <PhoneIcon size={24} /> },
  { browser: "Microsoft Edge", on: "Windows · แนะนำ รองรับ PlayReady แบบฮาร์ดแวร์", icon: <LaptopIcon size={24} /> },
  { browser: "Chrome", on: "Android ที่รองรับ Widevine L1", icon: <PhoneIcon size={24} /> },
  {
    browser: "Chrome",
    on: "Windows บางรุ่น · การ์ดจอต้องถอดรหัสแบบปลอดภัยได้ · ระบบจะเช็กให้ก่อนซื้อ",
    icon: <LaptopIcon size={24} />,
  },
];

export default async function UnsupportedPage({ searchParams }: PageProps<"/unsupported">) {
  const sp = await searchParams;
  const next = safeCallback(sp.next, "/library");

  return (
    <div
      className="mx-auto flex w-full max-w-[880px] flex-col gap-[clamp(24px,3vw,36px)] px-4 pt-[clamp(28px,4vw,56px)] pb-10 sm:px-6"
    >
      <div className="flex flex-col items-center gap-3.5 text-center">
        <span className="grid size-20 place-items-center rounded-2xl border border-accent/32 bg-accent/14 text-link">
          <ShieldPlayIcon size={40} />
        </span>
        <h1 className="text-[clamp(26px,1.2vw+21px,36px)] leading-[1.35] font-bold">เครื่องนี้ยังดูไม่ได้</h1>
        <p className="max-w-[56ch] text-[clamp(15px,0.2vw+14px,17px)] leading-[1.7] text-soft">
          เพื่อป้องกันการอัดหน้าจอ ต้องดูผ่านเครื่องหรือ browser ที่มีระบบป้องกันเนื้อหาแบบฮาร์ดแวร์ (Hardware DRM)
          เท่านั้น เปิดลิงก์นี้ในเครื่องด้านล่างได้เลย ตั๋วของคุณไม่หายไปไหน
        </p>
      </div>

      <section aria-labelledby="ok-h" className="flex flex-col gap-3">
        <h2 id="ok-h" className="text-[17px] leading-[26px] font-bold">
          เครื่องที่ดูได้
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3">
          {OPTIONS.map((o) => (
            <li key={`${o.browser}-${o.on}`} className="glass flex items-center gap-3.5 rounded-lg p-3.5">
              <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-accent-soft text-accent-fg">
                {o.icon}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-base font-semibold">{o.browser}</span>
                <span className="text-[13px] leading-5 text-muted">{o.on}</span>
              </div>
              <CheckIcon size={20} className="shrink-0 text-success" aria-label="รองรับ" />
            </li>
          ))}
          <li className="flex items-center gap-3.5 rounded-lg border border-dashed border-white/18 p-3.5">
            <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-glow/16 text-replay">
              <MonitorIcon size={24} />
            </span>
            <div className="flex flex-1 flex-col">
              <span className="text-base font-semibold">แอป Desktop</span>
              <span className="text-[13px] text-muted">Windows และ Mac</span>
            </div>
            <span className="badge badge-soon">เร็วๆ นี้</span>
          </li>
        </ul>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-5 text-muted">
          <li>หากต่อจอภายนอก จอและสายเชื่อมต่อต้องรองรับ HDCP 2.2 ขึ้นไป</li>
          <li>Firefox, browser ในแอปต่าง ๆ (เช่น LINE, Facebook) และ Chrome บน Linux ยังไม่รองรับ</li>
        </ul>
      </section>

      <OpenElsewhere path={next} />

      <Link href="/" className="btn btn-ghost self-center">
        กลับหน้าแรก
      </Link>
    </div>
  );
}

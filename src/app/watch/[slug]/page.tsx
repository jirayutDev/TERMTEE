import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { checkAccess, replayExpiresAt } from "@/lib/access";
import { formatBaht, formatEventDate, formatShortDate } from "@/lib/format";
import { loginUrl } from "@/lib/safe-redirect";
import { getSettingsSection } from "@/lib/settings";
import Player from "@/components/player/Player";
import { LiveBadge } from "@/components/ui/primitives";
import { ChevronLeftIcon, ClockIcon, PhoneIcon, RotateIcon, TicketIcon } from "@/components/ui/icons";
import Countdown from "./countdown";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function WatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const user = await currentUser();
  if (!user) {
    redirect(loginUrl(`/watch/${slug}`));
  }

  const event = await db.event.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      manifestUrl: true,
      startsAt: true,
      status: true,
      endedAt: true,
      replayDays: true,
      priceSatang: true,
    },
  });
  if (!event) notFound();

  const access = await checkAccess(user.id, event.id);
  // /admin/settings → การดูและการป้องกัน: hide the email in the watermark (viewer code stays).
  const { watermarkShowEmail } = await getSettingsSection("protection");
  const replayEnd = replayExpiresAt(event.endedAt, event.replayDays);

  const subline =
    event.status === "LIVE"
      ? `LIVE · เริ่ม ${formatEventDate(event.startsAt)}`
      : event.status === "ENDED" && replayEnd
        ? `Replay · ดูย้อนหลังได้ถึง ${formatEventDate(replayEnd)}`
        : `เริ่ม ${formatEventDate(event.startsAt)}`;

  let stage: ReactNode;
  if (access.ok) {
    stage = event.manifestUrl ? (
      <Player
        eventId={event.id}
        mode={access.mode}
        manifestUrl={event.manifestUrl}
        viewerEmail={watermarkShowEmail ? user.email : ""}
        viewerId={user.id}
        replayUntil={access.replayExpiresAt ? formatShortDate(access.replayExpiresAt) : null}
      />
    ) : access.mode === "replay" ? (
      <StateCard>
        <span className="badge badge-replay">Live จบแล้ว</span>
        <span className="text-base font-bold">กำลังเตรียม replay</span>
        <span className="text-[13px] text-muted">รีเฟรชหน้านี้อีกครั้งในอีกสักครู่</span>
      </StateCard>
    ) : (
      <StateCard>
        <span className="spin size-10 rounded-full border-[3px] border-white/14 border-t-accent-hover" aria-hidden />
        <span className="text-[15px] font-semibold">กำลังเตรียมสัญญาณ…</span>
        <span className="text-[13px] text-muted">สตรีมยังไม่พร้อม กรุณารีเฟรชหน้านี้ในอีกสักครู่</span>
      </StateCard>
    );
  } else {
    switch (access.reason) {
      case "not_started":
        stage = (
          <StateCard glow>
            <Countdown startsAt={event.startsAt.toISOString()} label={formatEventDate(event.startsAt)} />
          </StateCard>
        );
        break;
      case "no_ticket":
        stage = (
          <StateCard>
            <TicketIcon size={34} className="text-link" />
            <span className="text-base font-bold">คุณยังไม่มีตั๋วสำหรับ event นี้</span>
            <Link href={`/events/${event.slug}`} className="btn btn-primary shadow-none">
              ซื้อตั๋ว · {formatBaht(event.priceSatang)}
            </Link>
          </StateCard>
        );
        break;
      case "revoked":
        stage = (
          <StateCard>
            <span className="badge badge-danger">ถูกยกเลิก</span>
            <span className="text-base font-bold">ตั๋วนี้ถูกยกเลิกแล้ว</span>
            <span className="text-[13px] leading-5 text-muted">หากคิดว่าเกิดข้อผิดพลาด กรุณาติดต่อทีมงาน</span>
            <Link href="/library" className="btn btn-outline">
              กลับไปตั๋วของฉัน
            </Link>
          </StateCard>
        );
        break;
      case "replay_expired":
      case "archived":
        stage = (
          <StateCard>
            <ClockIcon size={34} className="text-muted" />
            <span className="text-base font-bold">
              {access.reason === "archived" ? "รายการนี้ถูกนำออกแล้ว" : "หมดเวลาดูย้อนหลังแล้ว"}
            </span>
            {replayEnd && <span className="text-[13px] text-muted">สิ้นสุดเมื่อ {formatEventDate(replayEnd)}</span>}
            <Link href="/" className="btn btn-outline">
              ดู event อื่น
            </Link>
          </StateCard>
        );
        break;
    }
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-stage">
      <header className="border-b border-border-soft">
        <div className="mx-auto flex min-h-14 max-w-[1400px] items-center gap-1 px-2 sm:px-6">
          <Link href="/library" aria-label="กลับไปตั๋วของฉัน" className="btn-icon">
            <ChevronLeftIcon size={22} />
          </Link>
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{event.title}</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1400px] flex-wrap items-start gap-[clamp(18px,2vw,28px)] pb-8 sm:px-6">
        <div className="flex min-w-0 flex-[999_1_640px] justify-center overflow-hidden bg-black sm:mt-6 sm:rounded-lg">
          <div className="w-[min(100%,calc((100dvh-56px)*16/9))]">{stage}</div>
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 px-4 sm:mt-6 sm:px-0">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">{event.status === "LIVE" && <LiveBadge small />}</div>
            <h1 className="text-[clamp(20px,0.8vw+16px,26px)] leading-[1.4] font-bold">{event.title}</h1>
            <span className="text-[13px] text-muted">{subline}</span>
          </div>
          <InfoRow icon={<PhoneIcon size={20} />}>
            กำลังดูบนเครื่องนี้ · ถ้าเปิดดูที่เครื่องอื่น เครื่องนี้จะหยุดเล่นอัตโนมัติ (1 ตั๋วดูได้ทีละ 1 เครื่อง)
          </InfoRow>
          <InfoRow icon={<RotateIcon size={20} />}>
            หมุนจอเป็นแนวนอนหรือกดเต็มจอเพื่อดูภาพใหญ่ · ภาพมีลายน้ำ email ของคุณ ห้ามบันทึกหรือเผยแพร่ซ้ำ
          </InfoRow>
          <Link href={`/events/${event.slug}`} className="btn btn-outline text-sm text-soft">
            รายละเอียด event
          </Link>
        </div>
      </main>
    </div>
  );
}

function StateCard({ children, glow = false }: { children: ReactNode; glow?: boolean }) {
  return (
    <div
      className="flex aspect-video w-full flex-col items-center justify-center gap-2.5 bg-stage-2 p-4 text-center"
      style={
        glow
          ? { backgroundImage: "radial-gradient(260px 180px at 50% 40%, rgba(43,92,255,0.25), transparent 70%)" }
          : undefined
      }
    >
      {children}
    </div>
  );
}

function InfoRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[14px] border border-border bg-white/[0.04] p-3.5">
      <span className="mt-0.5 shrink-0 text-link">{icon}</span>
      <span className="text-[13px] leading-5 text-soft">{children}</span>
    </div>
  );
}

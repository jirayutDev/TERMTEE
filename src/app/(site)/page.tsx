import type { ReactNode } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { replayExpiresAt } from "@/lib/access";
import { formatBaht, formatEventDate, formatShortDate } from "@/lib/format";
import type { Event } from "@/generated/prisma/client";
import { Cover, LiveBadge } from "@/components/ui/primitives";
import { TicketIcon } from "@/components/ui/icons";

export default async function Home() {
  const [upcoming, ended] = await Promise.all([
    db.event.findMany({
      where: { status: { in: ["LIVE", "SCHEDULED"] } },
      orderBy: { startsAt: "asc" },
    }),
    db.event.findMany({
      where: { status: "ENDED" },
      orderBy: { endedAt: "desc" },
      take: 24,
    }),
  ]);

  const now = new Date();
  const live = upcoming.filter((e) => e.status === "LIVE");
  const scheduled = upcoming.filter((e) => e.status === "SCHEDULED");
  const replays = ended
    .filter((e) => {
      const exp = replayExpiresAt(e.endedAt, e.replayDays);
      return exp !== null && exp > now;
    })
    .slice(0, 12);

  if (live.length + scheduled.length + replays.length === 0) {
    return (
      <div className="mx-auto flex max-w-[480px] flex-col items-center gap-3 px-8 py-[120px] text-center">
        <span className="grid size-[72px] place-items-center rounded-xl border border-accent/30 bg-accent/14 text-link">
          <TicketIcon size={34} strokeWidth={1.6} />
        </span>
        <h1 className="mt-2 text-[22px] leading-8 font-bold">ยังไม่มี event</h1>
        <p className="text-[15px] leading-6 text-muted">
          event ใหม่จะขึ้นที่หน้านี้ทันทีที่เปิดขาย แวะมาดูอีกครั้งเร็วๆ นี้
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[clamp(36px,4vw,56px)] px-4 pt-[clamp(20px,3vw,40px)] pb-[clamp(40px,5vw,64px)] sm:px-6">
      <h1 className="sr-only">TERMTEE — ดูไลฟ์สดแบบจ่ายต่อครั้ง</h1>

      {live.length > 0 && (
        <section aria-labelledby="live-h" className="flex flex-col gap-[clamp(14px,1.5vw,18px)]">
          <div className="flex items-center gap-2.5">
            <LiveBadge />
            <SectionTitle id="live-h">กำลัง LIVE</SectionTitle>
          </div>
          {live.map((e) => (
            <FeaturedLive key={e.id} event={e} />
          ))}
        </section>
      )}

      {scheduled.length > 0 && (
        <section aria-labelledby="soon-h" className="flex flex-col gap-[clamp(14px,1.5vw,18px)]">
          <div className="flex items-baseline justify-between">
            <SectionTitle id="soon-h">เร็วๆ นี้</SectionTitle>
            <span className="text-[13px] text-muted">{scheduled.length.toLocaleString("th-TH")} event</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-[clamp(12px,1.6vw,20px)]">
            {scheduled.map((e) => (
              <Link
                key={e.id}
                href={`/events/${e.slug}`}
                className="glass group flex flex-col overflow-hidden rounded-xl transition hover:border-accent/50"
              >
                <Cover src={e.coverUrl} seed={e.id}>
                  <span className="badge badge-soon badge-overlay absolute top-3 left-3">เร็วๆ นี้</span>
                </Cover>
                <div className="flex flex-col gap-1.5 px-4 pt-3.5 pb-4">
                  <span className="text-[17px] leading-[26px] font-semibold group-hover:text-link-hover">{e.title}</span>
                  <span className="tabular text-[13px] text-muted">{formatEventDate(e.startsAt)}</span>
                  <span className="tabular mt-1 text-xl font-bold">{formatBaht(e.priceSatang)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {replays.length > 0 && (
        <section aria-labelledby="replay-h" className="flex flex-col gap-[clamp(14px,1.5vw,18px)]">
          <SectionTitle id="replay-h">ดูย้อนหลัง</SectionTitle>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(clamp(160px,20vw,280px),100%),1fr))] gap-[clamp(12px,1.6vw,20px)]">
            {replays.map((e) => {
              const until = replayExpiresAt(e.endedAt, e.replayDays);
              return (
                <Link
                  key={e.id}
                  href={`/events/${e.slug}`}
                  className="glass group flex flex-col overflow-hidden rounded-lg transition hover:border-accent/50"
                >
                  <Cover src={e.coverUrl} seed={e.id}>
                    <span className="badge badge-sm badge-replay badge-overlay absolute top-2 left-2">Replay</span>
                  </Cover>
                  <div className="flex flex-col gap-1.5 px-3 pt-2.5 pb-3">
                    <span className="text-sm leading-5 font-semibold group-hover:text-link-hover">{e.title}</span>
                    {until && (
                      <span className="text-xs leading-[17px] text-muted">ดูย้อนหลังได้ถึง {formatShortDate(until)}</span>
                    )}
                    <span className="tabular text-[15px] font-bold">{formatBaht(e.priceSatang)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-[clamp(22px,1vw+18px,28px)] leading-[1.4] font-bold">
      {children}
    </h2>
  );
}

function FeaturedLive({ event }: { event: Event }) {
  return (
    <Link
      href={`/events/${event.slug}`}
      className="group flex flex-wrap overflow-hidden rounded-[clamp(20px,2vw,24px)] border border-live/45 shadow-[0_0_0_4px_rgba(229,22,46,0.12),0_20px_40px_-12px_rgba(0,0,0,0.6)]"
      style={{ background: "linear-gradient(160deg,rgba(30,40,100,0.62),rgba(10,15,45,0.62))" }}
    >
      <div className="min-w-0 flex-[999_1_520px]">
        <Cover src={event.coverUrl} seed={event.id} />
      </div>
      <div className="flex min-w-0 flex-[1_1_320px] flex-col justify-center gap-[clamp(12px,1.4vw,16px)] p-[clamp(16px,2.4vw,32px)]">
        <span className="text-[clamp(19px,1.4vw+14px,32px)] leading-[1.35] font-bold group-hover:text-link-hover">
          {event.title}
        </span>
        <span className="text-[clamp(13px,0.3vw+12px,15px)] text-soft">
          เริ่ม {formatEventDate(event.startsAt)}
          {event.replayDays > 0 ? ` · ดูย้อนหลังได้ ${event.replayDays} วัน` : ""}
        </span>
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <span className="tabular text-[clamp(24px,1vw+20px,32px)] font-bold">{formatBaht(event.priceSatang)}</span>
          <span className="btn btn-primary min-h-12 px-6 text-base">ซื้อตั๋ว</span>
        </div>
      </div>
    </Link>
  );
}

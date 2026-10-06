import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { replayExpiresAt } from "@/lib/access";
import { formatBaht, formatDayTime, formatEventDate } from "@/lib/format";
import { loginUrl } from "@/lib/safe-redirect";
import type { EventStatus } from "@/generated/prisma/client";
import { Cover, EmptyState, LiveBadge } from "@/components/ui/primitives";
import { PlayIcon, TicketIcon } from "@/components/ui/icons";

export const metadata = { title: "ตั๋วของฉัน" };

type Access =
  | { kind: "watch"; label: string }
  | { kind: "wait" }
  | { kind: "blocked"; reason: string };

/** Mirrors checkAccess() in src/lib/access.ts, computed from already-loaded rows. */
function accessFor(
  revoked: boolean,
  event: { status: EventStatus; endedAt: Date | null; replayDays: number },
  now: Date,
): Access {
  if (revoked) return { kind: "blocked", reason: "ตั๋วถูกยกเลิก" };
  switch (event.status) {
    case "LIVE":
      return { kind: "watch", label: "ดูสดเลย" };
    case "ENDED": {
      const expires = replayExpiresAt(event.endedAt, event.replayDays);
      if (!expires || expires < now) return { kind: "blocked", reason: "หมดเวลาดูย้อนหลังแล้ว" };
      return { kind: "watch", label: "ดูย้อนหลัง" };
    }
    case "ARCHIVED":
      return { kind: "blocked", reason: "หมดเวลาดูย้อนหลังแล้ว" };
    default:
      return { kind: "wait" };
  }
}

export default async function LibraryPage() {
  const user = await currentUser();
  if (!user) redirect(loginUrl("/library"));

  const [tickets, pendingOrders] = await Promise.all([
    db.ticket.findMany({
      where: { userId: user.id },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            coverUrl: true,
            startsAt: true,
            status: true,
            endedAt: true,
            replayDays: true,
          },
        },
      },
      orderBy: { event: { startsAt: "desc" } },
    }),
    db.order.findMany({
      where: { userId: user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: {
        event: { select: { id: true, title: true, coverUrl: true } },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, createdAt: true, rejectReason: true },
        },
      },
    }),
  ]);
  // Hide stale pending orders for events the user already holds an active ticket for.
  const owned = new Set(tickets.filter((t) => !t.revoked).map((t) => t.eventId));
  const awaiting = pendingOrders.filter((o) => !owned.has(o.eventId));

  const now = new Date();
  const empty = tickets.length === 0 && awaiting.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[clamp(18px,2vw,24px)] px-4 pt-[clamp(24px,3vw,40px)] pb-10 sm:px-6">
      <h1 className="text-[clamp(26px,1vw+22px,34px)] leading-[1.4] font-bold">ตั๋วของฉัน</h1>

      {empty ? (
        <EmptyState
          icon={<TicketIcon size={30} strokeWidth={1.6} />}
          title="ยังไม่มีตั๋ว"
          body="ตั๋วที่ซื้อแล้วจะอยู่ที่นี่ ดูสดหรือย้อนหลังได้จากหน้านี้"
          action={
            <Link href="/" className="btn btn-primary min-h-12 px-[22px]">
              ดู event ทั้งหมด
            </Link>
          }
        />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))] gap-[clamp(12px,1.6vw,20px)]">
          {awaiting.map((o) => {
            const last = o.payments[0];
            const reviewing = last?.status === "NEEDS_REVIEW" || last?.status === "PROCESSING";
            const rejected = last?.status === "REJECTED";
            return (
              <TicketCard
                key={o.id}
                title={o.event.title}
                cover={o.event.coverUrl}
                seed={o.event.id}
                badge={
                  reviewing ? (
                    <span className="badge badge-sm badge-warning">
                      {last.status === "PROCESSING" ? "กำลังตรวจสลิป" : "รอทีมงานตรวจสลิป"}
                    </span>
                  ) : rejected ? (
                    <span className="badge badge-sm badge-danger">สลิปไม่ผ่าน</span>
                  ) : (
                    <span className="badge badge-sm badge-neutral">รอชำระเงิน</span>
                  )
                }
                meta={
                  reviewing
                    ? `ส่งสลิปเมื่อ ${formatDayTime(last.createdAt)} น. · ${last.status === "PROCESSING" ? "ระบบกำลังตรวจสลิป" : "ระบบอ่านสลิปไม่ครบ ทีมงานกำลังตรวจให้"}`
                    : rejected
                      ? `${last.rejectReason ?? "สลิปไม่ผ่านการตรวจสอบ"} · แนบสลิปใหม่ได้`
                      : `${formatBaht(o.amountSatang)} · ยังไม่ได้แนบสลิป`
                }
                action={
                  reviewing ? (
                    <Link href={`/pay/${o.id}`} className="btn btn-outline mt-auto w-full">
                      ดูสถานะ
                    </Link>
                  ) : (
                    <Link href={`/pay/${o.id}${rejected ? "?retry=1" : ""}`} className="btn btn-primary mt-auto w-full shadow-none">
                      {rejected ? "แนบสลิปใหม่" : "ชำระเงิน"}
                    </Link>
                  )
                }
              />
            );
          })}

          {tickets.map(({ id, revoked, event }) => {
            const access = accessFor(revoked, event, now);
            const expires = event.status === "ENDED" ? replayExpiresAt(event.endedAt, event.replayDays) : null;
            const live = event.status === "LIVE" && !revoked;
            const badge = revoked ? (
              <span className="badge badge-sm badge-danger">ถูกยกเลิก</span>
            ) : live ? (
              <LiveBadge small />
            ) : access.kind === "watch" ? (
              <span className="badge badge-sm badge-replay">Replay</span>
            ) : access.kind === "wait" ? (
              <span className="badge badge-sm badge-soon">รอ live</span>
            ) : (
              <span className="badge badge-sm badge-neutral">หมดอายุ</span>
            );
            const meta = revoked
              ? "ตั๋วนี้ถูกยกเลิกแล้ว"
              : expires && access.kind === "blocked"
                ? `หมดเวลาดูเมื่อ ${formatEventDate(expires)}`
                : expires
                  ? `ดูย้อนหลังได้ถึง ${formatEventDate(expires)}`
                  : live
                    ? `เริ่ม ${formatEventDate(event.startsAt)}`
                    : access.kind === "blocked"
                      ? access.reason
                      : formatEventDate(event.startsAt);
            return (
              <TicketCard
                key={id}
                title={event.title}
                href={`/events/${event.slug}`}
                cover={event.coverUrl}
                seed={event.id}
                live={live}
                dim={access.kind === "blocked"}
                badge={badge}
                meta={meta}
                action={
                  access.kind === "watch" ? (
                    <Link href={`/watch/${event.slug}`} className="btn btn-primary mt-auto w-full shadow-none">
                      <PlayIcon size={16} />
                      {access.label}
                    </Link>
                  ) : access.kind === "wait" ? (
                    <Link href={`/watch/${event.slug}`} className="btn btn-outline mt-auto w-full">
                      เปิดหน้ารอ live
                    </Link>
                  ) : null
                }
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TicketCard({
  title,
  href,
  cover,
  seed,
  badge,
  meta,
  action,
  live = false,
  dim = false,
}: {
  title: string;
  href?: string;
  cover: string | null;
  seed: string;
  badge: ReactNode;
  meta: string;
  action: ReactNode;
  live?: boolean;
  dim?: boolean;
}) {
  return (
    <li
      className={`flex flex-col gap-3 rounded-lg p-3 ${live ? "border border-live/45" : "glass"}`}
      style={live ? { background: "linear-gradient(160deg,rgba(30,40,100,0.6),rgba(10,15,45,0.6))" } : undefined}
    >
      <div className="flex gap-3">
        <div className={`w-[clamp(104px,10vw,140px)] shrink-0 ${dim ? "opacity-45" : ""}`}>
          <Cover src={cover} seed={seed} className="rounded-[10px]" />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          {href ? (
            <Link href={href} className="text-[15px] leading-[22px] font-semibold hover:underline">
              {title}
            </Link>
          ) : (
            <span className="text-[15px] leading-[22px] font-semibold">{title}</span>
          )}
          <span className="flex items-center gap-1.5">{badge}</span>
          <span className="tabular text-xs leading-[18px] text-muted">{meta}</span>
        </div>
      </div>
      {action}
    </li>
  );
}

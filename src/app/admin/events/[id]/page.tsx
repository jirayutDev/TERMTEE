import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { replayExpiresAt } from "@/lib/access";
import { isPushInput } from "@/lib/media/types";
import { SESSION_STALE_SEC } from "@/lib/drm/view-session";
import { KICKED_DEVICE_ID } from "@/lib/viewers";
import {
  STATUS_LABEL,
  STATUS_SHORT,
  STATUS_STYLE,
  formatBaht,
  formatDayTime,
  formatEventDate,
  viewerCode,
} from "@/lib/format";
import { LiveBadge, Notice } from "@/components/ui/primitives";
import { CopyButton } from "@/components/ui/copy-button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import SecretField from "./secret-field";
import { pageUser } from "../../guard";
import { archiveReplayAction, setTicketRevokedAction, startLiveAction, stopLiveAction } from "../../actions";

export default async function AdminEventPage({ params, searchParams }: PageProps<"/admin/events/[id]">) {
  const { id } = await params;
  await pageUser("events", `/admin/events/${id}`);
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const ok = one(sp.ok);
  const error = one(sp.error);

  const event = await db.event.findUnique({
    where: { id },
    include: {
      tickets: {
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { email: true, name: true } },
          order: { select: { amountSatang: true, status: true, paidAt: true } },
        },
      },
    },
  });
  if (!event) notFound();

  const [revenue, watching] = await Promise.all([
    db.order.aggregate({ where: { eventId: id, status: "PAID" }, _sum: { amountSatang: true } }),
    db.viewSession.count({
      where: {
        eventId: id,
        deviceId: { not: KICKED_DEVICE_ID },
        lastSeenAt: { gt: staleCutoff() },
      },
    }),
  ]);
  const activeTickets = event.tickets.filter((t) => !t.revoked).length;
  const replayEnd = replayExpiresAt(event.endedAt, event.replayDays);

  const canStart = event.status === "DRAFT" || event.status === "SCHEDULED" || event.status === "LIVE";
  const canStop = event.status === "LIVE" || event.status === "SCHEDULED";
  const canArchive = event.status === "ENDED";
  const isLive = event.status === "LIVE";

  const stopDialog = (
    <ConfirmDialog
      action={stopLiveAction.bind(null, id)}
      trigger="Stop live"
      triggerDisabled={!canStop}
      triggerClassName="btn min-h-12 w-full btn-danger text-base"
      title="หยุด live ตอนนี้?"
      body={`ระบบจะส่งคำสั่งหยุดไปที่เซิร์ฟเวอร์สื่อ คนดู ${watching.toLocaleString("th-TH")} คนจะเห็นว่า live จบแล้ว และ replay จะพร้อมเมื่อเซิร์ฟเวอร์แจ้งกลับ`}
      confirmLabel="หยุด live"
    />
  );

  return (
    <>
      {ok && (
        <Notice tone="ok" role="status">
          {ok}
        </Notice>
      )}
      {error && (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link href="/admin" className="link self-start text-[13px] font-normal">
            ← Events
          </Link>
          <h1 className="text-[28px] leading-[38px] font-bold">{event.title}</h1>
          <span className="tabular text-sm text-muted">
            {formatEventDate(event.startsAt)} · {formatBaht(event.priceSatang)} · ดูย้อนหลัง {event.replayDays} วัน
          </span>
        </div>
        <div className="flex gap-2.5">
          <Link href={`/events/${event.slug}`} className="btn btn-sm btn-outline">
            ดูหน้า event ↗
          </Link>
          <Link href={`/admin/events/${id}/edit`} className="btn btn-sm btn-ghost">
            แก้ไข
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-stretch gap-5">
        {/* Live control */}
        <section
          aria-labelledby="live-h"
          className={`flex flex-[1_1_380px] flex-col gap-[18px] rounded-lg bg-surface/55 p-6 ${
            isLive ? "border border-live/45" : "border border-border"
          }`}
        >
          <div className="flex items-center justify-between">
            <h2 id="live-h" className="text-base font-semibold">
              สถานะ live
            </h2>
            <span className="text-xs text-muted">{STATUS_LABEL[event.status]}</span>
          </div>

          <div className="flex items-center gap-3">
            {isLive ? (
              <LiveBadge />
            ) : (
              <span className={`badge ${STATUS_STYLE[event.status]}`}>{STATUS_SHORT[event.status]}</span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Stat label="กำลังดู" value={watching.toLocaleString("th-TH")} />
            <Stat label="ตั๋วใช้งาน" value={activeTickets.toLocaleString("th-TH")} />
            <Stat label="รายได้" value={formatBaht(revenue._sum.amountSatang ?? 0)} />
          </div>

          {isLive ? (
            <div className="flex flex-col gap-2">
              {stopDialog}
              <form action={startLiveAction.bind(null, id)}>
                <button className="btn btn-sm btn-ghost w-full">ส่งคำสั่งเริ่มอีกครั้ง (ขอ ingest URL ใหม่)</button>
              </form>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm leading-[22px] text-muted">
                {event.status === "ENDED"
                  ? "live จบแล้ว · replay จะพร้อมให้คนดูอัตโนมัติ"
                  : event.status === "ARCHIVED"
                    ? "ลบ replay แล้ว · คนดูไม่สามารถดูย้อนหลังได้"
                    : "กด Start live แล้วเริ่มส่งสัญญาณจาก encoder"}
              </p>
              <form action={startLiveAction.bind(null, id)}>
                <button disabled={!canStart} className="btn min-h-12 w-full btn-primary text-base">
                  Start live
                </button>
              </form>
              {canStop && stopDialog}
            </div>
          )}
          <p className="text-xs text-subtle">
            สถานะ LIVE / ENDED จะเปลี่ยนเมื่อเซิร์ฟเวอร์สื่อแจ้งกลับ (callback) — รีเฟรชหน้านี้เพื่อดูสถานะล่าสุด
          </p>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-3.5">
            <span className="text-[13px] text-muted">
              {replayEnd ? `Replay · ดูได้ถึง ${formatEventDate(replayEnd)}` : event.endedAt ? "Replay" : "Replay · ยังไม่มี"}
            </span>
            <ConfirmDialog
              action={archiveReplayAction.bind(null, id)}
              trigger="ลบ replay"
              triggerDisabled={!canArchive}
              triggerClassName="btn btn-sm btn-danger-outline text-[13px] disabled:bg-transparent!"
              title="ลบ replay?"
              body="คนที่มีตั๋วจะดูย้อนหลังไม่ได้อีก และกู้คืนไม่ได้"
              confirmLabel="ลบ replay"
            />
          </div>
        </section>

        {/* Ingest */}
        <section aria-labelledby="ingest-h" className="glass-admin flex flex-[1_1_420px] flex-col gap-4 rounded-lg p-6">
          <h2 id="ingest-h" className="text-base font-semibold">
            ข้อมูล ingest · {event.inputType}
          </h2>
          {isPushInput(event.inputType) ? (
            <>
              <SecretField label="Stream key" value={event.streamKey} />
              <ReadonlyField
                label={`Ingest URL (${event.inputType})`}
                value={event.ingestUrl}
                empty='จะแสดงหลังกด "Start live" (ได้จากเซิร์ฟเวอร์สื่อ)'
              />
              <span className="text-xs text-subtle">ห้ามแชร์ stream key ให้คนอื่น</span>
            </>
          ) : (
            <ReadonlyField
              label={event.inputType === "BROWSER" ? "หน้าเว็บที่จับภาพ" : "Source URL"}
              value={event.inputUrl}
              empty="—"
            />
          )}
          <ReadonlyField label="Manifest URL" value={event.manifestUrl} empty="—" />
          <ReadonlyField label="Content ID (DRM)" value={event.contentId} empty="—" />
          {event.endedAt && (
            <span className="text-xs text-muted">จบเมื่อ {formatEventDate(event.endedAt)}</span>
          )}
        </section>
      </div>

      {/* Buyers */}
      <section aria-labelledby="buyers-h" className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="buyers-h" className="text-lg font-bold">
            คนซื้อ · {event.tickets.length.toLocaleString("th-TH")} ตั๋ว · {formatBaht(revenue._sum.amountSatang ?? 0)}
          </h2>
          <Link href={`/admin/viewers?event=${id}`} className="link inline-flex min-h-11 items-center text-sm">
            ดูคนดูขณะนี้ →
          </Link>
        </div>
        <div className="glass-admin overflow-x-auto rounded-lg">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th scope="col" className="px-5!">คนซื้อ</th>
                <th scope="col">รหัสคนดู</th>
                <th scope="col">ออกตั๋วเมื่อ</th>
                <th scope="col">ยอดชำระ</th>
                <th scope="col">สถานะ</th>
                <th scope="col">
                  <span className="sr-only">การทำงาน</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {event.tickets.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8! text-center text-muted">
                    ยังไม่มีตั๋ว
                  </td>
                </tr>
              )}
              {event.tickets.map((t) => (
                <tr key={t.id}>
                  <td className="px-5!">
                    <div className="flex flex-col">
                      <span className="break-all">{t.user.email}</span>
                      {t.user.name && <span className="text-xs text-subtle">{t.user.name}</span>}
                    </div>
                  </td>
                  <td className="font-mono text-[13px] text-soft">{viewerCode(t.userId)}</td>
                  <td className="tabular whitespace-nowrap text-soft">{formatDayTime(t.createdAt)}</td>
                  <td className="tabular whitespace-nowrap text-soft">
                    {formatBaht(t.order.amountSatang)}
                    <span className="block text-xs text-subtle">โอน · สลิป ({t.order.status})</span>
                  </td>
                  <td>
                    {t.revoked ? (
                      <span className="badge badge-sm badge-danger">ถูกยกเลิก</span>
                    ) : (
                      <span className="badge badge-sm badge-success">ใช้งานได้</span>
                    )}
                  </td>
                  <td className="text-right">
                    {t.revoked ? (
                      <form action={setTicketRevokedAction.bind(null, t.id, false)}>
                        <button className="btn btn-sm btn-ghost text-[13px]">คืนสิทธิ์</button>
                      </form>
                    ) : (
                      <ConfirmDialog
                        action={setTicketRevokedAction.bind(null, t.id, true)}
                        trigger="ยกเลิกตั๋ว"
                        triggerClassName="btn btn-sm text-[13px] text-danger-fg hover:bg-danger/10"
                        title="ยกเลิกตั๋วนี้?"
                        body={`คนดู ${t.user.email} จะถูกตัดออกจาก player ทันที (การคืนเงินทำแยก)`}
                        confirmLabel="ยกเลิกตั๋ว"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** Sessions without a heartbeat since this time are no longer watching. */
function staleCutoff() {
  return new Date(Date.now() - SESSION_STALE_SEC * 1000);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-md bg-bg/60 p-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="tabular truncate text-xl font-bold">{value}</span>
    </div>
  );
}

function ReadonlyField({ label, value, empty }: { label: string; value: string | null; empty: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      {value ? (
        <div className="flex gap-1.5">
          <code className="flex min-h-11 min-w-0 flex-1 items-center rounded-[10px] border border-white/12 bg-bg/60 px-3 font-mono text-[13px] break-all text-soft select-all">
            {value}
          </code>
          <CopyButton value={value} label={label} iconOnly />
        </div>
      ) : (
        <span className="text-[13px] text-subtle">{empty}</span>
      )}
    </div>
  );
}

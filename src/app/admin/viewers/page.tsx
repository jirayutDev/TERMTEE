import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { isSessionFresh } from "@/lib/drm/view-session";
import { KICKED_DEVICE_ID } from "@/lib/viewers";
import { formatDayTime, viewerCode } from "@/lib/format";
import { LiveBadge } from "@/components/ui/primitives";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import EventPicker from "./event-picker";
import { pageUser } from "../guard";
import { kickViewerAction } from "../actions";

export const metadata: Metadata = { title: "คนดูขณะนี้" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TABS = [
  { id: "active", label: "กำลังดู" },
  { id: "stale", label: "ไม่ตอบสนอง" },
  { id: "kicked", label: "นำออกแล้ว" },
  { id: "all", label: "ทั้งหมด" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function duration(from: Date, to: Date) {
  const m = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  return m < 60 ? `${m} นาที` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} ชม.`;
}

export default async function AdminViewersPage({ searchParams }: PageProps<"/admin/viewers">) {
  await pageUser("viewers", "/admin/viewers");
  const sp = await searchParams;
  const q = (one(sp.q) ?? "").trim();
  const tab: TabId = TABS.some((t) => t.id === one(sp.tab)) ? (one(sp.tab) as TabId) : "active";

  // Events worth watching: live, or with any view session, or with an open replay.
  const events = await db.event.findMany({
    where: { OR: [{ status: "LIVE" }, { status: "ENDED" }, { viewSessions: { some: {} } }] },
    orderBy: [{ status: "asc" }, { startsAt: "desc" }],
    select: { id: true, title: true, status: true, _count: { select: { viewSessions: true } } },
    take: 50,
  });
  const defaultEvent =
    events.find((e) => e.status === "LIVE") ?? [...events].sort((a, b) => b._count.viewSessions - a._count.viewSessions)[0];
  const eventId = events.some((e) => e.id === one(sp.event)) ? one(sp.event)! : defaultEvent?.id;
  const event = events.find((e) => e.id === eventId) ?? null;

  const sessions = event
    ? await db.viewSession.findMany({
        where: { eventId: event.id },
        orderBy: { startedAt: "asc" },
        include: { user: { select: { email: true, name: true } } },
      })
    : [];

  const now = new Date();
  const rows = sessions.map((s) => ({
    ...s,
    code: viewerCode(s.userId),
    kicked: s.deviceId === KICKED_DEVICE_ID,
    fresh: s.deviceId !== KICKED_DEVICE_ID && isSessionFresh(s.lastSeenAt, now),
  }));
  const activeCount = rows.filter((r) => r.fresh).length;
  const needle = q.toLowerCase().replace(/^#/, "");
  const found = needle
    ? rows.filter((r) => r.code.toLowerCase() === needle || r.userId.toLowerCase().endsWith(needle) || r.user.email.toLowerCase().includes(needle))
    : null;
  const visible =
    found ??
    rows.filter((r) =>
      tab === "all" ? true : tab === "active" ? r.fresh : tab === "kicked" ? r.kicked : !r.fresh && !r.kicked,
    );

  // Watermark lookup across all events (a leaked clip may be from another event).
  const leakTickets =
    needle && needle.length >= 4
      ? await db.ticket.findMany({
          where: { OR: [{ userId: { endsWith: needle } }, { user: { email: { contains: needle, mode: "insensitive" } } }] },
          include: { user: { select: { email: true } }, event: { select: { id: true, title: true } } },
          take: 10,
        })
      : [];

  const tabHref = (id: TabId) => {
    const p = new URLSearchParams();
    if (event) p.set("event", event.id);
    if (id !== "active") p.set("tab", id);
    return `/admin/viewers?${p}`;
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] leading-[38px] font-bold">คนดูขณะนี้</h1>
          {event && (
            <div className="flex flex-wrap items-center gap-2.5">
              {event.status === "LIVE" && <LiveBadge />}
              <span className="tabular text-sm text-soft">
                {activeCount.toLocaleString("th-TH")} คนกำลังดู · อัปเดตทุก heartbeat (~30 วินาที)
              </span>
            </div>
          )}
        </div>
        {events.length > 0 && (
          <EventPicker
            value={event?.id ?? ""}
            options={events.map((e) => ({
              id: e.id,
              label: `${e.title} · ${e.status === "LIVE" ? "LIVE" : e.status === "ENDED" ? "Replay" : e.status}`,
            }))}
          />
        )}
      </div>

      {!event ? (
        <p className="rounded-lg border border-dashed border-border-strong p-10 text-center text-muted">
          ยังไม่มี event ที่มีคนดู
        </p>
      ) : (
        <>
          <section className="glass-strong flex flex-wrap items-end gap-4 rounded-lg p-5">
            <form action="/admin/viewers" className="flex min-w-0 flex-[999_1_320px] flex-col gap-1.5">
              <input type="hidden" name="event" value={event.id} />
              <label htmlFor="wm" className="text-sm font-semibold">
                หาคนดูจากลายน้ำ
              </label>
              <div className="flex gap-2">
                <input
                  id="wm"
                  name="q"
                  type="search"
                  defaultValue={q}
                  placeholder="รหัสบนลายน้ำ (8 ตัว) หรือ email"
                  className="field min-w-0 flex-1 font-mono tracking-[0.04em]"
                />
                <button className="btn btn-primary shadow-none">ค้นหา</button>
              </div>
              <span className="text-xs text-muted">
                เจอคลิปหลุด? พิมพ์รหัสที่เห็นบนลายน้ำ (#xxxxxxxx) ระบบจะบอกว่าเป็นตั๋วของใคร
              </span>
            </form>
            <nav aria-label="ตัวกรอง" className="segmented flex-[1_1_auto] bg-bg/60!">
              {TABS.map((t) => (
                <Link key={t.id} href={tabHref(t.id)} aria-current={!found && t.id === tab ? "page" : undefined}>
                  {t.label}
                </Link>
              ))}
            </nav>
          </section>

          {found && (
            <div className="flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/8 px-4 py-3 text-sm">
              <span>
                ผลค้นหา “{q}”: พบใน event นี้ {found.length.toLocaleString("th-TH")} คน
                {" · "}
                <Link href={tabHref(tab)} className="link">
                  ล้างการค้นหา
                </Link>
              </span>
              {leakTickets.length > 0 && (
                <ul className="flex flex-col gap-1 text-[13px] text-soft">
                  {leakTickets.map((t) => (
                    <li key={t.id}>
                      ตั๋วของ <span className="font-semibold text-fg">{t.user.email}</span>{" "}
                      <span className="font-mono">{viewerCode(t.userId)}</span> ·{" "}
                      <Link href={`/admin/events/${t.event.id}`} className="link">
                        {t.event.title}
                      </Link>
                      {t.revoked ? " (ยกเลิกแล้ว)" : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="glass-admin overflow-x-auto rounded-lg">
            <table className="data-table min-w-[820px]">
              <thead>
                <tr>
                  <th scope="col">คนดู</th>
                  <th scope="col">เครื่อง (device id)</th>
                  <th scope="col">เริ่มดู</th>
                  <th scope="col">heartbeat ล่าสุด</th>
                  <th scope="col">สถานะ</th>
                  <th scope="col">
                    <span className="sr-only">การทำงาน</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10! text-center text-muted">
                      ไม่มีคนดูในรายการนี้
                    </td>
                  </tr>
                )}
                {visible.map((r) => (
                  <tr key={r.id} className={found ? "bg-accent/14" : undefined}>
                    <td>
                      <div className="flex flex-col gap-0.5">
                        <span className="break-all">{r.user.email}</span>
                        <span className="font-mono text-xs text-accent-fg">#{r.code}</span>
                      </div>
                    </td>
                    <td className="font-mono text-xs text-soft">{r.kicked ? "—" : `${r.deviceId.slice(0, 8)}…`}</td>
                    <td className="tabular whitespace-nowrap text-soft">
                      {formatDayTime(r.startedAt)}
                      <span className="block text-xs text-subtle">{duration(r.startedAt, now)}</span>
                    </td>
                    <td className="tabular whitespace-nowrap text-soft">{formatDayTime(r.lastSeenAt)}</td>
                    <td>
                      {r.kicked ? (
                        <span className="badge badge-sm badge-neutral">นำออกแล้ว</span>
                      ) : r.fresh ? (
                        <span className="badge badge-sm badge-success">กำลังดู</span>
                      ) : (
                        <span className="badge badge-sm badge-warning">ไม่ตอบสนอง</span>
                      )}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {!r.kicked && (
                        <ConfirmDialog
                          action={kickViewerAction.bind(null, r.id)}
                          trigger="เตะออก"
                          triggerClassName="btn btn-sm btn-danger-outline text-[13px]"
                          title={`เตะ ${r.user.email} ออกจากการดู?`}
                          body={`#${r.code} · player ของคนนี้จะหยุดภายใน ~30 วินาที (heartbeat ถัดไป)`}
                          confirmLabel="เตะออก"
                        >
                          <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md bg-white/[0.04] px-3.5 py-2 text-sm">
                            <input type="checkbox" name="revoke" className="size-[18px] accent-danger-fill" />
                            ยกเลิกตั๋วด้วย (กลับมาดูไม่ได้อีก · คืนเงินทำแยก)
                          </label>
                          <span className="text-xs leading-[18px] text-muted">
                            ถ้าไม่ยกเลิกตั๋ว คนดูจะเห็น “หยุดเล่นบนเครื่องนี้แล้ว” และกดดูต่อได้
                          </span>
                        </ConfirmDialog>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="text-xs text-subtle">
            แสดง {visible.length.toLocaleString("th-TH")} จาก {rows.length.toLocaleString("th-TH")} session · ไม่ตอบสนอง =
            ไม่มี heartbeat เกิน 90 วินาที (ปิดหน้าไปแล้ว)
          </span>
        </>
      )}
    </>
  );
}

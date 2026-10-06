import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { can } from "@/lib/roles";
import { ADMIN_SECTIONS } from "./guard";
import { db } from "@/lib/db";
import { STATUS_SHORT, STATUS_STYLE, formatBaht, formatEventDate } from "@/lib/format";
import type { EventStatus, Prisma } from "@/generated/prisma/client";
import { Cover, LiveBadge } from "@/components/ui/primitives";
import { PlusIcon } from "@/components/ui/icons";

const TABS: { id: string; label: string; statuses: EventStatus[] | null }[] = [
  { id: "all", label: "ทั้งหมด", statuses: null },
  { id: "live", label: "LIVE", statuses: ["LIVE"] },
  { id: "onsale", label: "เปิดขาย", statuses: ["SCHEDULED"] },
  { id: "draft", label: "Draft", statuses: ["DRAFT"] },
  { id: "ended", label: "จบแล้ว", statuses: ["ENDED", "ARCHIVED"] },
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AdminHome({ searchParams }: PageProps<"/admin">) {
  // The layout already ensured a staff user; staff without "events" go to their first section.
  const user = await currentUser();
  if (!can(user?.role, "events")) {
    redirect(ADMIN_SECTIONS.find((s) => s.permission !== "events" && can(user?.role, s.permission))?.href ?? "/");
  }
  const sp = await searchParams;
  const tab = TABS.find((t) => t.id === one(sp.status)) ?? TABS[0];
  const q = (one(sp.q) ?? "").trim();

  const where: Prisma.EventWhereInput = {
    ...(tab.statuses ? { status: { in: tab.statuses } } : {}),
    ...(q
      ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] }
      : {}),
  };

  const [events, totalEvents, tickets, revenue] = await Promise.all([
    db.event.findMany({ where, orderBy: { startsAt: "desc" } }),
    db.event.count(),
    db.ticket.groupBy({ by: ["eventId"], where: { revoked: false }, _count: { _all: true } }),
    db.order.groupBy({ by: ["eventId"], where: { status: "PAID" }, _sum: { amountSatang: true } }),
  ]);
  const sold = new Map(tickets.map((t) => [t.eventId, t._count._all]));
  const rev = new Map(revenue.map((r) => [r.eventId, r._sum.amountSatang ?? 0]));
  const totalRevenue = [...rev.values()].reduce((a, b) => a + b, 0);
  const totalSold = [...sold.values()].reduce((a, b) => a + b, 0);

  const href = (status: string, query = q) => {
    const p = new URLSearchParams();
    if (status !== "all") p.set("status", status);
    if (query) p.set("q", query);
    const s = p.toString();
    return s ? `/admin?${s}` : "/admin";
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col">
          <h1 className="text-[28px] leading-[38px] font-bold">Events</h1>
          <span className="text-sm text-muted">
            {totalEvents.toLocaleString("th-TH")} event · ตั๋วใช้งานอยู่ {totalSold.toLocaleString("th-TH")} ใบ · รายได้รวม{" "}
            {formatBaht(totalRevenue)}
          </span>
        </div>
        <Link href="/admin/events/new" className="btn btn-primary">
          <PlusIcon size={18} />
          สร้าง event
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="กรองตามสถานะ" className="segmented">
          {TABS.map((t) => (
            <Link key={t.id} href={href(t.id)} aria-current={t.id === tab.id ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <form action="/admin" className="flex gap-2">
          {tab.id !== "all" && <input type="hidden" name="status" value={tab.id} />}
          <label htmlFor="q" className="sr-only">
            ค้นหา event
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="ค้นหาชื่อ event หรือ slug"
            className="field w-[260px] max-w-full text-sm"
          />
          <button className="btn btn-sm btn-secondary min-h-11">ค้นหา</button>
        </form>
      </div>

      <div className="glass-admin overflow-x-auto rounded-lg">
        <table className="data-table min-w-[860px]">
          <thead>
            <tr>
              <th scope="col" className="px-5!">ชื่อ</th>
              <th scope="col">วันเวลาเริ่ม</th>
              <th scope="col">สถานะ</th>
              <th scope="col" className="text-right!">ตั๋ว</th>
              <th scope="col" className="text-right!">รายได้</th>
              <th scope="col">
                <span className="sr-only">การทำงาน</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10! text-center text-muted">
                  {q || tab.statuses ? "ไม่พบ event ที่ตรงกับตัวกรอง" : "ยังไม่มี event"}
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={e.id}>
                <td className="px-5!">
                  <div className="flex items-center gap-3">
                    <div className="w-16 shrink-0">
                      <Cover src={e.coverUrl} seed={e.id} className="rounded-[6px]" />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <Link href={`/admin/events/${e.id}`} className="font-semibold hover:text-link-hover">
                        {e.title}
                      </Link>
                      <span className="text-xs text-subtle">/{e.slug}</span>
                    </div>
                  </div>
                </td>
                <td className="tabular whitespace-nowrap text-soft">{formatEventDate(e.startsAt)}</td>
                <td>
                  {e.status === "LIVE" ? (
                    <LiveBadge small />
                  ) : (
                    <span className={`badge badge-sm ${STATUS_STYLE[e.status]}`}>{STATUS_SHORT[e.status]}</span>
                  )}
                </td>
                <td className="tabular text-right">{(sold.get(e.id) ?? 0).toLocaleString("th-TH")}</td>
                <td className="tabular text-right font-semibold">{formatBaht(rev.get(e.id) ?? 0)}</td>
                <td className="text-right whitespace-nowrap">
                  <div className="inline-flex gap-1.5">
                    <Link href={`/admin/events/${e.id}`} className="btn btn-sm btn-outline text-[13px]">
                      ควบคุม
                    </Link>
                    <Link href={`/admin/events/${e.id}/edit`} className="btn btn-sm btn-ghost text-[13px]">
                      แก้ไข
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

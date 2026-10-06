import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { replayExpiresAt } from "@/lib/access";
import { formatBaht, formatDayTime, formatEventDate, orderRef } from "@/lib/format";
import { loginUrl } from "@/lib/safe-redirect";
import { Cover, EmptyState } from "@/components/ui/primitives";
import { ReceiptIcon } from "@/components/ui/icons";
import type { EventStatus, OrderStatus, PaymentStatus, Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "ประวัติการซื้อ" };

type Kind = "unpaid" | "reviewing" | "paid" | "rejected" | "cancelled" | "refunded";

const KIND: Record<Kind, { label: string; badge: string }> = {
  unpaid: { label: "รอชำระเงิน", badge: "badge-neutral" },
  reviewing: { label: "รอตรวจสลิป", badge: "badge-warning" },
  paid: { label: "ชำระแล้ว", badge: "badge-success" },
  rejected: { label: "สลิปไม่ผ่าน", badge: "badge-danger" },
  cancelled: { label: "ยกเลิก", badge: "badge-neutral" },
  refunded: { label: "คืนเงินแล้ว", badge: "badge-neutral" },
};

const TABS = [
  { id: "all", label: "ทั้งหมด", kinds: null },
  { id: "pending", label: "รอดำเนินการ", kinds: ["unpaid", "reviewing"] },
  { id: "paid", label: "ชำระแล้ว", kinds: ["paid"] },
  { id: "rejected", label: "ไม่ผ่าน", kinds: ["rejected"] },
  { id: "closed", label: "ยกเลิก/คืนเงิน", kinds: ["cancelled", "refunded"] },
] as const satisfies readonly { id: string; label: string; kinds: readonly Kind[] | null }[];

function kindOf(status: OrderStatus, lastPayment: PaymentStatus | undefined): Kind {
  switch (status) {
    case "PAID":
      return "paid";
    case "CANCELLED":
      return "cancelled";
    case "REFUNDED":
      return "refunded";
    default:
      if (lastPayment === "NEEDS_REVIEW" || lastPayment === "PROCESSING") return "reviewing";
      if (lastPayment === "REJECTED") return "rejected";
      return "unpaid";
  }
}

const ORDER_INCLUDE = {
  event: {
    select: { id: true, title: true, slug: true, coverUrl: true, startsAt: true, status: true, endedAt: true, replayDays: true },
  },
  payments: {
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, createdAt: true, reviewedAt: true, rejectReason: true },
  },
  ticket: { select: { id: true, revoked: true } },
} satisfies Prisma.OrderInclude;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const user = await currentUser();
  if (!user) redirect(loginUrl("/orders"));

  const sp = await searchParams;
  const tabId = TABS.some((t) => t.id === one(sp.status)) ? one(sp.status)! : "all";
  const tab = TABS.find((t) => t.id === tabId)!;

  const orders = await db.order.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: ORDER_INCLUDE,
  });

  const rows = orders.map((o) => ({ ...o, kind: kindOf(o.status, o.payments.at(-1)?.status) }));
  const visible = tab.kinds ? rows.filter((r) => (tab.kinds as readonly Kind[]).includes(r.kind)) : rows;
  const selected = visible.find((r) => r.id === one(sp.order)) ?? visible[0] ?? null;
  const paidTotal = rows.filter((r) => r.kind === "paid").reduce((sum, r) => sum + r.amountSatang, 0);

  const qs = (params: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && v !== "all") p.set(k, v);
    const s = p.toString();
    return s ? `/orders?${s}` : "/orders";
  };

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[clamp(18px,2vw,24px)] px-4 pt-[clamp(20px,3vw,40px)] pb-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[clamp(26px,1vw+22px,34px)] leading-[1.4] font-bold">ประวัติการซื้อ</h1>
          <span className="text-sm text-muted">
            สั่งซื้อทั้งหมด {rows.length.toLocaleString("th-TH")} ครั้ง · ชำระแล้ว {formatBaht(paidTotal)}
          </span>
        </div>
        {rows.length > 0 && (
          <nav aria-label="สถานะ" className="segmented">
            {TABS.map((t) => (
              <Link key={t.id} href={qs({ status: t.id })} aria-current={t.id === tabId ? "page" : undefined}>
                {t.label}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ReceiptIcon size={30} strokeWidth={1.6} />}
          title="ยังไม่มีคำสั่งซื้อ"
          body="เมื่อซื้อตั๋วแล้ว ประวัติการชำระเงินจะแสดงที่นี่"
          action={
            <Link href="/" className="btn btn-primary min-h-12">
              ดู event ทั้งหมด
            </Link>
          }
        />
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <ul className="flex min-w-0 flex-[999_1_520px] flex-col gap-2.5">
            {visible.length === 0 && (
              <li className="rounded-lg border border-dashed border-border-strong p-8 text-center text-sm text-muted">
                ไม่มีคำสั่งซื้อในสถานะนี้
              </li>
            )}
            {visible.map((o) => {
              const sel = o.id === selected?.id;
              const k = KIND[o.kind];
              return (
                <li key={o.id}>
                  <Link
                    href={`${qs({ status: tabId, order: o.id })}#detail`}
                    aria-current={sel ? "true" : undefined}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 ${
                      sel ? "border-[1.5px] border-accent-hover bg-accent/10" : "glass hover:border-white/16"
                    }`}
                  >
                    <div className="w-[clamp(72px,8vw,112px)] shrink-0">
                      <Cover src={o.event.coverUrl} seed={o.event.id} className="rounded-sm" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-[15px] leading-[22px] font-semibold">{o.event.title}</span>
                      <span className="tabular text-xs text-muted">
                        <span className="font-mono">{orderRef(o.id)}</span> · {formatDayTime(o.createdAt)}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="tabular text-base font-bold">{formatBaht(o.amountSatang)}</span>
                      <span className={`badge badge-sm ${k.badge}`}>{k.label}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {selected && <OrderDetail order={selected} />}
        </div>
      )}
    </div>
  );
}

type Row = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }> & { kind: Kind };

/** Mirrors checkAccess() for an active ticket, from already-loaded rows. */
function ticketAccess(event: { status: EventStatus; endedAt: Date | null; replayDays: number }): "watch" | "wait" | "over" {
  if (event.status === "LIVE") return "watch";
  if (event.status === "ENDED") {
    const exp = replayExpiresAt(event.endedAt, event.replayDays);
    return exp && exp > new Date() ? "watch" : "over";
  }
  if (event.status === "ARCHIVED") return "over";
  return "wait";
}

function OrderDetail({ order }: { order: Row }) {
  const k = KIND[order.kind];
  const lastRejected = [...order.payments].reverse().find((p) => p.status === "REJECTED");

  const timeline: { label: string; time?: string; dot: string }[] = [
    { label: "สั่งซื้อ", time: formatDayTime(order.createdAt), dot: "bg-accent-hover" },
  ];
  for (const p of order.payments) {
    timeline.push({ label: "ส่งสลิป", time: formatDayTime(p.createdAt), dot: "bg-accent-hover" });
    const at = formatDayTime(p.reviewedAt ?? p.createdAt);
    if (p.status === "VERIFIED") timeline.push({ label: "ตรวจสลิปผ่าน · ออกตั๋ว", time: at, dot: "bg-success" });
    else if (p.status === "REJECTED") timeline.push({ label: "สลิปไม่ผ่าน", time: at, dot: "bg-danger" });
    else if (p.status === "NEEDS_REVIEW")
      timeline.push({ label: "รอทีมงานตรวจสลิป", time: "ระบบอ่านสลิปไม่ครบ ทีมงานจะตรวจให้", dot: "bg-warning" });
    else timeline.push({ label: "กำลังตรวจสลิป", dot: "bg-warning" });
  }
  if (order.status === "REFUNDED") timeline.push({ label: "คืนเงินแล้ว", dot: "bg-muted" });
  if (order.status === "CANCELLED") timeline.push({ label: "ยกเลิกคำสั่งซื้อ", dot: "bg-muted" });

  const access = order.ticket && !order.ticket.revoked ? ticketAccess(order.event) : null;

  return (
    <aside
      id="detail"
      aria-label="รายละเอียดคำสั่งซื้อ"
      className="glass-strong flex min-w-0 flex-[1_1_340px] scroll-mt-24 flex-col gap-4 rounded-xl p-[clamp(16px,1.6vw,22px)] min-[900px]:sticky min-[900px]:top-[84px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[13px] text-muted">{orderRef(order.id)}</span>
          <span className="text-[17px] leading-[1.4] font-bold">{order.event.title}</span>
          <span className="text-[13px] text-muted">{formatEventDate(order.event.startsAt)}</span>
        </div>
        <span className={`badge badge-sm ${k.badge}`}>{k.label}</span>
      </div>

      <ol className="flex flex-col">
        {timeline.map((s, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`mt-1.5 size-2.5 rounded-full ${s.dot}`} aria-hidden />
              {i < timeline.length - 1 && <span className="min-h-3.5 w-0.5 flex-1 bg-white/10" aria-hidden />}
            </div>
            <div className="flex flex-col pb-3">
              <span className="text-sm font-semibold">{s.label}</span>
              {s.time && <span className="tabular text-xs text-muted">{s.time}</span>}
            </div>
          </li>
        ))}
      </ol>

      {order.kind === "rejected" && lastRejected?.rejectReason && (
        <div className="flex flex-col gap-0.5 rounded-md border border-danger/35 bg-danger/8 px-3.5 py-3">
          <span className="text-xs text-danger-fg">เหตุผล</span>
          <span className="text-sm">{lastRejected.rejectReason}</span>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
        <dt className="text-muted">ยอด</dt>
        <dd className="tabular font-semibold">{formatBaht(order.amountSatang)}</dd>
        <dt className="text-muted">ชำระโดย</dt>
        <dd>โอนเงิน + สลิป</dd>
        <dt className="text-muted">รหัสตั๋ว</dt>
        <dd className="font-mono">
          {order.ticket ? `${order.ticket.id.slice(-8).toUpperCase()}${order.ticket.revoked ? " (ยกเลิกแล้ว)" : ""}` : "—"}
        </dd>
      </dl>

      <div className="flex flex-wrap gap-2">
        {access === "watch" && (
          <Link href={`/watch/${order.event.slug}`} className="btn btn-primary flex-[1_1_140px] shadow-none">
            ไปดู
          </Link>
        )}
        {access === "wait" && (
          <Link href={`/watch/${order.event.slug}`} className="btn btn-outline flex-[1_1_140px]">
            เปิดหน้ารอ live
          </Link>
        )}
        {order.kind === "rejected" && (
          <Link href={`/pay/${order.id}?retry=1`} className="btn btn-primary flex-[1_1_140px] shadow-none">
            แนบสลิปใหม่
          </Link>
        )}
        {order.kind === "unpaid" && (
          <Link href={`/pay/${order.id}`} className="btn btn-primary flex-[1_1_140px] shadow-none">
            ชำระเงิน
          </Link>
        )}
        {order.kind === "reviewing" && (
          <Link href={`/pay/${order.id}`} className="btn btn-secondary flex-[1_1_140px]">
            ดูสถานะการตรวจ
          </Link>
        )}
        <Link href={`/events/${order.event.slug}`} className="btn btn-secondary flex-[1_1_140px]">
          หน้า event
        </Link>
      </div>
    </aside>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { SESSION_STALE_SEC } from "@/lib/drm/view-session";
import { formatBaht, formatDayTime, formatShortDate, orderRef, viewerCode } from "@/lib/format";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE } from "@/lib/payment";
import { ROLE_LABEL } from "@/lib/roles";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  STAFF_STATUS_LABEL,
  STATUS_BADGE,
  STATUS_ORDER,
  caseRef,
  describeUserAgent,
  parseDeviceInfo,
} from "@/lib/support";
import { KICKED_DEVICE_ID } from "@/lib/viewers";
import { ChevronLeftIcon } from "@/components/ui/icons";
import CaseThread from "@/app/(site)/support/case-thread";
import ReplyForm from "@/app/(site)/support/reply-form";
import type { OrderStatus } from "@/generated/prisma/client";
import { assignToMeAction, updateCaseAction } from "../actions";
import { requireCasesStaff } from "../guard";

export const metadata = { title: "เคสลูกค้า" };

const ORDER_STATUS_LABEL: Record<OrderStatus, { label: string; badge: string }> = {
  PENDING: { label: "รอชำระ", badge: "badge-neutral" },
  PAID: { label: "ชำระแล้ว", badge: "badge-success" },
  CANCELLED: { label: "ยกเลิก", badge: "badge-neutral" },
  REFUNDED: { label: "คืนเงินแล้ว", badge: "badge-neutral" },
};

export default async function AdminCasePage({ params }: PageProps<"/admin/cases/[id]">) {
  const { id } = await params;
  const me = await requireCasesStaff(`/admin/cases/${id}`);

  const c = await db.supportCase.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, name: true, role: true, createdAt: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          isStaff: true,
          internal: true,
          createdAt: true,
          attachments: true,
          author: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!c) notFound();

  const [staff, canned, orders, tickets, payments, sessions, otherCases, event] = await Promise.all([
    db.user.findMany({
      where: { role: { not: "VIEWER" } },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true, role: true },
    }),
    db.cannedReply.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true, body: true } }),
    db.order.findMany({
      where: { userId: c.userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, amountSatang: true, createdAt: true, event: { select: { id: true, title: true } } },
    }),
    db.ticket.findMany({
      where: { userId: c.userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, revoked: true, event: { select: { id: true, title: true, status: true } } },
    }),
    db.payment.findMany({
      where: { order: { userId: c.userId } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, status: true, createdAt: true, orderId: true, order: { select: { amountSatang: true } } },
    }),
    db.viewSession.findMany({
      where: { userId: c.userId, lastSeenAt: { gt: staleCutoff() }, deviceId: { not: KICKED_DEVICE_ID } },
      select: { id: true, startedAt: true, lastSeenAt: true, event: { select: { id: true, title: true } } },
    }),
    db.supportCase.findMany({
      where: { userId: c.userId, id: { not: c.id } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, number: true, subject: true, status: true },
    }),
    c.eventId ? db.event.findUnique({ where: { id: c.eventId }, select: { id: true, title: true, status: true } }) : null,
  ]);

  const device = parseDeviceInfo(c.deviceInfo);
  const ref = caseRef(c.number);
  const paymentHref = (p: (typeof payments)[number]) => {
    const q = new URLSearchParams();
    if (p.status === "VERIFIED" || p.status === "REJECTED") q.set("tab", p.status);
    q.set("q", c.user.email);
    q.set("id", p.id);
    return `/admin/payments?${q}#detail`;
  };

  return (
    <>
      <Link href="/admin/cases" className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeftIcon size={18} /> คิวเคส
      </Link>

      <div className="flex flex-wrap items-start gap-5">
        <section
          aria-labelledby="case-title"
          className="glass-strong flex min-w-0 flex-[999_1_560px] flex-col gap-5 rounded-lg p-[clamp(16px,2vw,22px)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] text-muted">
                <span className="font-mono">{ref}</span> · {CATEGORY_LABEL[c.category]} · เปิดเมื่อ{" "}
                <span className="tabular">{formatDayTime(c.createdAt)}</span>
              </span>
              <h1 id="case-title" className="text-xl leading-[1.4] font-bold break-words">
                {c.subject}
              </h1>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {c.duringLive && <span className="badge badge-sm badge-live">ระหว่าง LIVE</span>}
              <span className={`badge badge-sm ${STATUS_BADGE[c.status]}`}>{STAFF_STATUS_LABEL[c.status]}</span>
            </div>
          </div>

          <form
            action={updateCaseAction.bind(null, c.id)}
            className="flex flex-wrap items-end gap-2.5 rounded-md border border-white/8 bg-white/[0.03] p-3"
          >
            <Field label="สถานะ">
              <select name="status" defaultValue={c.status} className="field min-w-[130px] text-sm">
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STAFF_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ความสำคัญ">
              <select name="priority" defaultValue={c.priority} className="field min-w-[120px] text-sm">
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ผู้รับผิดชอบ">
              <select name="assigneeId" defaultValue={c.assigneeId ?? ""} className="field min-w-[180px] text-sm">
                <option value="">ยังไม่มอบหมาย</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? s.email} · {ROLE_LABEL[s.role]}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn btn-sm btn-secondary min-h-11">บันทึก</button>
            {c.assigneeId !== me.id && (
              <button formAction={assignToMeAction.bind(null, c.id)} className="btn btn-sm btn-ghost min-h-11">
                รับเคสนี้
              </button>
            )}
          </form>

          <CaseThread messages={c.messages} viewer="staff" />

          <ReplyForm caseId={c.id} mode="staff" canned={canned} placeholder="พิมพ์คำตอบถึงลูกค้า" />
          <p className="-mt-2 text-xs text-subtle">
            ส่งคำตอบ → สถานะเป็น “รอลูกค้า” และแจ้งลูกค้าทาง email · โน้ตภายในลูกค้าไม่เห็น ·{" "}
            <Link href="/admin/cases/replies" className="text-link underline hover:text-link-hover">
              จัดการคำตอบสำเร็จรูป
            </Link>
          </p>
        </section>

        <aside aria-label="ข้อมูลลูกค้า" className="glass-admin flex min-w-0 flex-[1_1_300px] flex-col gap-4 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-linear-135 from-accent-hover to-glow text-base font-bold">
              {c.user.email.charAt(0).toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-[15px] font-semibold break-all">{c.user.email}</span>
              <span className="text-xs text-muted">
                {c.user.name ? `${c.user.name} · ` : ""}สมาชิกตั้งแต่ {formatShortDate(c.user.createdAt)}
                {c.user.role !== "VIEWER" && ` · ${ROLE_LABEL[c.user.role]}`}
              </span>
            </div>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-muted">Order</dt>
            <dd className="font-mono">{c.orderId ? orderRef(c.orderId) : "—"}</dd>
            <dt className="text-muted">Event</dt>
            <dd>
              {event ? (
                <Link href={`/admin/events/${event.id}`} className="text-link underline hover:text-link-hover">
                  {event.title}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-muted">เครื่อง</dt>
            <dd>{device ? describeUserAgent(device.userAgent) : "ไม่ได้แนบ"}</dd>
            <dt className="text-muted">DRM</dt>
            <dd>{device ? (device.drm ?? "ไม่รองรับระดับฮาร์ดแวร์") : "—"}</dd>
            {device?.downlinkMbps != null && (
              <>
                <dt className="text-muted">เน็ต</dt>
                <dd>~{device.downlinkMbps} Mbps</dd>
              </>
            )}
            <dt className="text-muted">รหัสคนดู</dt>
            <dd className="font-mono">{viewerCode(c.user.id)}</dd>
          </dl>
          {device?.userAgent && (
            <details className="text-xs text-muted">
              <summary className="flex min-h-9 cursor-pointer items-center">User agent / ข้อมูลเครื่องเต็ม</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-bg/60 p-2.5 whitespace-pre-wrap">
                {JSON.stringify(device, null, 2)}
              </pre>
            </details>
          )}

          <Panel title={`ดูอยู่ตอนนี้ (${sessions.length})`} action={<Link href="/admin/viewers">การเข้าชม ↗</Link>}>
            {sessions.length === 0 ? (
              <Empty>ไม่ได้ดูอยู่</Empty>
            ) : (
              sessions.map((s) => (
                <Row key={s.id}>
                  <span className="min-w-0 truncate">{s.event.title}</span>
                  <span className="tabular shrink-0 text-xs text-muted">ล่าสุด {formatDayTime(s.lastSeenAt)}</span>
                </Row>
              ))
            )}
          </Panel>

          <Panel title="คำสั่งซื้อ">
            {orders.length === 0 ? (
              <Empty>ไม่มีคำสั่งซื้อ</Empty>
            ) : (
              orders.map((o) => (
                <Row key={o.id}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{o.event.title}</span>
                    <span className="text-xs text-muted">
                      <span className="font-mono">{orderRef(o.id)}</span> · {formatBaht(o.amountSatang)}
                    </span>
                  </span>
                  <span className={`badge badge-sm shrink-0 ${ORDER_STATUS_LABEL[o.status].badge}`}>
                    {ORDER_STATUS_LABEL[o.status].label}
                  </span>
                </Row>
              ))
            )}
          </Panel>

          <Panel title="ตั๋ว">
            {tickets.length === 0 ? (
              <Empty>ไม่มีตั๋ว</Empty>
            ) : (
              tickets.map((t) => (
                <Row key={t.id}>
                  <span className="min-w-0 truncate">{t.event.title}</span>
                  <span className={`badge badge-sm shrink-0 ${t.revoked ? "badge-danger" : "badge-success"}`}>
                    {t.revoked ? "ถูกยกเลิก" : "ใช้ได้"}
                  </span>
                </Row>
              ))
            )}
          </Panel>

          <Panel title="การชำระเงินล่าสุด">
            {payments.length === 0 ? (
              <Empty>ยังไม่เคยส่งสลิป</Empty>
            ) : (
              payments.map((p) => (
                <Row key={p.id}>
                  <Link href={paymentHref(p)} className="flex min-w-0 flex-col text-link hover:text-link-hover">
                    <span className="font-mono text-[13px] underline">{orderRef(p.orderId)}</span>
                    <span className="tabular text-xs text-muted">
                      {formatDayTime(p.createdAt)} · {formatBaht(p.order.amountSatang)}
                    </span>
                  </Link>
                  <span className={`badge badge-sm shrink-0 ${PAYMENT_STATUS_STYLE[p.status]}`}>
                    {PAYMENT_STATUS_LABEL[p.status]}
                  </span>
                </Row>
              ))
            )}
          </Panel>

          <Panel title="เคสอื่นของลูกค้า">
            {otherCases.length === 0 ? (
              <Empty>ไม่มี</Empty>
            ) : (
              otherCases.map((o) => (
                <Row key={o.id}>
                  <Link href={`/admin/cases/${o.id}`} className="flex min-w-0 flex-col hover:underline">
                    <span className="font-mono text-xs text-muted">{caseRef(o.number)}</span>
                    <span className="truncate">{o.subject}</span>
                  </Link>
                  <span className={`badge badge-sm shrink-0 ${STATUS_BADGE[o.status]}`}>{STAFF_STATUS_LABEL[o.status]}</span>
                </Row>
              ))
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}

/** Sessions without a heartbeat since this time are no longer watching. */
function staleCutoff() {
  return new Date(Date.now() - SESSION_STALE_SEC * 1000);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {children}
    </label>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-white/8 pt-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-muted">{title}</h2>
        {action && <span className="text-xs text-link hover:text-link-hover">{action}</span>}
      </div>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <li className="flex items-center justify-between gap-2 text-[13px]">{children}</li>;
}

function Empty({ children }: { children: ReactNode }) {
  return <li className="text-[13px] text-subtle">{children}</li>;
}

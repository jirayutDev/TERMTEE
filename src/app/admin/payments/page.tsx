import Link from "next/link";
import type { ReactNode } from "react";
import type { PaymentStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { formatBaht, formatDayTime, orderRef } from "@/lib/format";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE, parseChecks } from "@/lib/payment";
import type { SlipCheckResult } from "@/lib/slip/types";
import { CheckIcon, WarningIcon, XMarkIcon } from "@/components/ui/icons";
import { approvePaymentAction, rejectPaymentAction } from "./actions";
import RejectDialog from "./reject-dialog";
import { getSettingsSection } from "@/lib/settings";
import { pageUser } from "../guard";

export const metadata = { title: "ตรวจสลิป" };

const TABS = [
  { status: "NEEDS_REVIEW", label: "รอตรวจ" },
  { status: "VERIFIED", label: "ผ่านแล้ว (สุ่มตรวจ)" },
  { status: "REJECTED", label: "ไม่ผ่าน" },
] as const satisfies readonly { status: PaymentStatus; label: string }[];

type Tab = (typeof TABS)[number]["status"];

const CHECK_LABEL: Record<SlipCheckResult["name"], string> = {
  qr: "QR สลิป",
  amount: "ยอดเงิน",
  time: "เวลาโอน",
  receiver: "ผู้รับ",
  duplicate: "สลิปซ้ำ",
  provider: "ยืนยันธนาคาร",
};

const RESULT_STYLE: Record<SlipCheckResult["result"], { cls: string; label: string }> = {
  pass: { cls: "text-success", label: "ผ่าน" },
  fail: { cls: "text-danger-fg", label: "ไม่ผ่าน" },
  unknown: { cls: "text-warning", label: "อ่านไม่ได้" },
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Midnight today in Bangkok (UTC+7, no DST). */
function startOfBangkokDay(now = new Date()): Date {
  const shifted = new Date(now.getTime() + 7 * 3600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 7 * 3600_000);
}

function minutesAgo(d: Date) {
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  return m < 60 ? `${m} นาที` : `${Math.floor(m / 60)} ชม. ${m % 60} นาที`;
}

export default async function AdminPaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  await pageUser("payments", "/admin/payments");
  const sp = await searchParams;
  const raw = one(sp.tab);
  const tab: Tab = TABS.some((t) => t.status === raw) ? (raw as Tab) : "NEEDS_REVIEW";
  const q = (one(sp.q) ?? "").trim();
  const today = startOfBangkokDay();
  const { rejectReasons } = await getSettingsSection("payment");

  const where: Prisma.PaymentWhereInput = {
    status: tab,
    ...(q
      ? {
          OR: [
            { order: { user: { email: { contains: q, mode: "insensitive" } } } },
            { orderId: { endsWith: q.replace(/^#/, "").toLowerCase() } },
            { transRef: { contains: q } },
          ],
        }
      : {}),
  };

  const [counts, payments, oldestWaiting, verifiedToday, rejectedToday] = await Promise.all([
    db.payment.groupBy({ by: ["status"], _count: { _all: true } }),
    db.payment.findMany({
      where,
      // Review queue: oldest first. History tabs: newest first.
      orderBy: { createdAt: tab === "NEEDS_REVIEW" ? "asc" : "desc" },
      take: 50,
      include: {
        order: {
          select: {
            id: true,
            amountSatang: true,
            status: true,
            createdAt: true,
            user: { select: { email: true } },
            event: { select: { title: true, id: true } },
          },
        },
      },
    }),
    db.payment.findFirst({ where: { status: "NEEDS_REVIEW" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.payment.findMany({
      where: { status: "VERIFIED", createdAt: { gte: today } },
      select: { order: { select: { amountSatang: true } } },
    }),
    db.payment.count({ where: { status: "REJECTED", createdAt: { gte: today } } }),
  ]);
  const count = new Map(counts.map((c) => [c.status, c._count._all]));
  const waiting = count.get("NEEDS_REVIEW") ?? 0;
  const verifiedSum = verifiedToday.reduce((s, p) => s + p.order.amountSatang, 0);
  const selected = payments.find((p) => p.id === one(sp.id)) ?? payments[0] ?? null;

  const href = (params: { tab?: string; id?: string }) => {
    const p = new URLSearchParams();
    const t = params.tab ?? tab;
    if (t !== "NEEDS_REVIEW") p.set("tab", t);
    if (q && !params.tab) p.set("q", q);
    if (params.id) p.set("id", params.id);
    const s = p.toString();
    return s ? `/admin/payments?${s}` : "/admin/payments";
  };

  return (
    <>
      <div className="flex flex-col">
        <h1 className="text-[28px] leading-[38px] font-bold">ตรวจสอบสลิป</h1>
        <span className="text-sm text-muted">
          ระบบตรวจสลิปอัตโนมัติ · รายการที่อ่านไม่ครบจะมารอที่นี่ ตรวจแล้วกดอนุมัติเพื่อออกตั๋ว
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
        <Link
          href={href({ tab: "NEEDS_REVIEW" })}
          className="flex flex-col gap-0.5 rounded-[14px] border border-warning/40 bg-warning/8 p-4 hover:bg-warning/12"
        >
          <span className="text-xs text-[#F7D9A0]">รอตรวจ</span>
          <span className="tabular text-2xl font-bold">{waiting.toLocaleString("th-TH")}</span>
          <span className="text-xs text-[#F7D9A0]">
            {oldestWaiting ? `รอนานสุด ${minutesAgo(oldestWaiting.createdAt)} →` : "ไม่มีรายการค้าง"}
          </span>
        </Link>
        <SummaryCard label="ผ่านวันนี้" value={formatBaht(verifiedSum)} sub={`${verifiedToday.length.toLocaleString("th-TH")} สลิป`} />
        <SummaryCard label="ไม่ผ่านวันนี้" value={rejectedToday.toLocaleString("th-TH")} sub="สลิป" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="สถานะ" className="segmented">
          {TABS.map((t) => (
            <Link key={t.status} href={href({ tab: t.status })} aria-current={t.status === tab ? "page" : undefined}>
              {t.label} ({(count.get(t.status) ?? 0).toLocaleString("th-TH")})
            </Link>
          ))}
        </nav>
        <form action="/admin/payments" className="flex gap-2">
          {tab !== "NEEDS_REVIEW" && <input type="hidden" name="tab" value={tab} />}
          <input
            type="search"
            name="q"
            aria-label="ค้นหา"
            defaultValue={q}
            placeholder="ค้นหา email, Order, เลขอ้างอิง"
            className="field w-[260px] max-w-full text-sm"
          />
          <button className="btn btn-sm btn-secondary min-h-11">ค้นหา</button>
        </form>
      </div>

      {payments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong p-10 text-center text-muted">ไม่มีรายการ</p>
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <div className="glass-admin min-w-0 flex-[999_1_520px] overflow-x-auto rounded-lg">
            <table className="data-table min-w-[640px]">
              <thead>
                <tr>
                  <th scope="col">ส่งสลิป</th>
                  <th scope="col">Order</th>
                  <th scope="col">คนซื้อ · event</th>
                  <th scope="col" className="text-right!">ยอด</th>
                  <th scope="col">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const sel = p.id === selected?.id;
                  const mismatch = p.amountSatang != null && p.amountSatang !== p.order.amountSatang;
                  return (
                    <tr key={p.id} className={sel ? "bg-accent/12" : undefined}>
                      <td className="tabular whitespace-nowrap text-soft">
                        {formatDayTime(p.createdAt)}
                        {tab === "NEEDS_REVIEW" && (
                          <span className="block text-xs text-subtle">{minutesAgo(p.createdAt)}</span>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`${href({ id: p.id })}#detail`}
                          aria-current={sel ? "true" : undefined}
                          className="inline-flex min-h-8 items-center font-mono text-[13px] text-link underline hover:text-link-hover"
                        >
                          {orderRef(p.order.id)}
                        </Link>
                      </td>
                      <td>
                        <div className="flex flex-col">
                          <span className="break-all">{p.order.user.email}</span>
                          <span className="text-xs text-subtle">{p.order.event.title}</span>
                        </div>
                      </td>
                      <td className="tabular text-right font-semibold">{formatBaht(p.order.amountSatang)}</td>
                      <td className="whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <span className={`badge badge-sm ${PAYMENT_STATUS_STYLE[p.status]}`}>
                            {PAYMENT_STATUS_LABEL[p.status]}
                          </span>
                          {mismatch && <span className="text-xs text-danger-fg">ยอดไม่ตรง</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected && <Detail p={selected} rejectReasons={rejectReasons} />}
        </div>
      )}
    </>
  );
}

type Row = Prisma.PaymentGetPayload<{
  include: {
    order: {
      select: {
        id: true;
        amountSatang: true;
        status: true;
        createdAt: true;
        user: { select: { email: true } };
        event: { select: { title: true; id: true } };
      };
    };
  };
}>;

function Detail({ p, rejectReasons }: { p: Row; rejectReasons: string[] }) {
  const checks = parseChecks(p.checks);
  const mismatch = p.amountSatang != null && p.amountSatang !== p.order.amountSatang;
  const dup = checks.some((c) => c.name === "duplicate" && c.result === "fail");

  return (
    <aside
      id="detail"
      aria-label="ตรวจสลิป"
      className="glass-strong flex min-w-0 flex-[1_1_360px] scroll-mt-6 flex-col gap-4 rounded-lg p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-[13px] text-muted">
            {orderRef(p.order.id)} · {p.order.status}
          </span>
          <span className="text-[15px] font-semibold break-all">{p.order.user.email}</span>
          <Link href={`/admin/events/${p.order.event.id}`} className="text-xs text-muted hover:text-fg">
            {p.order.event.title}
          </Link>
        </div>
        <span className={`badge badge-sm ${PAYMENT_STATUS_STYLE[p.status]}`}>{PAYMENT_STATUS_LABEL[p.status]}</span>
      </div>

      <div className="flex flex-wrap gap-3.5">
        <div className="flex max-w-[200px] flex-[1_1_140px] flex-col gap-1.5">
          <a href={`/api/admin/slips/${p.id}`} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/admin/slips/${p.id}`}
              alt={`สลิปของ ${p.order.user.email}`}
              loading="lazy"
              className="aspect-[3/4] w-full rounded-md bg-white object-contain"
            />
          </a>
          <a
            href={`/api/admin/slips/${p.id}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm btn-outline min-h-9 text-[13px]"
          >
            ขยายรูป ↗
          </a>
        </div>
        <dl className="grid flex-[1_1_180px] grid-cols-[auto_1fr] content-start gap-x-3 gap-y-2 text-[13px]">
          <Def label="ต้องโอน">
            <span className="tabular font-bold">{formatBaht(p.order.amountSatang)}</span>
          </Def>
          <Def label="ยอดจากสลิป">
            <span className={`tabular ${mismatch ? "font-semibold text-danger-fg" : ""}`}>
              {p.amountSatang != null ? formatBaht(p.amountSatang) : "—"}
            </span>
          </Def>
          <Def label="เวลาโอน">{p.transferredAt ? formatDayTime(p.transferredAt) : "—"}</Def>
          <Def label="สั่งซื้อเมื่อ">{formatDayTime(p.order.createdAt)}</Def>
          <Def label="ผู้รับ">
            {p.receiverName ?? "—"}
            {p.receiverAccount && <span className="block text-xs text-muted">{p.receiverAccount}</span>}
          </Def>
          <Def label="ธนาคารผู้โอน">{p.sendingBank ?? "—"}</Def>
          <Def label="เลขอ้างอิง">
            <code className="font-mono text-xs break-all">{p.transRef ?? "—"}</code>
          </Def>
          {p.verifiedBy && <Def label="ตรวจโดย">{p.verifiedBy}</Def>}
        </dl>
      </div>

      {dup && (
        <div role="alert" className="flex items-start gap-2.5 rounded-md border border-danger/45 bg-danger/10 px-3.5 py-3">
          <WarningIcon size={18} className="mt-0.5 shrink-0 text-danger-fg" />
          <span className="text-[13px] leading-5 text-[#FFC2CD]">เลขอ้างอิงนี้เคยใช้แล้ว · น่าจะเป็นสลิปซ้ำ</span>
        </div>
      )}

      {checks.length > 0 && (
        <div className="flex flex-col gap-0.5 rounded-md border border-white/10 px-3.5 py-3">
          <span className="mb-1 text-xs font-semibold text-muted">ผลตรวจอัตโนมัติ</span>
          <ul className="flex flex-col gap-1.5 text-sm">
            {checks.map((c, i) => (
              <li key={`${c.name}-${i}`} className="flex items-start gap-2">
                <span className={`mt-0.5 shrink-0 ${RESULT_STYLE[c.result].cls}`}>
                  {c.result === "pass" ? <CheckIcon size={16} /> : c.result === "fail" ? <XMarkIcon size={16} /> : <WarningIcon size={16} />}
                  <span className="sr-only">{RESULT_STYLE[c.result].label}</span>
                </span>
                <span>
                  <span className="font-medium">{CHECK_LABEL[c.name] ?? c.name}</span>{" "}
                  <span className="text-muted">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.rejectReason && (
        <div className="flex flex-col gap-1 rounded-md bg-white/[0.04] px-3.5 py-3">
          <span className="text-xs text-muted">เหตุผลที่ส่งให้ลูกค้า</span>
          <span className="text-sm">{p.rejectReason}</span>
        </div>
      )}

      {p.ocrText && (
        <details className="text-xs text-muted">
          <summary className="flex min-h-11 cursor-pointer items-center">ข้อความที่อ่านได้ (OCR)</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-bg/60 p-3 whitespace-pre-wrap">{p.ocrText}</pre>
        </details>
      )}

      <div className="flex flex-col gap-2 border-t border-white/8 pt-4">
        {p.status !== "VERIFIED" && (
          <form action={approvePaymentAction.bind(null, p.id)}>
            <button className="btn min-h-12 w-full btn-primary shadow-none">อนุมัติ · ออกตั๋ว</button>
          </form>
        )}
        {p.status !== "REJECTED" && (
          <RejectDialog
            action={rejectPaymentAction.bind(null, p.id)}
            email={p.order.user.email}
            wasVerified={p.status === "VERIFIED"}
            presets={rejectReasons}
          />
        )}
      </div>
    </aside>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="glass-admin flex flex-col gap-0.5 rounded-[14px] p-4">
      <span className="text-xs text-muted">{label}</span>
      <span className="tabular text-2xl font-bold">{value}</span>
      <span className="text-xs text-muted">{sub}</span>
    </div>
  );
}

function Def({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

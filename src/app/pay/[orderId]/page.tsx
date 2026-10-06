import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { formatBaht, formatDayTime, formatEventDate, orderRef } from "@/lib/format";
import { loginUrl } from "@/lib/safe-redirect";
import { getSettingsSection } from "@/lib/settings";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE, customerChecks, promptPayQrDataUrl } from "@/lib/payment";
import { Cover } from "@/components/ui/primitives";
import { CopyButton } from "@/components/ui/copy-button";
import { BankIcon, CheckIcon, ChevronLeftIcon, ReceiptIcon, XMarkIcon } from "@/components/ui/icons";
import SlipUpload from "./slip-upload";
import PaymentPoller from "./payment-poller";

export const metadata: Metadata = { title: "ชำระเงิน", robots: { index: false } };

export default async function PayPage({ params, searchParams }: PageProps<"/pay/[orderId]">) {
  const { orderId } = await params;
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect(loginUrl(`/pay/${orderId}`));

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      event: { select: { id: true, title: true, slug: true, startsAt: true, coverUrl: true, replayDays: true } },
      payments: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  // Only the owner may see the order; don't reveal that it exists otherwise.
  if (!order || order.userId !== user.id) notFound();

  const { event } = order;
  const latest = order.payments[0] ?? null;
  const amount = formatBaht(order.amountSatang);
  const isRetry = sp.retry === "1";

  // ---------- Result screens ----------
  if (order.status === "PAID") {
    return (
      <ResultScreen glow="rgba(34,195,142,0.20)">
        <span className="grid size-[clamp(64px,10vh,88px)] place-items-center rounded-full bg-success text-[#06231A] shadow-[0_0_0_10px_rgba(34,195,142,0.16)]">
          <CheckIcon size={44} />
        </span>
        <h1 className="mt-2 text-[clamp(24px,1vw+20px,30px)] leading-[1.4] font-bold">ยืนยันการชำระเงินแล้ว</h1>
        <p className="text-[15px] leading-6 text-soft">
          สลิปผ่านการตรวจแล้ว ตั๋ว {event.title} อยู่ใน &quot;ตั๋วของฉัน&quot; แล้ว
        </p>
        <Summary
          rows={[
            ["ยอดชำระ", amount],
            ["เริ่ม live", formatEventDate(event.startsAt)],
          ]}
        />
        <div className="flex w-full flex-wrap gap-2.5">
          <Link href={`/watch/${event.slug}`} className="btn btn-lg btn-primary flex-[1_1_200px]">
            ไปดู
          </Link>
          <Link href="/library" className="btn btn-lg btn-outline flex-[1_1_200px] text-[15px]">
            ดูตั๋วของฉัน
          </Link>
        </div>
      </ResultScreen>
    );
  }

  if (order.status === "CANCELLED" || order.status === "REFUNDED") {
    return (
      <ResultScreen glow="rgba(43,92,255,0.18)">
        <span className="grid size-[clamp(64px,10vh,88px)] place-items-center rounded-full bg-white/8 text-muted">
          <ReceiptIcon size={40} />
        </span>
        <h1 className="mt-2 text-[clamp(24px,1vw+20px,30px)] leading-[1.4] font-bold">
          {order.status === "REFUNDED" ? "คำสั่งซื้อนี้ได้รับการคืนเงินแล้ว" : "คำสั่งซื้อนี้ถูกยกเลิกแล้ว"}
        </h1>
        <Summary rows={[["Order", orderRef(order.id)], ["ยอด", amount]]} />
        <Link href={`/events/${event.slug}`} className="btn btn-lg btn-primary w-full">
          สั่งซื้อใหม่จากหน้า event
        </Link>
      </ResultScreen>
    );
  }

  if (latest && (latest.status === "NEEDS_REVIEW" || latest.status === "PROCESSING")) {
    const review = latest.status === "NEEDS_REVIEW";
    return (
      <ResultScreen glow="rgba(43,92,255,0.24)">
        <PaymentPoller paymentId={latest.id} status={latest.status} />
        <span className="grid size-[clamp(64px,10vh,88px)] place-items-center rounded-full bg-warning/16 text-warning shadow-[0_0_0_10px_rgba(245,181,68,0.08)]">
          <ReceiptIcon size={40} strokeWidth={2} />
        </span>
        <h1 className="mt-2 text-[clamp(24px,1vw+20px,30px)] leading-[1.4] font-bold">
          {review ? "ได้รับสลิปแล้ว · รอทีมงานตรวจ" : "กำลังตรวจสลิป…"}
        </h1>
        <p className="text-[15px] leading-6 text-soft">
          {review
            ? "ระบบอ่านข้อมูลบางส่วนจากสลิปไม่ได้ ทีมงานจะตรวจสลิปให้ ผ่านแล้วตั๋วจะขึ้นใน “ตั๋วของฉัน” ทันที"
            : "ระบบกำลังตรวจยอด เวลาโอน และบัญชีผู้รับจากสลิป"}{" "}
          หน้านี้อัปเดตเองอัตโนมัติ หรือปิดแล้วกลับมาดูที่ “ตั๋วของฉัน” ภายหลังได้
        </p>
        <Summary
          rows={[
            ["Order", <span key="o" className="font-mono">{orderRef(order.id)}</span>],
            ["ส่งสลิปเมื่อ", `${formatDayTime(latest.createdAt)} น.`],
          ]}
        />
        <Link href="/library" className="btn btn-outline min-h-12 w-full">
          ไปที่ตั๋วของฉัน
        </Link>
      </ResultScreen>
    );
  }

  if (latest?.status === "REJECTED" && !isRetry) {
    const checks = customerChecks(latest.checks);
    return (
      <ResultScreen glow="rgba(240,80,110,0.18)">
        <span className="grid size-[clamp(64px,10vh,88px)] place-items-center rounded-full bg-danger text-[#2A0710] shadow-[0_0_0_10px_rgba(240,80,110,0.14)]">
          <XMarkIcon size={40} />
        </span>
        <h1 className="mt-2 text-[clamp(24px,1vw+20px,30px)] leading-[1.4] font-bold">สลิปไม่ผ่านการตรวจสอบ</h1>
        <div role="alert" className="flex w-full flex-col gap-1 rounded-[14px] border border-danger/35 bg-danger/8 p-3.5 text-left">
          <span className="text-xs text-danger-fg">เหตุผล</span>
          <span className="text-[15px] leading-6">{latest.rejectReason ?? "สลิปไม่ผ่านการตรวจสอบ"}</span>
          {checks.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-[13px] leading-5 text-soft">
              {checks.map((c) => (
                <li key={c.name}>{c.detail}</li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-sm leading-[22px] text-soft">ตรวจสอบยอดและบัญชีผู้รับ แล้วแนบสลิปที่ถูกต้องอีกครั้ง</p>
        <div className="flex w-full flex-wrap gap-2.5">
          <Link href={`/pay/${order.id}?retry=1`} className="btn btn-lg btn-primary flex-[1_1_200px]">
            แนบสลิปใหม่
          </Link>
          <Link href={`/events/${event.slug}`} className="btn btn-lg btn-outline flex-[1_1_200px] text-[15px]">
            กลับไปหน้า event
          </Link>
        </div>
      </ResultScreen>
    );
  }

  // ---------- Transfer + upload ----------
  const { promptPayId, displayName, displayBank } = await getSettingsSection("payment");
  const qr = await promptPayQrDataUrl(order.amountSatang, promptPayId);
  const amountPlain = (order.amountSatang / 100).toFixed(2);

  return (
    <div
      className="flex min-h-dvh flex-1 flex-col bg-bg"
      style={{ backgroundImage: "radial-gradient(min(900px,130vw) 600px at 0% 0%, rgba(43,92,255,0.22), transparent 65%)" }}
    >
      <header className="border-b border-border-soft bg-bg/72">
        <div className="mx-auto flex min-h-[60px] max-w-[1040px] items-center gap-1 px-2 sm:px-6">
          <Link href={`/events/${event.slug}`} aria-label="กลับไปหน้า event" className="btn-icon">
            <ChevronLeftIcon size={22} />
          </Link>
          <h1 className="text-[clamp(17px,0.6vw+15px,22px)] font-semibold">ชำระเงิน</h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1040px] flex-wrap-reverse items-end gap-[clamp(20px,3vw,32px)] px-4 pt-[clamp(20px,3vw,40px)] pb-10 sm:px-6">
        <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-5">
          <section aria-labelledby="s1" className="glass-strong flex flex-col gap-3.5 rounded-xl p-[clamp(16px,2vw,24px)]">
            <div className="flex items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-full bg-accent text-sm font-bold">1</span>
              <h2 id="s1" className="text-[17px] font-bold">
                โอนเงินเข้าบัญชีนี้
              </h2>
            </div>

            {(displayBank || displayName) && (
              <div className="flex items-center gap-3">
                <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-white/8 text-accent-fg">
                  <BankIcon size={26} />
                </span>
                <div className="flex min-w-0 flex-col">
                  {displayBank && <span className="text-base font-semibold whitespace-pre-line">{displayBank}</span>}
                  {displayName && <span className="text-[13px] text-muted">ชื่อบัญชี {displayName}</span>}
                </div>
              </div>
            )}

            <div className="flex flex-col items-stretch gap-3.5 sm:flex-row sm:items-start">
              {qr ? (
                <div className="shrink-0 self-center rounded-md bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt={`PromptPay QR ยอด ${amount}`} width={200} height={200} className="size-[200px]" />
                </div>
              ) : null}
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                {promptPayId && (
                  <CopyRow label="พร้อมเพย์" value={promptPayId} copyLabel="เลขพร้อมเพย์" mono />
                )}
                <CopyRow label="ยอดที่ต้องโอน" value={amountPlain} display={formatBaht(order.amountSatang)} copyLabel="ยอดเงิน" />
                {qr && (
                  <p className="text-[13px] leading-5 text-muted">
                    สแกน QR ด้วยแอปธนาคารใดก็ได้ ยอดเงินจะถูกกรอกให้อัตโนมัติ
                  </p>
                )}
                {!qr && !displayBank && !promptPayId && (
                  <p className="text-[13px] text-muted">ยังไม่ได้ตั้งค่าบัญชีรับเงิน</p>
                )}
              </div>
            </div>
            <span className="text-[13px] leading-5 text-[#F7D9A0]">
              โอนยอดให้ตรง {formatBaht(order.amountSatang)} พอดี · โอนครั้งเดียวต่อ 1 ตั๋ว
            </span>
          </section>

          <SlipUpload orderId={order.id} isRetry={isRetry} />
        </div>

        <aside aria-label="สรุปคำสั่งซื้อ" className="glass flex min-w-0 flex-[1_1_320px] flex-col gap-3.5 rounded-xl p-[clamp(12px,1.6vw,20px)]">
          <div className="flex gap-3">
            <div className="w-[104px] shrink-0">
              <Cover src={event.coverUrl} seed={event.id} className="rounded-[10px]" />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] leading-[22px] font-semibold">{event.title}</span>
              <span className="tabular text-xs text-muted">{formatEventDate(event.startsAt)}</span>
              <span className="text-xs text-muted">
                ตั๋ว 1 ใบ · 1 เครื่อง{event.replayDays > 0 ? ` · ดูย้อนหลัง ${event.replayDays} วัน` : ""}
              </span>
            </div>
          </div>
          <div className="h-px bg-white/8" />
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold">ยอดชำระ</span>
            <span className="tabular text-2xl font-bold">{amount}</span>
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>Order</span>
            <span className="font-mono">{orderRef(order.id)}</span>
          </div>
          {order.payments.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-white/8 pt-3">
              <h2 className="text-xs font-semibold text-muted">ประวัติการส่งสลิป</h2>
              <ul className="flex flex-col gap-2 text-xs">
                {order.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="tabular text-muted">{formatDayTime(p.createdAt)}</span>
                    <span className={`badge badge-sm ${PAYMENT_STATUS_STYLE[p.status]}`}>{PAYMENT_STATUS_LABEL[p.status]}</span>
                    {p.status === "REJECTED" && p.rejectReason && (
                      <span className="w-full text-danger-fg">{p.rejectReason}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function ResultScreen({ glow, children }: { glow: string; children: ReactNode }) {
  return (
    <main
      className="flex min-h-dvh flex-1 items-center justify-center bg-bg px-4 py-[clamp(16px,4vh,48px)]"
      style={{ backgroundImage: `radial-gradient(min(700px,120vw) 500px at 50% 25%, ${glow}, transparent 70%)` }}
    >
      <div className="flex w-full max-w-[480px] flex-col items-center gap-[clamp(10px,2vh,16px)] text-center">{children}</div>
    </main>
  );
}

function Summary({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="flex w-full flex-col gap-1 rounded-[14px] bg-white/[0.04] p-3.5 text-[13px] text-muted">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <dt>{k}</dt>
          <dd className="tabular text-right font-semibold text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyRow({
  label,
  value,
  display,
  copyLabel,
  mono = false,
}: {
  label: string;
  value: string;
  display?: string;
  copyLabel: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] border border-white/10 bg-bg/60 px-3.5 py-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-muted">{label}</span>
        <span
          className={
            mono
              ? "truncate font-mono text-[clamp(18px,1vw+14px,22px)] font-medium tracking-[0.04em]"
              : "tabular text-[clamp(22px,1vw+18px,28px)] font-bold"
          }
        >
          {display ?? value}
        </span>
      </div>
      <CopyButton value={value} label={copyLabel} />
    </div>
  );
}

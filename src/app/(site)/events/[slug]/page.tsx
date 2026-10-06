import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/auth";
import { can } from "@/lib/roles";
import { isOnSale, replayExpiresAt } from "@/lib/access";
import { formatBaht, formatEventDate } from "@/lib/format";
import BuyPanel, { type BuyCta } from "@/components/buy-panel";
import { Cover, LiveBadge } from "@/components/ui/primitives";
import { ShareButton } from "@/components/ui/copy-button";
import { CalendarIcon, ChevronLeftIcon, PhoneIcon, ReplayIcon } from "@/components/ui/icons";
import { signInWithGoogleAction } from "../../../auth-actions";

async function getEvent(slug: string) {
  return db.event.findUnique({ where: { slug } });
}

export async function generateMetadata({ params }: PageProps<"/events/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEvent(slug);
  if (!event || event.status === "DRAFT") return {};
  return { title: event.title, description: event.description ?? undefined };
}

export default async function EventPage({ params }: PageProps<"/events/[slug]">) {
  const { slug } = await params;
  const [event, user] = await Promise.all([getEvent(slug), currentUser()]);
  if (!event) notFound();
  if (event.status === "DRAFT" && !can(user?.role, "events")) notFound();

  const ticket = user
    ? await db.ticket.findUnique({
        where: { userId_eventId: { userId: user.id, eventId: event.id } },
        select: { revoked: true },
      })
    : null;
  const hasTicket = !!ticket && !ticket.revoked;

  const now = new Date();
  const replayEnd = replayExpiresAt(event.endedAt, event.replayDays);
  const replayOpen = event.status === "ENDED" && !!replayEnd && replayEnd > now;
  const onSale = isOnSale(event, now);
  const canWatchNow = event.status === "LIVE" || replayOpen;
  const replayOver = event.status === "ARCHIVED" || (event.status === "ENDED" && !replayOpen);
  const price = formatBaht(event.priceSatang);

  // ---- Badge ----
  const badge = hasTicket
    ? { label: "มีตั๋วแล้ว", cls: "badge-success" }
    : event.status === "ENDED" && replayOpen
      ? { label: "Replay", cls: "badge-replay" }
      : replayOver
        ? { label: "หมดอายุ", cls: "badge-neutral" }
        : event.status === "DRAFT"
          ? { label: "Draft", cls: "badge-neutral" }
          : { label: "เร็วๆ นี้", cls: "badge-soon" };

  // ---- CTA + note ----
  let cta: BuyCta;
  let note: string;
  if (hasTicket) {
    if (canWatchNow) {
      cta = { kind: "watch", href: `/watch/${event.slug}` };
      note =
        event.status === "LIVE"
          ? "คุณมีตั๋วแล้ว · กำลัง live อยู่"
          : `คุณมีตั๋วแล้ว · ดูย้อนหลังได้ถึง ${formatEventDate(replayEnd!)}`;
    } else if (replayOver) {
      cta = { kind: "disabled", label: "หมดเวลาดูย้อนหลังแล้ว" };
      note = "ช่วงดูย้อนหลังของ event นี้สิ้นสุดแล้ว";
    } else {
      cta = { kind: "wait", href: `/watch/${event.slug}` };
      note = `คุณมีตั๋วแล้ว · กลับมาดูได้เมื่อ live เริ่ม ${formatEventDate(event.startsAt)}`;
    }
  } else if (!onSale) {
    cta = { kind: "disabled", label: replayOver ? "หมดเวลาดูย้อนหลังแล้ว" : event.status === "DRAFT" ? "ยังไม่เปิดขาย" : "ปิดการขายแล้ว" };
    note = replayOver ? "ช่วงดูย้อนหลังของ event นี้สิ้นสุดแล้ว" : "event นี้ยังไม่เปิดขายตั๋ว";
  } else {
    const label = replayOpen ? `ซื้อตั๋วดูย้อนหลัง · ${price}` : `ซื้อตั๋ว · ${price}`;
    cta = user ? { kind: "buy", eventId: event.id, label } : { kind: "login", label: "เข้าสู่ระบบเพื่อซื้อตั๋ว" };
    note =
      event.status === "LIVE"
        ? "กำลัง live อยู่ · แนบสลิปแล้วระบบตรวจอัตโนมัติ ผ่านแล้วเข้าดูได้ทันที"
        : replayOpen
          ? `ดูย้อนหลังได้ถึง ${formatEventDate(replayEnd!)} · แนบสลิปแล้วระบบตรวจอัตโนมัติ ผ่านแล้วได้ตั๋วทันที`
          : 'แนบสลิปแล้วระบบตรวจอัตโนมัติ ผ่านแล้วได้ตั๋วทันทีใน "ตั๋วของฉัน"';
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[clamp(24px,3vw,40px)] px-4 pt-[clamp(12px,2vw,32px)] pb-[clamp(32px,5vw,64px)] sm:px-6">
      <Link href="/" className="link inline-flex min-h-11 items-center gap-1.5 self-start text-sm">
        <ChevronLeftIcon size={18} />
        กลับหน้าแรก
      </Link>

      <div className="-mt-3 flex flex-wrap items-start gap-[clamp(20px,3vw,40px)]">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-[clamp(16px,2vw,24px)]">
          <Cover
            src={event.coverUrl}
            seed={event.id}
            alt={event.title}
            className="rounded-[clamp(16px,2vw,24px)]"
          />
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex gap-2">
                {event.status === "LIVE" ? <LiveBadge /> : <span className={`badge ${badge.cls}`}>{badge.label}</span>}
                {event.status === "LIVE" && hasTicket && <span className="badge badge-success">มีตั๋วแล้ว</span>}
              </span>
              <ShareButton title={event.title} />
            </div>
            <h1 className="text-[clamp(26px,1.4vw+20px,40px)] leading-[1.35] font-bold text-balance">{event.title}</h1>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] text-soft">
              <span className="flex items-center gap-2.5">
                <CalendarIcon size={18} className="text-link" />
                <span className="tabular">{formatEventDate(event.startsAt)}</span>
              </span>
              {event.replayDays > 0 && (
                <span className="flex items-center gap-2.5">
                  <ReplayIcon size={18} className="text-link" />
                  ดูย้อนหลังได้ {event.replayDays} วันหลังจบ live
                </span>
              )}
              <span className="flex items-center gap-2.5">
                <PhoneIcon size={18} className="text-link" />
                ตั๋ว 1 ใบ ดูได้ทีละ 1 เครื่อง
              </span>
            </div>
          </div>
        </div>

        <BuyPanel
          price={price}
          cta={cta}
          note={note}
          signInAction={signInWithGoogleAction}
          callbackUrl={`/events/${event.slug}`}
        />
      </div>

      <div className="flex flex-wrap items-start gap-[clamp(20px,3vw,40px)]">
        <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-2.5">
          <h2 className="text-[clamp(18px,0.6vw+16px,22px)] leading-[1.5] font-bold">รายละเอียด</h2>
          <p className="max-w-[68ch] text-[clamp(15px,0.2vw+14px,17px)] leading-[1.75] whitespace-pre-line text-soft">
            {event.description || "ยังไม่มีรายละเอียดเพิ่มเติม"}
          </p>
        </section>
        <section className="flex min-w-0 flex-[1_1_340px] flex-col gap-2.5 rounded-lg border border-border bg-white/[0.03] p-4">
          <h2 className="text-[15px] leading-6 font-semibold">ก่อนซื้อ</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-[18px] text-[13px] leading-5 text-muted">
            <li>ต้อง Login with Google ก่อนชำระเงิน</li>
            <li>ดูได้ทีละ 1 เครื่อง เปิดเครื่องใหม่ เครื่องเดิมจะหยุดเล่น</li>
            <li>ภาพมีลายน้ำ email ของคุณ เพื่อป้องกันการเผยแพร่ต่อ</li>
            <li>ต้องดูผ่านเครื่องที่รองรับระบบกันอัดหน้าจอ (Hardware DRM)</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

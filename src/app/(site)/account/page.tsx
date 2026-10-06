import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { replayExpiresAt } from "@/lib/access";
import { formatThaiPhone } from "@/lib/account";
import { loginUrl } from "@/lib/safe-redirect";
import { currentSessionToken, describeUserAgent, maskIp, sessionRef, touchSession } from "@/lib/sessions";
import AccountForm, { type AccountFormValues } from "./account-form";
import Devices, { type DeviceRow } from "./devices";
import DeleteAccount from "./delete-account";

export const metadata: Metadata = { title: "ตั้งค่าบัญชี" };

const ACCOUNT_TABS = [
  { href: "/orders", label: "ประวัติการซื้อ" },
  { href: "/account", label: "ตั้งค่าบัญชี" },
  { href: "/support", label: "แจ้งปัญหา" },
] as const;

const rtf = new Intl.RelativeTimeFormat("th-TH", { numeric: "auto" });

function lastSeenLabel(d: Date, now: Date): string {
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 5 * 60) return "ใช้งานอยู่";
  if (sec < 3600) return rtf.format(-Math.floor(sec / 60), "minute");
  if (sec < 86400) return rtf.format(-Math.floor(sec / 3600), "hour");
  return rtf.format(-Math.floor(sec / 86400), "day");
}

export default async function AccountPage() {
  const sessionUser = await currentUser();
  if (!sessionUser) redirect(loginUrl("/account"));

  await touchSession();
  const now = new Date();

  const [user, sessions, currentToken, tickets, reviewingPayments] = await Promise.all([
    db.user.findUnique({ where: { id: sessionUser.id } }),
    db.session.findMany({
      where: { userId: sessionUser.id, expires: { gt: now } },
      orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    }),
    currentSessionToken(),
    db.ticket.findMany({
      where: { userId: sessionUser.id, revoked: false },
      select: { event: { select: { status: true, endedAt: true, replayDays: true } } },
    }),
    db.payment.count({
      where: { status: { in: ["PROCESSING", "NEEDS_REVIEW"] }, order: { userId: sessionUser.id } },
    }),
  ]);
  if (!user || user.deletedAt) redirect(loginUrl("/account"));

  const activeTickets = tickets.filter(({ event: e }) => {
    if (e.status === "LIVE" || e.status === "SCHEDULED") return true;
    if (e.status === "ENDED") {
      const exp = replayExpiresAt(e.endedAt, e.replayDays);
      return !!exp && exp > now;
    }
    return false;
  }).length;

  const initial: AccountFormValues = {
    name: user.name ?? "",
    phone: formatThaiPhone(user.phone),
    billingType: user.billingType ?? "PERSON",
    billingName: user.billingName ?? "",
    billingTaxId: user.billingTaxId ?? "",
    billingBranch: user.billingBranch ?? "00000",
    billingAddress: user.billingAddress ?? "",
    refundBankCode: user.refundBankCode ?? "",
    refundAccountNo: user.refundAccountNo ?? "",
    refundAccountName: user.refundAccountName ?? "",
    notifyPayment: user.notifyPayment,
    notifyEvent: user.notifyEvent,
    notifySupport: user.notifySupport,
  };

  const devices: DeviceRow[] = sessions.map((s) => {
    const { label, kind } = describeUserAgent(s.userAgent);
    const current = s.sessionToken === currentToken;
    const seen = s.lastSeenAt ?? s.createdAt;
    const ip = maskIp(s.ipAddress);
    return {
      ref: sessionRef(s.sessionToken),
      label,
      kind,
      current,
      meta: [ip ? `IP ${ip}` : null, current ? "ใช้งานอยู่" : lastSeenLabel(seen, now)].filter(Boolean).join(" · "),
    };
  });
  // Current device first.
  devices.sort((a, b) => Number(b.current) - Number(a.current));

  const initialChar = (user.name ?? user.email).trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-[clamp(18px,2vw,24px)] px-4 pt-[clamp(20px,3vw,40px)] pb-12 sm:px-6">
      <nav aria-label="บัญชี" className="segmented self-start">
        {ACCOUNT_TABS.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.href === "/account" ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      <h1 className="text-[clamp(26px,1vw+22px,34px)] leading-[1.4] font-bold">ตั้งค่าบัญชี</h1>

      <AccountForm
        initial={initial}
        email={user.email}
        avatar={
          user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" referrerPolicy="no-referrer" className="size-16 rounded-full object-cover" />
          ) : (
            <span
              aria-hidden
              className="grid size-16 place-items-center rounded-full bg-linear-135 from-accent-hover to-[#7B5CFF] text-2xl font-bold"
            >
              {initialChar}
            </span>
          )
        }
      />

      <Devices devices={devices} />

      <DeleteAccount email={user.email} activeTickets={activeTickets} blocked={reviewingPayments > 0} />
    </div>
  );
}

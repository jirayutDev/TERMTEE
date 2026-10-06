import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { formatDayTime, orderRef } from "@/lib/format";
import { loginUrl } from "@/lib/safe-redirect";
import { getSettingsSection } from "@/lib/settings";
import {
  CATEGORY_HINT,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CUSTOMER_STATUS_LABEL,
  MAX_NEW_CASES_PER_DAY,
  STATUS_BADGE,
  caseRef,
  recentCaseCount,
} from "@/lib/support";
import NewCaseForm, { type RelatedOption } from "./new-case-form";

export const metadata: Metadata = { title: "แจ้งปัญหา" };

/** Recent-replay window for the related-event picker. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400_000);
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SupportPage({ searchParams }: PageProps<"/support">) {
  const user = await currentUser();
  if (!user) redirect(loginUrl("/support"));
  const sp = await searchParams;

  const [cases, orders, events, shop, todayCount] = await Promise.all([
    db.supportCase.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, number: true, subject: true, status: true, category: true, updatedAt: true },
    }),
    db.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, eventId: true, event: { select: { title: true } } },
    }),
    db.event.findMany({
      where: {
        OR: [
          { status: { in: ["LIVE", "SCHEDULED"] } },
          { status: "ENDED", endedAt: { gt: daysAgo(14) } },
        ],
      },
      orderBy: { startsAt: "desc" },
      take: 20,
      select: { id: true, title: true, status: true },
    }),
    getSettingsSection("shop"),
    recentCaseCount(user.id),
  ]);

  const orderEventIds = new Set(orders.map((o) => o.eventId));
  const related: RelatedOption[] = [
    ...orders.map((o) => ({ value: `order:${o.id}`, label: `${orderRef(o.id)} · ${o.event.title}`, group: "order" as const })),
    ...events
      .filter((e) => !orderEventIds.has(e.id))
      .map((e) => ({ value: `event:${e.id}`, label: `${e.title}${e.status === "LIVE" ? " (LIVE)" : ""}`, group: "event" as const })),
  ];
  const wantOrder = one(sp.order);
  const wantEvent = one(sp.event);
  const defaultRelated = related.find((r) => r.value === `order:${wantOrder}` || r.value === `event:${wantEvent}`)?.value;
  const wantCategory = one(sp.category)?.toUpperCase();
  const defaultCategory = CATEGORY_ORDER.find((c) => c === wantCategory);

  const categories = CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABEL[c], ...CATEGORY_HINT[c] }));
  const limitReached = todayCount >= MAX_NEW_CASES_PER_DAY;
  const contacts = [
    shop.supportEmail && { label: "Email", value: shop.supportEmail, href: `mailto:${shop.supportEmail}` },
    shop.supportLine && {
      label: "LINE",
      value: shop.supportLine,
      href: /^https?:\/\//.test(shop.supportLine) ? shop.supportLine : undefined,
    },
    shop.supportPhone && { label: "โทร", value: shop.supportPhone, href: `tel:${shop.supportPhone.replace(/[^\d+]/g, "")}` },
  ].filter(Boolean) as { label: string; value: string; href?: string }[];

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[clamp(18px,2vw,24px)] px-4 pt-[clamp(20px,3vw,40px)] pb-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[clamp(26px,1vw+22px,34px)] leading-[1.4] font-bold">แจ้งปัญหา</h1>
          <span className="text-sm text-muted">
            {shop.supportHours ? `ทีมงานตอบ ${shop.supportHours}` : "ทีมงานจะตอบกลับทาง email"} · ระหว่าง live ตอบเร็วกว่าปกติ
          </span>
        </div>
        {cases.length > 0 && !limitReached && (
          <a href="#new" className="btn btn-primary shadow-none">
            แจ้งเคสใหม่
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
          <section aria-labelledby="my-cases" className="flex flex-col gap-2.5">
            <h2 id="my-cases" className="text-[17px] font-bold">
              เคสของฉัน
            </h2>
            {cases.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-muted">
                ยังไม่มีเคส · เจอปัญหาอะไร แจ้งทีมงานได้เลย
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {cases.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/support/${c.id}`}
                      className="glass flex flex-col gap-1 rounded-[14px] px-3.5 py-3 hover:border-white/16"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-muted">{caseRef(c.number)}</span>
                        <span className={`badge badge-sm ${STATUS_BADGE[c.status]}`}>{CUSTOMER_STATUS_LABEL[c.status]}</span>
                      </span>
                      <span className="text-[15px] leading-[22px] font-semibold">{c.subject}</span>
                      <span className="text-xs text-muted">
                        {CATEGORY_LABEL[c.category]} · <span className="tabular">{formatDayTime(c.updatedAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(contacts.length > 0 || shop.supportHours) && (
            <section aria-labelledby="contacts" className="glass flex flex-col gap-2 rounded-[14px] p-4">
              <h2 id="contacts" className="text-sm font-bold">
                ติดต่อทีมงานโดยตรง
              </h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                {contacts.map((c) => (
                  <div key={c.label} className="contents">
                    <dt className="text-muted">{c.label}</dt>
                    <dd className="min-w-0 break-all">
                      {c.href ? (
                        <a href={c.href} className="text-link underline hover:text-link-hover">
                          {c.value}
                        </a>
                      ) : (
                        c.value
                      )}
                    </dd>
                  </div>
                ))}
                {shop.supportHours && (
                  <>
                    <dt className="text-muted">เวลาทำการ</dt>
                    <dd>{shop.supportHours}</dd>
                  </>
                )}
              </dl>
            </section>
          )}
        </div>

        <section
          id="new"
          aria-labelledby="new-title"
          className="glass-strong flex min-w-0 flex-[999_1_520px] scroll-mt-24 flex-col gap-4 rounded-xl p-[clamp(16px,2vw,24px)]"
        >
          <h2 id="new-title" className="text-xl font-bold">
            แจ้งเคสใหม่
          </h2>
          {limitReached ? (
            <p className="rounded-md border border-warning/45 bg-warning/10 px-3.5 py-3 text-sm text-[#F7D9A0]">
              วันนี้แจ้งเคสใหม่ครบ {MAX_NEW_CASES_PER_DAY} เคสแล้ว · ตอบกลับในเคสเดิมได้เลย ทีมงานจะเห็นทันที
            </p>
          ) : (
            <NewCaseForm
              categories={categories}
              related={related}
              defaultRelated={defaultRelated}
              defaultCategory={defaultCategory}
            />
          )}
        </section>
      </div>
    </div>
  );
}

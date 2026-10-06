import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { orderRef } from "@/lib/format";
import { loginUrl } from "@/lib/safe-redirect";
import { CATEGORY_LABEL, CUSTOMER_STATUS_LABEL, STATUS_BADGE, caseRef } from "@/lib/support";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { Notice } from "@/components/ui/primitives";
import { closeCaseAction } from "../actions";
import CaseThread from "../case-thread";
import ReplyForm from "../reply-form";

export const metadata: Metadata = { title: "เคสของฉัน" };

export default async function SupportCasePage({ params, searchParams }: PageProps<"/support/[id]">) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(loginUrl(`/support/${id}`));
  const sp = await searchParams;

  const c = await db.supportCase.findUnique({
    where: { id },
    include: {
      messages: {
        where: { internal: false },
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
  if (!c || c.userId !== user.id) notFound();

  const event = c.eventId ? await db.event.findUnique({ where: { id: c.eventId }, select: { title: true } }) : null;
  const closed = c.status === "CLOSED" || c.status === "RESOLVED";
  const ref = caseRef(c.number);

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5 px-4 pt-[clamp(20px,3vw,40px)] pb-12 sm:px-6">
      <Link href="/support" className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeftIcon size={18} /> เคสของฉัน
      </Link>

      {sp.created && <Notice tone="ok" role="status">ส่งเคส {ref} แล้ว · ทีมงานจะตอบกลับทาง email</Notice>}

      <section aria-labelledby="case-title" className="glass-strong flex flex-col gap-5 rounded-xl p-[clamp(16px,2vw,24px)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 pb-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] text-muted">
              <span className="font-mono">{ref}</span> · {CATEGORY_LABEL[c.category]}
              {c.orderId && <> · <span className="font-mono">{orderRef(c.orderId)}</span></>}
              {!c.orderId && event && <> · {event.title}</>}
            </span>
            <h1 id="case-title" className="text-xl leading-[1.4] font-bold break-words">
              {c.subject}
            </h1>
          </div>
          <span className={`badge ${STATUS_BADGE[c.status]}`}>{CUSTOMER_STATUS_LABEL[c.status]}</span>
        </div>

        <CaseThread messages={c.messages} viewer="customer" />

        {closed && (
          <Notice tone="info">เคสนี้ปิดแล้ว · ยังมีปัญหาอยู่? ตอบกลับด้านล่างเพื่อเปิดเคสอีกครั้ง</Notice>
        )}

        <ReplyForm caseId={c.id} mode="customer" placeholder={closed ? "พิมพ์เพื่อเปิดเคสอีกครั้ง" : "พิมพ์ข้อความ"} />

        {!closed && (
          <form action={closeCaseAction.bind(null, c.id)} className="flex justify-end">
            <button className="btn btn-sm btn-outline min-h-11">ปัญหาแก้แล้ว ปิดเคส</button>
          </form>
        )}
      </section>
    </div>
  );
}

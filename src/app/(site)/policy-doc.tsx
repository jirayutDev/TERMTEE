import Link from "next/link";
import { formatShortDate } from "@/lib/format";

/** Plain-text policy from /admin/settings: blank line = new paragraph, single newline kept. */
export default function PolicyDoc({
  title,
  text,
  updatedAt,
  shopName,
}: {
  title: string;
  text: string;
  updatedAt: Date | null;
  shopName: string;
}) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <article className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-4 pt-[clamp(28px,4vw,56px)] pb-12 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[clamp(26px,1.2vw+21px,36px)] leading-[1.35] font-bold">{title}</h1>
        {paragraphs.length > 0 && updatedAt && (
          <span className="text-[13px] text-muted">
            {shopName} · แก้ไขล่าสุด {formatShortDate(updatedAt)}
          </span>
        )}
      </header>
      {paragraphs.length > 0 ? (
        <div className="glass flex flex-col gap-4 rounded-xl p-[clamp(16px,2.4vw,32px)] text-[15px] leading-[1.8] text-soft">
          {paragraphs.map((para, i) => (
            <p key={i} className="whitespace-pre-line break-words">
              {para}
            </p>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong px-6 py-16 text-center">
          <h2 className="text-lg font-bold">ยังไม่ได้เผยแพร่</h2>
          <p className="max-w-[40ch] text-sm leading-[22px] text-muted">
            {shopName} กำลังจัดทำเนื้อหาส่วนนี้ หากมีคำถามติดต่อทีมงานได้เลย
          </p>
          <Link href="/" className="btn btn-outline btn-sm mt-1.5">
            กลับหน้าแรก
          </Link>
        </div>
      )}
    </article>
  );
}

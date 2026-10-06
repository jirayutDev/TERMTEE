import Link from "next/link";
import { db } from "@/lib/db";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { createCannedReplyAction, deleteCannedReplyAction, updateCannedReplyAction } from "../actions";
import { requireCasesStaff } from "../guard";
import CannedForm from "./canned-form";

export const metadata = { title: "คำตอบสำเร็จรูป" };

export default async function CannedRepliesPage() {
  await requireCasesStaff("/admin/cases/replies");
  const replies = await db.cannedReply.findMany({ orderBy: { title: "asc" } });

  return (
    <>
      <Link href="/admin/cases" className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeftIcon size={18} /> คิวเคส
      </Link>
      <div className="flex flex-col">
        <h1 className="text-[28px] leading-[38px] font-bold">คำตอบสำเร็จรูป</h1>
        <span className="text-sm text-muted">กดปุ่มในหน้าเคสเพื่อแทรกข้อความลงในช่องตอบกลับ แก้ไขก่อนส่งได้</span>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <ul className="flex min-w-0 flex-[999_1_520px] flex-col gap-3">
          {replies.length === 0 && (
            <li className="rounded-lg border border-dashed border-border-strong p-8 text-center text-sm text-muted">
              ยังไม่มีคำตอบสำเร็จรูป
            </li>
          )}
          {replies.map((r) => (
            <li key={r.id} className="glass-admin flex flex-col gap-2 rounded-lg p-4">
              <details>
                <summary className="flex min-h-11 cursor-pointer flex-col justify-center">
                  <span className="font-semibold">{r.title}</span>
                  <span className="line-clamp-2 text-sm text-muted">{r.body}</span>
                </summary>
                <div className="mt-3 flex flex-col gap-3 border-t border-white/8 pt-3">
                  <CannedForm action={updateCannedReplyAction.bind(null, r.id)} initial={r} submitLabel="บันทึก" />
                  <ConfirmDialog
                    action={deleteCannedReplyAction.bind(null, r.id)}
                    trigger="ลบ"
                    triggerClassName="btn btn-sm btn-danger-outline min-h-11 self-start"
                    title={`ลบ “${r.title}”?`}
                    confirmLabel="ลบ"
                  />
                </div>
              </details>
            </li>
          ))}
        </ul>

        <section aria-labelledby="new-reply" className="glass-strong flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-lg p-5">
          <h2 id="new-reply" className="text-[17px] font-bold">
            เพิ่มคำตอบ
          </h2>
          <CannedForm action={createCannedReplyAction} submitLabel="เพิ่ม" />
        </section>
      </div>
    </>
  );
}

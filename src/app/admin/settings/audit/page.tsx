import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { formatThaiDateTime } from "@/lib/format";
import { loginUrl } from "@/lib/safe-redirect";
import { EmptyState } from "@/components/ui/primitives";

export const metadata = { title: "บันทึกการแก้ไข" };

const PAGE_SIZE = 100;

const ACTION_LABEL: Record<string, string> = {
  "settings.update": "แก้ไขการตั้งค่า",
  "team.invite": "เชิญทีมงาน",
  "team.invite_revoked": "ยกเลิกคำเชิญ",
  "team.invite_accepted": "ตอบรับคำเชิญ",
  "team.role": "เปลี่ยนบทบาท",
};

const SECTION_LABEL: Record<string, string> = {
  shop: "ข้อมูลร้าน",
  payment: "รับเงินและตรวจสลิป",
  protection: "การดูและการป้องกัน",
  receipt: "ใบเสร็จและภาษี",
  policies: "นโยบาย",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function summary(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.changed)) return d.changed.length ? `ฟิลด์: ${d.changed.join(", ")}` : "ไม่มีค่าที่เปลี่ยน";
  return JSON.stringify(d);
}

/** Who did what in admin. ADMIN only. Newest first, cursor-paged by ?before=<id>. */
export default async function AuditPage({ searchParams }: PageProps<"/admin/settings/audit">) {
  const me = await currentUser();
  if (!me) redirect(loginUrl("/admin/settings/audit"));
  if (me.role !== "ADMIN") notFound();

  const sp = await searchParams;
  const before = one(sp.before);
  const rows = await db.auditLog.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);

  const actorIds = [...new Set(page.map((r) => r.actorId).filter((x): x is string => !!x))];
  const actors = new Map(
    (await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, name: true } })).map((u) => [
      u.id,
      u.name ?? u.email,
    ]),
  );

  if (page.length === 0) {
    return <EmptyState title="ยังไม่มีบันทึก" body="การแก้ไขการตั้งค่า บทบาท และคำเชิญทีมงานจะแสดงที่นี่" />;
  }

  return (
    <section aria-label="บันทึกการแก้ไข" className="glass-admin flex flex-col gap-3 rounded-lg p-[clamp(12px,1.6vw,20px)]">
      <div className="overflow-x-auto">
        <table className="data-table min-w-[720px]">
          <thead>
            <tr>
              <th scope="col">เวลา</th>
              <th scope="col">ผู้ทำ</th>
              <th scope="col">การกระทำ</th>
              <th scope="col">เป้าหมาย</th>
              <th scope="col">รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {page.map((r) => (
              <tr key={r.id}>
                <td className="tabular text-[13px] whitespace-nowrap text-muted">{formatThaiDateTime(r.createdAt)}</td>
                <td className="text-[13px]">{r.actorId ? (actors.get(r.actorId) ?? r.actorId) : "ระบบ"}</td>
                <td className="text-[13px] font-semibold">{ACTION_LABEL[r.action] ?? r.action}</td>
                <td className="text-[13px] break-all">
                  {r.action === "settings.update" && r.target ? (SECTION_LABEL[r.target] ?? r.target) : (r.target ?? "—")}
                </td>
                <td className="max-w-[360px] text-xs break-words text-muted">{summary(r.data)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <Link href={`/admin/settings/audit?before=${encodeURIComponent(page[page.length - 1].id)}`} className="link self-end text-sm">
          ก่อนหน้านี้ →
        </Link>
      )}
    </section>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import type { CaseCategory, CasePriority, CaseStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { formatDayTime } from "@/lib/format";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  PRIORITY_BADGE,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  PRIORITY_RANK,
  STAFF_STATUS_LABEL,
  STATUS_BADGE,
  STATUS_ORDER,
  caseRef,
} from "@/lib/support";
import { requireCasesStaff } from "./guard";

export const metadata = { title: "เคสลูกค้า" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type StatusTab = CaseStatus | "ALL";
type Assignee = "all" | "me" | "unassigned";

function waited(d: Date) {
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} ชม. ${m % 60} นาที` : `${Math.floor(h / 24)} วัน`;
}

export default async function AdminCasesPage({ searchParams }: PageProps<"/admin/cases">) {
  const me = await requireCasesStaff("/admin/cases");
  const sp = await searchParams;

  const rawStatus = one(sp.status);
  const status: StatusTab = rawStatus === "ALL" || STATUS_ORDER.includes(rawStatus as CaseStatus) ? (rawStatus as StatusTab) : "OPEN";
  const category = CATEGORY_ORDER.find((c) => c === one(sp.category)) ?? null;
  const priority = PRIORITY_ORDER.find((p) => p === one(sp.priority)) ?? null;
  const rawAssignee = one(sp.assignee);
  const assignee: Assignee = rawAssignee === "me" || rawAssignee === "unassigned" ? rawAssignee : "all";

  const filters: Prisma.SupportCaseWhereInput = {
    ...(category ? { category } : {}),
    ...(priority ? { priority } : {}),
    ...(assignee === "me" ? { assigneeId: me.id } : assignee === "unassigned" ? { assigneeId: null } : {}),
  };

  const [counts, rows] = await Promise.all([
    db.supportCase.groupBy({ by: ["status"], where: filters, _count: { _all: true } }),
    db.supportCase.findMany({
      where: { ...filters, ...(status === "ALL" ? {} : { status }) },
      // Pre-sort in SQL so the 300 cap keeps the most relevant rows; final order below.
      orderBy: [{ duringLive: "desc" }, { priority: "desc" }, { updatedAt: "asc" }],
      take: 300,
      select: {
        id: true,
        number: true,
        subject: true,
        category: true,
        status: true,
        priority: true,
        duringLive: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { email: true } },
        assignee: { select: { id: true, name: true, email: true } },
        messages: {
          where: { isStaff: false },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
  ]);
  const count = new Map(counts.map((c) => [c.status, c._count._all]));
  const total = counts.reduce((s, c) => s + c._count._all, 0);

  const cases = rows
    .map((c) => ({ ...c, waitingSince: c.messages[0]?.createdAt ?? c.createdAt }))
    .sort(
      (a, b) =>
        Number(b.duringLive) - Number(a.duringLive) ||
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        a.waitingSince.getTime() - b.waitingSince.getTime(),
    );

  const href = (patch: Partial<{ status: StatusTab; category: CaseCategory | null; priority: CasePriority | null; assignee: Assignee }>) => {
    const v = { status, category, priority, assignee, ...patch };
    const p = new URLSearchParams();
    if (v.status !== "OPEN") p.set("status", v.status);
    if (v.category) p.set("category", v.category);
    if (v.priority) p.set("priority", v.priority);
    if (v.assignee !== "all") p.set("assignee", v.assignee);
    const s = p.toString();
    return s ? `/admin/cases?${s}` : "/admin/cases";
  };

  const tabs: { id: StatusTab; label: string; n: number }[] = [
    ...STATUS_ORDER.map((s) => ({ id: s as StatusTab, label: STAFF_STATUS_LABEL[s], n: count.get(s) ?? 0 })),
    { id: "ALL", label: "ทั้งหมด", n: total },
  ];
  const liveOpen = cases.filter((c) => c.duringLive && c.status === "OPEN").length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col">
          <h1 className="text-[28px] leading-[38px] font-bold">เคสจากลูกค้า</h1>
          <span className="text-sm text-muted">
            รอตอบ {(count.get("OPEN") ?? 0).toLocaleString("th-TH")}
            {liveOpen > 0 && ` · ระหว่าง live ${liveOpen.toLocaleString("th-TH")}`} · เคสระหว่าง live ขึ้นก่อนเสมอ
          </span>
        </div>
        <Link href="/admin/cases/replies" className="btn btn-sm btn-secondary min-h-11">
          คำตอบสำเร็จรูป
        </Link>
      </div>

      <nav aria-label="สถานะ" className="segmented w-fit max-w-full">
        {tabs.map((t) => (
          <Link key={t.id} href={href({ status: t.id })} aria-current={t.id === status ? "page" : undefined}>
            {t.label} ({t.n.toLocaleString("th-TH")})
          </Link>
        ))}
      </nav>

      <form action="/admin/cases" className="flex flex-wrap items-end gap-2.5">
        {status !== "OPEN" && <input type="hidden" name="status" value={status} />}
        <FilterSelect name="category" label="หมวด" value={category ?? ""}>
          <option value="">ทุกหมวด</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect name="priority" label="ความสำคัญ" value={priority ?? ""}>
          <option value="">ทุกระดับ</option>
          {PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect name="assignee" label="ผู้รับผิดชอบ" value={assignee}>
          <option value="all">ทุกคน</option>
          <option value="me">ของฉัน</option>
          <option value="unassigned">ยังไม่มอบหมาย</option>
        </FilterSelect>
        <button className="btn btn-sm btn-secondary min-h-11">กรอง</button>
        {(category || priority || assignee !== "all") && (
          <Link href={href({ category: null, priority: null, assignee: "all" })} className="btn btn-sm btn-ghost min-h-11">
            ล้างตัวกรอง
          </Link>
        )}
      </form>

      {cases.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong p-10 text-center text-muted">ไม่มีเคสในมุมมองนี้</p>
      ) : (
        <div className="glass-admin overflow-x-auto rounded-lg">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th scope="col">เคส</th>
                <th scope="col">เรื่อง · ลูกค้า</th>
                <th scope="col">ความสำคัญ</th>
                <th scope="col">สถานะ</th>
                <th scope="col">ผู้รับผิดชอบ</th>
                <th scope="col">ลูกค้าเขียนล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">
                    <Link
                      href={`/admin/cases/${c.id}`}
                      className="inline-flex min-h-8 items-center font-mono text-[13px] text-link underline hover:text-link-hover"
                    >
                      {caseRef(c.number)}
                    </Link>
                    {c.duringLive && <span className="badge badge-sm badge-live ml-2">ระหว่าง LIVE</span>}
                  </td>
                  <td>
                    <div className="flex min-w-0 flex-col">
                      <Link href={`/admin/cases/${c.id}`} className="font-semibold hover:underline">
                        {c.subject}
                      </Link>
                      <span className="text-xs break-all text-subtle">
                        {c.user.email} · {CATEGORY_LABEL[c.category]}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge badge-sm ${PRIORITY_BADGE[c.priority]}`}>{PRIORITY_LABEL[c.priority]}</span>
                  </td>
                  <td>
                    <span className={`badge badge-sm ${STATUS_BADGE[c.status]}`}>{STAFF_STATUS_LABEL[c.status]}</span>
                  </td>
                  <td className="text-[13px] text-soft">
                    {c.assignee ? (c.assignee.id === me.id ? "ฉัน" : (c.assignee.name ?? c.assignee.email)) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <td className="tabular whitespace-nowrap text-soft">
                    {formatDayTime(c.waitingSince)}
                    {c.status === "OPEN" && <span className="block text-xs text-subtle">รอ {waited(c.waitingSince)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FilterSelect({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <select name={name} defaultValue={value} className="field min-w-[150px] text-sm">
        {children}
      </select>
    </label>
  );
}

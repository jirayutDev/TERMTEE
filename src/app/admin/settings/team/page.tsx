import { db } from "@/lib/db";
import { formatDayTime } from "@/lib/format";
import { ROLE_LABEL, STAFF_ROLES, can, type Permission } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";
import { CopyButton } from "@/components/ui/copy-button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { pageUser } from "../../guard";
import { changeRoleAction, inviteAction, revokeInviteAction } from "./actions";
import { InviteForm, RoleForm } from "./team-forms";

export const metadata = { title: "ทีมงาน" };

const ROLE_BADGE: Record<Role, string> = {
  ADMIN: "bg-accent/20 text-accent-fg",
  MANAGER: "bg-glow/20 text-replay",
  FINANCE: "bg-success/15 text-success-fg",
  SUPPORT: "bg-warning/15 text-warning-fg",
  VIEWER: "bg-white/8 text-muted",
};

const PERMISSION_ROWS: { permission: Permission; label: string }[] = [
  { permission: "events", label: "Events · สร้าง/แก้ไข · ควบคุม live" },
  { permission: "payments", label: "ตรวจสลิป · อนุมัติ/ปฏิเสธ" },
  { permission: "viewers", label: "คนดูขณะนี้ · เตะออก" },
  { permission: "cases", label: "เคสลูกค้า" },
  { permission: "settings", label: "ตั้งค่าร้าน" },
  { permission: "team", label: "ทีมงาน · เชิญ/เปลี่ยนบทบาท" },
];

const MATRIX_ROLES: Role[] = ["ADMIN", "MANAGER", "FINANCE", "SUPPORT"];

function RoleBadge({ role }: { role: Role }) {
  return <span className={`badge badge-sm ${ROLE_BADGE[role]}`}>{ROLE_LABEL[role]}</span>;
}

export default async function TeamSettingsPage() {
  const me = await pageUser("team", "/admin/settings/team");
  const isAdmin = me.role === "ADMIN";

  const [staff, invites] = await Promise.all([
    db.user.findMany({
      where: { role: { not: "VIEWER" }, deletedAt: null },
      orderBy: [{ role: "desc" }, { createdAt: "asc" }],
      select: { id: true, name: true, email: true, role: true, image: true },
    }),
    db.teamInvite.findMany({
      where: { acceptedAt: null },
      orderBy: { createdAt: "desc" },
      include: { invitedBy: { select: { name: true, email: true } } },
    }),
  ]);

  const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
  const now = new Date();
  const inviteRoles = STAFF_ROLES.filter((r) => isAdmin || r !== "ADMIN").map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  const roleOptions = [
    ...[...STAFF_ROLES].reverse().map((r) => ({ value: r, label: ROLE_LABEL[r] })),
    { value: "VIEWER", label: "นำออกจากทีม (ผู้ชม)" },
  ];

  return (
    <>
      <section aria-labelledby="team-h" className="glass-admin flex flex-col gap-5 rounded-lg p-[clamp(16px,2vw,24px)]">
        <div className="flex flex-col gap-0.5">
          <h2 id="team-h" className="text-[15px] font-semibold">
            ทีมงาน
          </h2>
          <span className="text-xs text-muted">เข้าสู่ระบบด้วย Google · สิทธิ์ตามบทบาท · ลิงก์คำเชิญใช้ได้ 7 วัน</span>
        </div>

        <InviteForm action={inviteAction} roles={inviteRoles} />

        <ul className="m-0 flex list-none flex-col p-0">
          {staff.map((u) => {
            const name = u.name ?? u.email;
            const self = u.id === me.id;
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-3 border-t border-border-soft py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-linear-135 from-accent-hover to-glow text-sm font-bold">
                  {name.charAt(0).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-[1_1_200px] flex-col">
                  <span className="truncate text-sm font-semibold">
                    {name}
                    {self && <span className="ml-1.5 text-xs font-normal text-muted">(คุณ)</span>}
                  </span>
                  <span className="truncate text-xs text-muted">{u.email}</span>
                </span>
                {isAdmin && !self ? (
                  <RoleForm
                    action={changeRoleAction.bind(null, u.id)}
                    current={u.role}
                    roles={roleOptions}
                    label={`บทบาทของ ${u.email}`}
                  />
                ) : (
                  <RoleBadge role={u.role} />
                )}
              </li>
            );
          })}
          {invites.map((inv) => {
            const expired = inv.expiresAt <= now;
            const link = `${appUrl}/invite/${encodeURIComponent(inv.token)}`;
            return (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 border-t border-border-soft py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#2A3163] text-sm font-bold text-muted">—</span>
                <span className="flex min-w-0 flex-[1_1_200px] flex-col">
                  <span className="truncate text-sm font-semibold">{inv.email}</span>
                  <span className="text-xs text-muted">
                    {ROLE_LABEL[inv.role]} · เชิญโดย {inv.invitedBy.name ?? inv.invitedBy.email} ·{" "}
                    {expired ? "หมดอายุแล้ว" : `หมดอายุ ${formatDayTime(inv.expiresAt)}`}
                  </span>
                </span>
                <span className={`badge badge-sm ${expired ? "badge-danger" : "badge-neutral"}`}>
                  {expired ? "หมดอายุ" : "รอตอบรับ"}
                </span>
                {!expired && appUrl && <CopyButton value={link} label="คัดลอกลิงก์คำเชิญ" className="btn btn-sm btn-ghost min-h-10" />}
                <ConfirmDialog
                  action={revokeInviteAction.bind(null, inv.id)}
                  trigger={expired ? "ลบ" : "ยกเลิกคำเชิญ"}
                  triggerClassName="btn btn-sm btn-danger-outline min-h-10"
                  title={`ยกเลิกคำเชิญ ${inv.email}?`}
                  body="ลิงก์ในคำเชิญจะใช้ไม่ได้อีก เชิญใหม่ได้ภายหลัง"
                  confirmLabel="ยกเลิกคำเชิญ"
                />
              </li>
            );
          })}
        </ul>
        {!isAdmin && <p className="text-xs text-muted">เฉพาะผู้ดูแลระบบเปลี่ยนบทบาทหรือนำทีมงานออกได้</p>}
      </section>

      <section aria-labelledby="perm-h" className="glass-admin flex flex-col gap-3 rounded-lg p-[clamp(16px,2vw,24px)]">
        <h2 id="perm-h" className="text-[15px] font-semibold">
          สิทธิ์ตามบทบาท
        </h2>
        <div className="overflow-x-auto">
          <table className="data-table min-w-[560px]">
            <thead>
              <tr>
                <th scope="col">เมนู</th>
                {MATRIX_ROLES.map((r) => (
                  <th key={r} scope="col" className="text-center!">
                    {ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_ROWS.map((row) => (
                <tr key={row.permission}>
                  <th scope="row" className="text-left text-sm font-normal text-soft">
                    {row.label}
                  </th>
                  {MATRIX_ROLES.map((r) =>
                    can(r, row.permission) ? (
                      <td key={r} className="text-center font-bold text-success-fg">
                        ✓<span className="sr-only">มีสิทธิ์</span>
                      </td>
                    ) : (
                      <td key={r} className="text-center text-subtle">
                        —<span className="sr-only">ไม่มีสิทธิ์</span>
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

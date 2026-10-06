import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { openCaseCount } from "@/lib/support";
import { loginUrl } from "@/lib/safe-redirect";
import { ROLE_LABEL, can, isStaffRole, permissionsOf } from "@/lib/roles";
import { LogoMark } from "@/components/ui/icons";
import { signOutAction } from "../auth-actions";
import AdminNav from "./admin-nav";

export const metadata = { title: "Admin" };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await currentUser();
  if (!user) redirect(loginUrl("/admin"));
  // Any staff role gets in; each page checks its own permission (see ./guard.ts).
  if (!isStaffRole(user.role)) notFound();
  const [pendingSlips, openCases] = await Promise.all([
    can(user.role, "payments") ? db.payment.count({ where: { status: "NEEDS_REVIEW" } }) : 0,
    can(user.role, "cases") ? openCaseCount() : 0,
  ]);
  const name = user.name ?? user.email;

  return (
    <div
      className="flex min-h-dvh flex-1 flex-wrap bg-bg"
      style={{ backgroundImage: "radial-gradient(900px 600px at 0% 0%, rgba(43,92,255,0.18), transparent 60%)" }}
    >
      <aside className="flex max-w-full flex-[1_1_240px] flex-col gap-6 border-r border-border-soft bg-bg-elevated/70 px-4 py-6 min-[800px]:max-w-[280px]">
        <Link href="/admin" className="flex items-center gap-2 px-2">
          <LogoMark size={26} hole="var(--bg-elevated)" />
          <span className="font-brand text-base font-bold tracking-[0.08em]">TERMTEE</span>
          <span className="ml-1 rounded-[6px] bg-accent/20 px-2 py-0.5 text-[11px] font-semibold text-accent-fg">Admin</span>
        </Link>
        <AdminNav pendingSlips={pendingSlips} openCases={openCases} permissions={[...permissionsOf(user.role)]} />
        <div className="mt-auto flex flex-col gap-1 border-t border-border-soft pt-4">
          <Link href="/" className="flex h-11 items-center rounded-[10px] px-3 text-[13px] text-muted hover:bg-white/6 hover:text-fg">
            ไปหน้าเว็บคนดู ↗
          </Link>
          <div className="flex items-center gap-2.5 px-3 py-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-linear-135 from-accent-hover to-glow text-[13px] font-bold">
              {name.charAt(0).toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-semibold">{name}</span>
              <span className="text-[11px] text-subtle">{ROLE_LABEL[user.role]}</span>
              <form action={signOutAction}>
                <button className="-my-2.5 min-h-11 text-xs text-link hover:text-link-hover">ออกจากระบบ</button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-6 px-[clamp(16px,3vw,40px)] pt-[clamp(20px,3vw,32px)] pb-12">
        {children}
      </main>
    </div>
  );
}

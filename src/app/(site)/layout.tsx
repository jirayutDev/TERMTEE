import Link from "next/link";
import { currentUser } from "@/auth";
import { isStaffRole } from "@/lib/roles";
import { touchSession } from "@/lib/sessions";
import { HomeLogo } from "@/components/ui/primitives";
import { AccountMenu, NavLinks, SignInButton } from "@/components/site-header-client";
import { signInWithGoogleAction, signOutAction } from "../auth-actions";

export default async function SiteLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  // Keeps the device list in /account fresh (throttled to one write per 5 min).
  if (user) await touchSession();
  const year = new Date().getFullYear() + 543;

  return (
    <div className="bg-ambient flex min-h-dvh flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-border-soft bg-bg/72 backdrop-blur-lg">
        <div className="mx-auto flex min-h-[60px] max-w-[1200px] flex-wrap items-center justify-between gap-x-3 gap-y-1 pr-1.5 pl-4 sm:px-6">
          <HomeLogo />
          <nav aria-label="เมนูหลัก" className="flex items-center gap-0.5">
            <NavLinks />
            {user ? (
              <AccountMenu
                name={user.name ?? null}
                email={user.email}
                image={user.image ?? null}
                isAdmin={isStaffRole(user.role)}
                signOutAction={signOutAction}
              />
            ) : (
              <span className="ml-1.5">
                <SignInButton action={signInWithGoogleAction} />
              </span>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-auto border-t border-border-soft">
        <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-x-5 gap-y-2.5 px-4 pt-6 pb-8 text-xs leading-[18px] text-subtle sm:px-6">
          <span>เนื้อหาถูกลิขสิทธิ์ · ป้องกันการอัดหน้าจอด้วย DRM ระดับฮาร์ดแวร์</span>
          <nav aria-label="ลิงก์ท้ายเว็บ" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/unsupported" className="inline-flex min-h-11 items-center text-muted underline-offset-2 hover:text-fg hover:underline">
              เครื่องที่รองรับ
            </Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center text-muted underline-offset-2 hover:text-fg hover:underline">
              เงื่อนไขการใช้งาน
            </Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center text-muted underline-offset-2 hover:text-fg hover:underline">
              นโยบายความเป็นส่วนตัว
            </Link>
            <span>© {year} TERMTEE</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}

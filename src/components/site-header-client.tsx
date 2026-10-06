"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { GoogleIcon } from "@/components/ui/icons";

const NAV = [
  { href: "/", label: "หน้าแรก" },
  { href: "/library", label: "ตั๋วของฉัน" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {NAV.map((n) => {
        const current = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={current ? "page" : undefined}
            className={`flex h-11 items-center rounded-md px-2.5 text-sm whitespace-nowrap ${
              current ? "bg-white/6 font-semibold text-fg" : "text-muted hover:text-fg"
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </>
  );
}

/** "Login with Google" that returns to the current page. */
export function SignInButton({ action }: { action: (formData: FormData) => Promise<void> }) {
  const pathname = usePathname();
  return (
    <form action={action}>
      <input type="hidden" name="callbackUrl" value={pathname} />
      <button className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-white px-3.5 text-sm font-semibold whitespace-nowrap text-[#1F1F1F] hover:bg-[#EEF1FB]">
        <GoogleIcon size={16} />
        <span className="hidden sm:inline">Login with Google</span>
        <span className="sm:hidden">Login</span>
      </button>
    </form>
  );
}

export function AccountMenu({
  name,
  email,
  image,
  isAdmin,
  signOutAction,
}: {
  name: string | null;
  email: string;
  image: string | null;
  /** Any staff role (not only ADMIN): shows the link to /admin. */
  isAdmin: boolean;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (name ?? email).trim().charAt(0).toUpperCase() || "?";
  const item = "flex h-11 items-center rounded-[10px] px-3 text-sm text-fg hover:bg-white/6";

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label="บัญชีของฉัน"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="grid size-11 place-items-center rounded-full"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" referrerPolicy="no-referrer" className="size-[34px] rounded-full object-cover" />
        ) : (
          <span className="grid size-[34px] place-items-center rounded-full bg-linear-135 from-accent-hover to-glow text-sm font-bold text-white">
            {initial}
          </span>
        )}
      </button>
      {open && (
        <div
          id={menuId}
          className="absolute top-full right-0 z-40 mt-1.5 flex w-[260px] flex-col rounded-lg bg-panel p-2 shadow-dialog"
        >
          <div className="flex flex-col border-b border-border px-3 pt-2.5 pb-3">
            {name && <span className="truncate text-[15px] font-semibold">{name}</span>}
            <span className="truncate text-xs text-muted">{email}</span>
          </div>
          <nav aria-label="เมนูบัญชี" className="flex flex-col pt-1">
            <Link href="/" className={item}>
              หน้าแรก
            </Link>
            <Link href="/library" className={item}>
              ตั๋วของฉัน
            </Link>
            <Link href="/orders" className={item}>
              ประวัติการซื้อ
            </Link>
            <Link href="/account" className={item}>
              ตั้งค่าบัญชี
            </Link>
            <Link href="/support" className={item}>
              แจ้งปัญหา
            </Link>
            <Link href="/unsupported" className={item}>
              เครื่องที่รองรับ
            </Link>
            {isAdmin && (
              <Link href="/admin" className={item}>
                แผงผู้ดูแล
              </Link>
            )}
          </nav>
          <form action={signOutAction}>
            <button className={`${item} w-full text-danger-fg`}>ออกจากระบบ</button>
          </form>
        </div>
      )}
    </div>
  );
}

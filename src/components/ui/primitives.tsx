import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark } from "./icons";

export function Wordmark({ size = 17, hole }: { size?: number; hole?: string }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark size={Math.round(size * 1.53)} hole={hole} />
      <span className="font-brand font-bold tracking-[0.08em]" style={{ fontSize: size }}>
        TERMTEE
      </span>
    </span>
  );
}

export function HomeLogo() {
  return (
    <Link href="/" aria-label="TERMTEE หน้าแรก" className="-ml-1 flex min-h-11 items-center rounded-md px-1 text-fg">
      <Wordmark />
    </Link>
  );
}

export function LiveBadge({ small = false }: { small?: boolean }) {
  return (
    <span className={`badge badge-live ${small ? "badge-sm" : ""}`}>
      <span className={`${small ? "size-[5px]" : "size-1.5"} animate-live-pulse rounded-full bg-white`} aria-hidden />
      LIVE
    </span>
  );
}

const COVERS = [
  "linear-gradient(135deg,#123A6B,#1B2A6B 60%,#0B1033)",
  "linear-gradient(135deg,#3A1D6E,#1B2A6B 55%,#0B1033)",
  "linear-gradient(135deg,#1D4B6E,#162A5E 60%,#0B1033)",
  "linear-gradient(135deg,#3B2470,#1B2A6B 60%,#0B1033)",
  "linear-gradient(135deg,#2B1A55,#1A1F4E 60%,#0B1033)",
  "linear-gradient(135deg,#1A2F5E,#22195A 60%,#0B1033)",
];

function coverGradient(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COVERS[Math.abs(h) % COVERS.length];
}

/** 16:9 event cover (image or deterministic gradient placeholder). */
export function Cover({
  src,
  seed,
  alt = "",
  className = "",
  children,
}: {
  src: string | null | undefined;
  seed: string;
  alt?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`relative aspect-video overflow-hidden ${className}`} style={{ background: coverGradient(seed) }}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
      )}
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong px-6 py-16 text-center">
      {icon && (
        <span className="grid size-16 place-items-center rounded-[18px] bg-accent-soft text-link">{icon}</span>
      )}
      <h2 className="text-lg font-bold">{title}</h2>
      {body && <p className="max-w-[40ch] text-sm leading-[22px] text-muted">{body}</p>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

export function Notice({
  tone,
  children,
  role,
}: {
  tone: "ok" | "error" | "warning" | "info";
  children: ReactNode;
  role?: "alert" | "status";
}) {
  const cls = {
    ok: "border-success/40 bg-success/10 text-success-fg",
    error: "border-danger/45 bg-danger/10 text-[#FFC2CD]",
    warning: "border-warning/45 bg-warning/10 text-[#F7D9A0]",
    info: "border-border bg-white/[0.04] text-soft",
  }[tone];
  return (
    <div role={role} className={`rounded-md border px-3.5 py-3 text-sm leading-5 ${cls}`}>
      {children}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SettingsTab = { href: string; label: string };

/** Tab strip for /admin/settings/* (route per tab, so each tab is linkable). */
export default function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="หมวดการตั้งค่า" className="glass-admin flex flex-wrap gap-1 rounded-lg p-1.5">
      {tabs.map((t) => {
        const current = t.href === "/admin/settings" ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={`flex h-11 flex-[1_1_150px] items-center rounded-[10px] px-3.5 text-sm ${
              current ? "bg-accent font-semibold text-white" : "font-medium text-soft hover:bg-white/6"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

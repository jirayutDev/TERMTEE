"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { Permission } from "@/lib/roles";
import { CalendarIcon, CardIcon, PlusIcon, UsersIcon } from "@/components/ui/icons";

const svg = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const ChatIcon = () => (
  <svg {...svg}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" />
    <path d="M8.5 8.5h7M8.5 11.5h4.5" />
  </svg>
);

const GearIcon = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

type Item = {
  href: string;
  label: string;
  icon: ReactNode;
  match: (p: string) => boolean;
  badge?: number;
  /** Shown when the user has any of these. */
  any: Permission[];
};

export default function AdminNav({
  pendingSlips,
  openCases,
  permissions,
}: {
  pendingSlips: number;
  openCases: number;
  permissions: Permission[];
}) {
  const pathname = usePathname();
  const items: Item[] = [
    {
      href: "/admin",
      label: "Events",
      icon: <CalendarIcon size={18} />,
      match: (p) => p === "/admin" || (p.startsWith("/admin/events/") && p !== "/admin/events/new"),
      any: ["events"],
    },
    {
      href: "/admin/events/new",
      label: "สร้าง event",
      icon: <PlusIcon size={18} />,
      match: (p) => p === "/admin/events/new",
      any: ["events"],
    },
    {
      href: "/admin/payments",
      label: "ตรวจสลิป",
      icon: <CardIcon size={18} />,
      match: (p) => p.startsWith("/admin/payments"),
      badge: pendingSlips,
      any: ["payments"],
    },
    {
      href: "/admin/viewers",
      label: "คนดูขณะนี้",
      icon: <UsersIcon size={18} />,
      match: (p) => p.startsWith("/admin/viewers"),
      any: ["viewers"],
    },
    {
      href: "/admin/cases",
      label: "เคสลูกค้า",
      icon: <ChatIcon />,
      match: (p) => p.startsWith("/admin/cases"),
      badge: openCases,
      any: ["cases"],
    },
    {
      // Team-only users (no "settings") land on the team tab.
      href: permissions.includes("settings") ? "/admin/settings" : "/admin/settings/team",
      label: "ตั้งค่าร้าน",
      icon: <GearIcon />,
      match: (p) => p.startsWith("/admin/settings"),
      any: ["settings", "team"],
    },
  ];

  return (
    <nav aria-label="Admin" className="flex flex-wrap gap-1">
      {items
        .filter((it) => it.any.some((p) => permissions.includes(p)))
        .map((it) => {
          const current = it.match(pathname);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={current ? "page" : undefined}
              className={`flex h-11 flex-[1_1_160px] items-center gap-2.5 rounded-[10px] px-3 text-sm ${
                current ? "bg-accent font-semibold text-white" : "text-soft hover:bg-white/6"
              }`}
            >
              {it.icon}
              {it.label}
              {!!it.badge && (
                <span className="ml-auto inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-warning px-1.5 text-xs font-bold text-[#1A1203]">
                  <span className="sr-only">รอตรวจ </span>
                  {it.badge.toLocaleString("th-TH")}
                </span>
              )}
            </Link>
          );
        })}
    </nav>
  );
}

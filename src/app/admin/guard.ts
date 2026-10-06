import "server-only";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { can, type Permission } from "@/lib/roles";
import { loginUrl } from "@/lib/safe-redirect";

/**
 * For admin pages (server components): not signed in -> /login; signed in without the
 * permission -> 404 (same as non-staff hitting /admin). Server actions use `requirePermission`
 * from src/lib/roles.ts instead (throws).
 */
export async function pageUser(permission: Permission, path = "/admin") {
  const user = await currentUser();
  if (!user) redirect(loginUrl(path));
  if (!can(user.role, permission)) notFound();
  return user;
}

/** Admin-nav entry points in order; used to send staff without "events" to a page they can use. */
export const ADMIN_SECTIONS: { href: string; permission: Permission }[] = [
  { href: "/admin", permission: "events" },
  { href: "/admin/payments", permission: "payments" },
  { href: "/admin/viewers", permission: "viewers" },
  { href: "/admin/cases", permission: "cases" },
  { href: "/admin/settings", permission: "settings" },
  { href: "/admin/settings/team", permission: "team" },
];

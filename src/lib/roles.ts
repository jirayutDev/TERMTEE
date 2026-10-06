import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import type { Role } from "@/generated/prisma/client";

/** What each staff role may do. ADMIN implicitly has every permission. */
export type Permission =
  | "events" // create/edit events, start/stop live, archive replays
  | "payments" // review slips, approve/reject, refunds
  | "viewers" // see active viewers, kick
  | "cases" // support cases
  | "settings" // shop/payment/protection settings
  | "team"; // invite staff, change roles

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  VIEWER: [],
  SUPPORT: ["cases", "viewers"],
  FINANCE: ["payments", "cases"],
  MANAGER: ["events", "payments", "viewers", "cases"],
  ADMIN: ["events", "payments", "viewers", "cases", "settings", "team"],
};

export const ROLE_LABEL: Record<Role, string> = {
  VIEWER: "ผู้ชม",
  SUPPORT: "ซัพพอร์ต",
  FINANCE: "การเงิน",
  MANAGER: "ผู้จัดการ",
  ADMIN: "ผู้ดูแลระบบ",
};

export const STAFF_ROLES: readonly Role[] = ["SUPPORT", "FINANCE", "MANAGER", "ADMIN"];

export function isStaffRole(role: Role | undefined | null): boolean {
  return !!role && role !== "VIEWER";
}

export function can(role: Role | undefined | null, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsOf(role: Role | undefined | null): readonly Permission[] {
  return role ? ROLE_PERMISSIONS[role] : [];
}

/**
 * For server components / server actions / route handlers.
 * Not signed in -> /login; signed in without the permission -> throws (caller decides 404/403).
 */
export async function requirePermission(permission: Permission, callbackUrl = "/admin") {
  const user = await currentUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  if (!can(user.role, permission)) throw new ForbiddenError(permission);
  return user;
}

/** Same as requirePermission but returns null instead of redirecting/throwing (route handlers). */
export async function userWithPermission(permission: Permission) {
  const user = await currentUser();
  return user && can(user.role, permission) ? user : null;
}

export class ForbiddenError extends Error {
  constructor(public permission: Permission) {
    super(`forbidden: ${permission}`);
  }
}

"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { notify } from "@/lib/email";
import { STAFF_ROLES, requirePermission } from "@/lib/roles";
import { logAudit } from "@/lib/settings";
import type { Role } from "@/generated/prisma/client";

export type TeamFormState = { ok?: string; error?: string; fieldErrors?: Partial<Record<string, string[]>> };

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALL_ROLES: readonly Role[] = ["VIEWER", ...STAFF_ROLES];

const inviteSchema = z.object({
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.email("รูปแบบ email ไม่ถูกต้อง").max(200),
  ),
  role: z.enum(STAFF_ROLES as [Role, ...Role[]], { error: "กรุณาเลือกบทบาท" }),
});

function refresh() {
  revalidatePath("/admin/settings/team");
}

/** Invite by email: TeamInvite with a random token, valid 7 days; replaces earlier pending invites. */
export async function inviteAction(_prev: TeamFormState, formData: FormData): Promise<TeamFormState> {
  const actor = await requirePermission("team", "/admin/settings/team");
  const parsed = inviteSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const { email, role } = parsed.data;
  if (role === "ADMIN" && actor.role !== "ADMIN") return { error: "เฉพาะผู้ดูแลระบบเชิญผู้ดูแลระบบได้" };

  const existing = await db.user.findUnique({ where: { email }, select: { role: true, deletedAt: true } });
  if (existing && !existing.deletedAt && existing.role === role) {
    return { fieldErrors: { email: ["ผู้ใช้นี้มีบทบาทนี้อยู่แล้ว"] } };
  }

  const invite = await db.$transaction(async (tx) => {
    await tx.teamInvite.deleteMany({ where: { email, acceptedAt: null } });
    return tx.teamInvite.create({
      data: {
        email,
        role,
        invitedById: actor.id,
        token: randomBytes(32).toString("base64url"),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
  });
  await logAudit(actor.id, "team.invite", email, { role, inviteId: invite.id });
  after(() => notify(null, { kind: "team.invite", inviteId: invite.id }));
  refresh();
  return { ok: `ส่งคำเชิญไปที่ ${email} แล้ว` };
}

/** Delete a pending invite (its link stops working). */
export async function revokeInviteAction(inviteId: string) {
  const actor = await requirePermission("team", "/admin/settings/team");
  const invite = await db.teamInvite.findUnique({ where: { id: inviteId } });
  if (invite && !invite.acceptedAt) {
    await db.teamInvite.delete({ where: { id: inviteId } });
    await logAudit(actor.id, "team.invite_revoked", invite.email, { role: invite.role });
  }
  refresh();
}

/**
 * Change a staff member's role (VIEWER = remove from the team). ADMIN only.
 * You cannot change your own role, and the last ADMIN cannot be demoted.
 */
export async function changeRoleAction(userId: string, _prev: TeamFormState, formData: FormData): Promise<TeamFormState> {
  const actor = await requirePermission("team", "/admin/settings/team");
  if (actor.role !== "ADMIN") return { error: "เฉพาะผู้ดูแลระบบเปลี่ยนบทบาทได้" };
  if (actor.id === userId) return { error: "เปลี่ยนบทบาทของตัวเองไม่ได้" };
  const role = formData.get("role");
  if (typeof role !== "string" || !(ALL_ROLES as readonly string[]).includes(role)) return { error: "บทบาทไม่ถูกต้อง" };
  const next = role as Role;

  const result = await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true, email: true } });
    if (!target) return { error: "ไม่พบผู้ใช้" } as const;
    if (target.role === next) return { same: true, target } as const;
    if (target.role === "ADMIN" && next !== "ADMIN") {
      const admins = await tx.user.count({ where: { role: "ADMIN", deletedAt: null } });
      if (admins <= 1) return { error: "ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน" } as const;
    }
    await tx.user.update({ where: { id: userId }, data: { role: next } });
    return { target } as const;
  }, { isolationLevel: "Serializable" }); // two concurrent demotions must not remove the last ADMIN
  if ("error" in result) return { error: result.error };
  if (!("same" in result)) {
    await logAudit(actor.id, "team.role", userId, { email: result.target.email, from: result.target.role, to: next });
  }
  refresh();
  return { ok: next === "VIEWER" ? "นำออกจากทีมแล้ว" : "บันทึกแล้ว" };
}

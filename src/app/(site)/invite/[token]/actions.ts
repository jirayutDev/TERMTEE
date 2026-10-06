"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { loginUrl } from "@/lib/safe-redirect";
import { logAudit } from "@/lib/settings";

export type AcceptState = { error?: string };

/** Accept a team invite: the signed-in user's email must match; sets their role. */
export async function acceptInviteAction(token: string): Promise<AcceptState> {
  const user = await currentUser();
  if (!user) redirect(loginUrl(`/invite/${encodeURIComponent(token)}`));

  const result = await db.$transaction(
    async (tx) => {
      const invite = await tx.teamInvite.findUnique({ where: { token } });
      if (!invite || invite.acceptedAt) return { error: "คำเชิญนี้ถูกใช้หรือถูกยกเลิกไปแล้ว" };
      if (invite.expiresAt <= new Date()) return { error: "คำเชิญนี้หมดอายุแล้ว กรุณาขอคำเชิญใหม่" };
      if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
        return { error: `คำเชิญนี้ส่งถึง ${invite.email} กรุณาเข้าสู่ระบบด้วยบัญชีนั้น` };
      }
      const me = await tx.user.findUnique({ where: { id: user.id }, select: { role: true } });
      if (!me) return { error: "ไม่พบบัญชีผู้ใช้" };
      if (me.role === "ADMIN" && invite.role !== "ADMIN") {
        const admins = await tx.user.count({ where: { role: "ADMIN", deletedAt: null } });
        if (admins <= 1) return { error: "คุณเป็นผู้ดูแลระบบคนสุดท้าย จึงเปลี่ยนเป็นบทบาทนี้ไม่ได้" };
      }
      const claimed = await tx.teamInvite.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0) return { error: "คำเชิญนี้ถูกใช้ไปแล้ว" };
      await tx.user.update({ where: { id: user.id }, data: { role: invite.role } });
      return { invite, from: me.role };
    },
    { isolationLevel: "Serializable" },
  );

  if ("error" in result) return { error: result.error };
  await logAudit(user.id, "team.invite_accepted", result.invite.email, {
    inviteId: result.invite.id,
    from: result.from,
    to: result.invite.role,
  });
  redirect("/admin");
}

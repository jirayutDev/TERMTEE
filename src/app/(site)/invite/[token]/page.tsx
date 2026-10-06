import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { formatDayTime } from "@/lib/format";
import { ROLE_LABEL, isStaffRole } from "@/lib/roles";
import { UsersIcon, GoogleIcon } from "@/components/ui/icons";
import { signInWithGoogleAction, signOutAction } from "../../../auth-actions";
import { acceptInviteAction } from "./actions";
import AcceptForm from "./accept-form";

export const metadata: Metadata = { title: "คำเชิญเข้าทีมงาน", robots: { index: false } };

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-4 px-4 pt-[clamp(28px,6vw,72px)] pb-12 text-center sm:px-6">
      <span className="grid size-16 place-items-center rounded-[18px] bg-accent-soft text-link">
        <UsersIcon size={32} />
      </span>
      <h1 className="text-[clamp(22px,1vw+18px,28px)] leading-[1.35] font-bold">{title}</h1>
      {children}
    </div>
  );
}

const p = "max-w-[46ch] text-[15px] leading-[1.7] text-soft";

/** Team invite link from email. Accepting is a POST (server action), never on GET. */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [user, invite] = await Promise.all([
    currentUser(),
    db.teamInvite.findUnique({ where: { token }, include: { invitedBy: { select: { name: true } } } }),
  ]);

  if (!invite) {
    return (
      <Shell title="ไม่พบคำเชิญนี้">
        <p className={p}>ลิงก์อาจไม่ครบ หรือคำเชิญถูกยกเลิกไปแล้ว กรุณาขอคำเชิญใหม่จากผู้ดูแลระบบ</p>
      </Shell>
    );
  }
  if (invite.acceptedAt) {
    return (
      <Shell title="ตอบรับคำเชิญนี้แล้ว">
        <p className={p}>คำเชิญนี้ถูกใช้ไปแล้ว</p>
        {user && isStaffRole(user.role) && (
          <Link href="/admin" className="btn btn-primary">
            ไปแผงผู้ดูแล
          </Link>
        )}
      </Shell>
    );
  }
  if (invite.expiresAt <= new Date()) {
    return (
      <Shell title="คำเชิญหมดอายุแล้ว">
        <p className={p}>คำเชิญใช้ได้ 7 วัน กรุณาขอให้ผู้ดูแลระบบส่งคำเชิญใหม่</p>
      </Shell>
    );
  }

  const intro = (
    <p className={p}>
      {invite.invitedBy.name ? `คุณ${invite.invitedBy.name}` : "ผู้ดูแลระบบ"} เชิญ <strong className="text-fg">{invite.email}</strong>{" "}
      เข้าร่วมทีมงานหลังบ้านในบทบาท <strong className="text-fg">{ROLE_LABEL[invite.role]}</strong>
      <span className="block text-[13px] text-muted">ใช้ได้ถึง {formatDayTime(invite.expiresAt)}</span>
    </p>
  );

  if (!user) {
    return (
      <Shell title="คำเชิญเข้าทีมงาน">
        {intro}
        <p className="text-sm text-muted">เข้าสู่ระบบด้วย Google ของ {invite.email} เพื่อตอบรับ</p>
        <form action={signInWithGoogleAction}>
          <input type="hidden" name="callbackUrl" value={`/invite/${encodeURIComponent(token)}`} />
          <button className="inline-flex h-12 items-center gap-2.5 rounded-[12px] bg-white px-5 text-[15px] font-semibold text-[#1F1F1F] hover:bg-[#EEF1FB]">
            <GoogleIcon size={18} />
            เข้าสู่ระบบด้วย Google
          </button>
        </form>
      </Shell>
    );
  }

  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Shell title="บัญชีไม่ตรงกับคำเชิญ">
        {intro}
        <p className={p}>
          ตอนนี้คุณเข้าสู่ระบบด้วย <strong className="text-fg">{user.email}</strong> คำเชิญนี้ใช้ได้กับ{" "}
          <strong className="text-fg">{invite.email}</strong> เท่านั้น ออกจากระบบแล้วเปิดลิงก์นี้อีกครั้งด้วยบัญชีที่ถูกต้อง
        </p>
        <form action={signOutAction}>
          <button className="btn btn-outline">ออกจากระบบ</button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell title="คำเชิญเข้าทีมงาน">
      {intro}
      <AcceptForm action={acceptInviteAction.bind(null, token)} />
    </Shell>
  );
}

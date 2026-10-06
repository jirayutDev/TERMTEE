import { formatThaiDateTime } from "@/lib/format";
import { link, renderLayout, type RenderedEmail, type TemplateContext } from "./layout";

export interface TeamInviteData {
  roleLabel: string;
  inviterName: string | null;
  token: string;
  expiresAt: Date;
}

export function teamInviteEmail(ctx: TemplateContext, d: TeamInviteData): RenderedEmail {
  const shop = ctx.shop.name;
  return {
    subject: `คำเชิญเข้าร่วมทีม ${shop}`,
    ...renderLayout(ctx, {
      preheader: `คุณได้รับเชิญในตำแหน่ง ${d.roleLabel}`,
      heading: `คุณได้รับเชิญเข้าร่วมทีม ${shop}`,
      paragraphs: [
        `${d.inviterName ? `คุณ${d.inviterName}` : "ผู้ดูแลระบบ"} เชิญคุณเข้าร่วมทีมงานหลังบ้านของ ${shop}`,
        "กดปุ่มด้านล่างแล้วเข้าสู่ระบบด้วยอีเมลนี้เพื่อตอบรับคำเชิญ",
      ],
      rows: [
        { label: "ตำแหน่ง", value: d.roleLabel },
        { label: "หมดอายุ", value: formatThaiDateTime(d.expiresAt) },
      ],
      buttons: [{ label: "ตอบรับคำเชิญ", href: link(ctx, `/invite/${encodeURIComponent(d.token)}`) }],
      footnote: "หากคุณไม่ได้คาดว่าจะได้รับอีเมลนี้ สามารถเพิกเฉยได้",
    }),
  };
}

export interface AccountDeletedData {
  email: string;
}

export function accountDeletedEmail(ctx: TemplateContext, d: AccountDeletedData): RenderedEmail {
  return {
    subject: `ลบบัญชี ${ctx.shop.name} เรียบร้อยแล้ว`,
    ...renderLayout(ctx, {
      preheader: "บัญชีของคุณถูกลบแล้ว",
      heading: "ลบบัญชีเรียบร้อยแล้ว",
      paragraphs: [
        `บัญชี ${d.email} ถูกลบและข้อมูลส่วนตัวถูกลบออกจากระบบแล้ว`,
        "ข้อมูลคำสั่งซื้อจะถูกเก็บไว้ในรูปแบบที่ไม่ระบุตัวตนเพื่อวัตถุประสงค์ทางบัญชีตามกฎหมาย",
        "หากคุณไม่ได้เป็นผู้ดำเนินการ กรุณาติดต่อทีมงานโดยเร็ว",
      ],
      buttons: [{ label: "ติดต่อทีมงาน", href: link(ctx, "/support") }],
    }),
  };
}

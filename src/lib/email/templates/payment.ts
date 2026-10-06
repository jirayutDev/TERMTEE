import { formatBaht, formatThaiDateTime, orderRef } from "@/lib/format";
import { greet, link, renderLayout, type RenderedEmail, type TemplateContext } from "./layout";

export interface PaymentVerifiedData {
  name: string | null;
  orderId: string;
  eventTitle: string;
  eventSlug: string;
  startsAt: Date;
  amountSatang: number;
}

export function paymentVerifiedEmail(ctx: TemplateContext, d: PaymentVerifiedData): RenderedEmail {
  const subject = `ชำระเงินสำเร็จ: ${d.eventTitle}`;
  return {
    subject,
    ...renderLayout(ctx, {
      preheader: `ตั๋วของคุณพร้อมแล้ว ${d.eventTitle}`,
      heading: "ชำระเงินสำเร็จ ตั๋วของคุณพร้อมแล้ว",
      paragraphs: [
        greet(d.name),
        "เราตรวจสอบสลิปเรียบร้อยแล้ว คุณสามารถเข้าชมได้ตามเวลาด้านล่าง",
      ],
      rows: [
        { label: "รายการ", value: d.eventTitle },
        { label: "เริ่ม", value: formatThaiDateTime(d.startsAt) },
        { label: "ยอดชำระ", value: formatBaht(d.amountSatang) },
        { label: "คำสั่งซื้อ", value: orderRef(d.orderId) },
      ],
      buttons: [
        { label: "เข้าชม", href: link(ctx, `/watch/${encodeURIComponent(d.eventSlug)}`) },
        { label: "ตั๋วของฉัน", href: link(ctx, "/library") },
      ],
      footnote: "รับชมได้ครั้งละ 1 อุปกรณ์ กรุณาเข้าสู่ระบบด้วยบัญชีเดียวกับที่ซื้อตั๋ว",
    }),
  };
}

export interface PaymentRejectedData {
  name: string | null;
  orderId: string;
  eventTitle: string;
  reason: string | null;
}

export function paymentRejectedEmail(ctx: TemplateContext, d: PaymentRejectedData): RenderedEmail {
  return {
    subject: `สลิปไม่ผ่านการตรวจสอบ: ${d.eventTitle}`,
    ...renderLayout(ctx, {
      preheader: "กรุณาอัปโหลดสลิปใหม่",
      heading: "สลิปไม่ผ่านการตรวจสอบ",
      paragraphs: [
        greet(d.name),
        `สลิปที่อัปโหลดสำหรับคำสั่งซื้อ ${orderRef(d.orderId)} (${d.eventTitle}) ไม่ผ่านการตรวจสอบ ด้วยเหตุผลต่อไปนี้`,
      ],
      quote: d.reason || "สลิปไม่ถูกต้อง",
      buttons: [{ label: "อัปโหลดสลิปใหม่", href: link(ctx, `/pay/${encodeURIComponent(d.orderId)}`) }],
      footnote: "หากคุณโอนเงินแล้วและคิดว่าเกิดข้อผิดพลาด กรุณาติดต่อทีมงานพร้อมแนบหลักฐานการโอน",
    }),
  };
}

export interface PaymentNeedsReviewData {
  name: string | null;
  orderId: string;
  eventTitle: string;
}

export function paymentNeedsReviewEmail(ctx: TemplateContext, d: PaymentNeedsReviewData): RenderedEmail {
  return {
    subject: `กำลังตรวจสลิป: ${d.eventTitle}`,
    ...renderLayout(ctx, {
      preheader: "เจ้าหน้าที่กำลังตรวจสอบสลิปของคุณ",
      heading: "กำลังตรวจสลิป",
      paragraphs: [
        greet(d.name),
        `เราได้รับสลิปสำหรับคำสั่งซื้อ ${orderRef(d.orderId)} (${d.eventTitle}) แล้ว ระบบอ่านข้อมูลบางส่วนไม่ได้ เจ้าหน้าที่จะตรวจสอบและแจ้งผลทางอีเมลโดยเร็ว`,
        "ไม่ต้องอัปโหลดสลิปซ้ำ",
      ],
      buttons: [{ label: "ดูสถานะคำสั่งซื้อ", href: link(ctx, `/pay/${encodeURIComponent(d.orderId)}`) }],
    }),
  };
}

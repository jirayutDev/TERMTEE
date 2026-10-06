import { formatThaiDateTime } from "@/lib/format";
import { greet, link, renderLayout, type RenderedEmail, type TemplateContext } from "./layout";

export interface EventStartingData {
  name: string | null;
  eventTitle: string;
  eventSlug: string;
  startsAt: Date;
}

export function eventStartingEmail(ctx: TemplateContext, d: EventStartingData): RenderedEmail {
  return {
    subject: `ใกล้เริ่มแล้ว: ${d.eventTitle}`,
    ...renderLayout(ctx, {
      preheader: `${d.eventTitle} เริ่ม ${formatThaiDateTime(d.startsAt)}`,
      heading: "ไลฟ์ของคุณใกล้เริ่มแล้ว",
      paragraphs: [greet(d.name), `${d.eventTitle} จะเริ่มถ่ายทอดสดในอีกไม่กี่นาที เตรียมตัวเข้าชมได้เลย`],
      rows: [
        { label: "รายการ", value: d.eventTitle },
        { label: "เริ่ม", value: formatThaiDateTime(d.startsAt) },
      ],
      buttons: [{ label: "เข้าชม", href: link(ctx, `/watch/${encodeURIComponent(d.eventSlug)}`) }],
      footnote: "แนะนำให้เข้าก่อนเวลาเล็กน้อยเพื่อตรวจสอบอุปกรณ์ รับชมได้ครั้งละ 1 อุปกรณ์",
    }),
  };
}

export interface ReplayExpiringData {
  name: string | null;
  eventTitle: string;
  eventSlug: string;
  expiresAt: Date;
}

export function replayExpiringEmail(ctx: TemplateContext, d: ReplayExpiringData): RenderedEmail {
  return {
    subject: `ดูย้อนหลังได้ถึง ${formatThaiDateTime(d.expiresAt)}: ${d.eventTitle}`,
    ...renderLayout(ctx, {
      preheader: "การดูย้อนหลังใกล้หมดเวลาแล้ว",
      heading: "การดูย้อนหลังใกล้หมดเวลา",
      paragraphs: [greet(d.name), `${d.eventTitle} จะปิดการดูย้อนหลังภายใน 24 ชั่วโมง หลังจากนั้นจะไม่สามารถรับชมได้อีก`],
      rows: [
        { label: "รายการ", value: d.eventTitle },
        { label: "ดูได้ถึง", value: formatThaiDateTime(d.expiresAt) },
      ],
      buttons: [{ label: "ดูย้อนหลัง", href: link(ctx, `/watch/${encodeURIComponent(d.eventSlug)}`) }],
    }),
  };
}

import { greet, link, renderLayout, type RenderedEmail, type TemplateContext } from "./layout";

export const EXCERPT_MAX = 400;

export function excerpt(body: string, max = EXCERPT_MAX): string {
  const s = body.trim();
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

export interface CaseStaffReplyData {
  name: string | null;
  caseId: string;
  caseNumber: number;
  subject: string;
  message: string | null; // latest public staff message (already excerpted or raw)
}

export function caseStaffReplyEmail(ctx: TemplateContext, d: CaseStaffReplyData): RenderedEmail {
  const ref = `TT-C${d.caseNumber}`;
  return {
    subject: `[${ref}] ทีมงานตอบกลับแล้ว: ${d.subject}`,
    ...renderLayout(ctx, {
      preheader: `ทีมงานตอบกลับเคส ${ref}`,
      heading: "ทีมงานตอบกลับเคสของคุณแล้ว",
      paragraphs: [greet(d.name), `เคส ${ref} · ${d.subject}`],
      quote: d.message ? excerpt(d.message) : undefined,
      buttons: [{ label: "ดูและตอบกลับ", href: link(ctx, `/support/${encodeURIComponent(d.caseId)}`) }],
      footnote: "กรุณาตอบกลับผ่านหน้าเคส การตอบกลับอีเมลนี้จะไม่ถึงทีมงาน",
    }),
  };
}

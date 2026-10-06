/**
 * Shared email layout: table-based, inline styles, light body with a dark brand header.
 * Pure functions (no DB / server-only) so templates can be previewed and unit-tested.
 */

export interface ShopInfo {
  name: string;
  supportEmail: string | null;
  supportLine: string | null;
  supportPhone: string | null;
  supportHours: string | null;
}

export interface TemplateContext {
  shop: ShopInfo;
  appUrl: string; // no trailing slash
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function greet(name: string | null | undefined): string {
  const n = name?.trim();
  return n ? `สวัสดีคุณ${n}` : "สวัสดี";
}

export function link(ctx: TemplateContext, path: string): string {
  return `${ctx.appUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

const BRAND_BG = "#060a22";
const ACCENT = "#2b5cff";
const FONT = "'Noto Sans Thai','Sarabun','Leelawadee UI',Tahoma,Arial,sans-serif";

export interface Button {
  label: string;
  href: string;
}

export interface Row {
  label: string;
  value: string;
}

export interface LayoutInput {
  preheader: string;
  heading: string;
  /** Paragraphs of plain text (escaped). */
  paragraphs: string[];
  rows?: Row[];
  /** Optional quoted block (e.g. reject reason, staff message). */
  quote?: string;
  buttons?: Button[];
  footnote?: string;
}

function supportLines(shop: ShopInfo): string[] {
  const out: string[] = [];
  if (shop.supportEmail) out.push(`อีเมล: ${shop.supportEmail}`);
  if (shop.supportLine) out.push(`LINE: ${shop.supportLine}`);
  if (shop.supportPhone) out.push(`โทร: ${shop.supportPhone}`);
  if (shop.supportHours) out.push(`เวลาทำการ: ${shop.supportHours}`);
  return out;
}

export function renderLayout(ctx: TemplateContext, input: LayoutInput): { html: string; text: string } {
  const e = escapeHtml;
  const shopName = e(ctx.shop.name);

  const paragraphs = input.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1f2433;">${e(p)}</p>`)
    .join("");

  const rows = input.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border-collapse:collapse;background:#f5f7ff;border-radius:8px;">${input.rows
        .map(
          (r) =>
            `<tr><td style="padding:10px 14px;font-size:13px;color:#5b6177;width:38%;vertical-align:top;">${e(r.label)}</td><td style="padding:10px 14px;font-size:14px;color:#1f2433;font-weight:600;vertical-align:top;">${e(r.value)}</td></tr>`,
        )
        .join("")}</table>`
    : "";

  const quote = input.quote
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;"><tr><td style="border-left:4px solid ${ACCENT};background:#f5f7ff;padding:12px 14px;font-size:14px;line-height:1.6;color:#1f2433;white-space:pre-line;">${e(input.quote)}</td></tr></table>`
    : "";

  const buttons = (input.buttons ?? [])
    .map(
      (b, i) =>
        `<td style="padding:0 8px 8px 0;"><a href="${e(b.href)}" style="display:inline-block;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;${
          i === 0 ? `background:${ACCENT};color:#ffffff;` : `background:#ffffff;color:${ACCENT};border:1px solid ${ACCENT};`
        }">${e(b.label)}</a></td>`,
    )
    .join("");
  const buttonsHtml = buttons
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 10px;"><tr>${buttons}</tr></table>`
    : "";

  const support = supportLines(ctx.shop);
  const footer = [
    `ติดต่อทีมงาน ${shopName}`,
    ...support.map(e),
    `<a href="${e(link(ctx, "/support"))}" style="color:${ACCENT};">ศูนย์ช่วยเหลือ</a> · <a href="${e(link(ctx, "/account"))}" style="color:${ACCENT};">ตั้งค่าการแจ้งเตือน</a>`,
  ].join("<br>");

  const html = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(input.heading)}</title></head>
<body style="margin:0;padding:0;background:#eef0f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f6;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${FONT};">
<tr><td style="background:${BRAND_BG};padding:18px 24px;border-radius:12px 12px 0 0;font-size:18px;font-weight:700;letter-spacing:0.5px;color:#ffffff;">${shopName}</td></tr>
<tr><td style="background:#ffffff;padding:28px 24px 20px;border-radius:0 0 12px 12px;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:#0b1033;">${e(input.heading)}</h1>
${paragraphs}${rows}${quote}${buttonsHtml}
${input.footnote ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.6;color:#5b6177;">${e(input.footnote)}</p>` : ""}
</td></tr>
<tr><td style="padding:18px 24px;font-size:12px;line-height:1.7;color:#7a8099;text-align:center;">${footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    input.heading,
    "",
    ...input.paragraphs.flatMap((p) => [p, ""]),
    ...(input.rows ?? []).map((r) => `${r.label}: ${r.value}`),
    ...(input.rows?.length ? [""] : []),
    ...(input.quote ? [input.quote, ""] : []),
    ...(input.buttons ?? []).map((b) => `${b.label}: ${b.href}`),
    ...(input.footnote ? ["", input.footnote] : []),
    "",
    "—",
    `ติดต่อทีมงาน ${ctx.shop.name}`,
    ...support,
    `ศูนย์ช่วยเหลือ: ${link(ctx, "/support")}`,
  ].join("\n");

  return { html, text };
}

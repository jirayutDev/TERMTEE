import { userWithPermission } from "@/lib/roles";
import { getTemplateContext } from "@/lib/email";
import { SAMPLE_TEMPLATES, escapeHtml } from "@/lib/email/templates";

/**
 * Dev-only email preview: /api/dev/email-preview?template=payment.verified[&format=text]
 * Without ?template, lists the available templates. Staff only, never in production.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  // "cases" is held by every staff role.
  if (!(await userWithPermission("cases"))) return new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const name = url.searchParams.get("template");
  const render = name ? SAMPLE_TEMPLATES[name] : undefined;

  if (!render) {
    const items = Object.keys(SAMPLE_TEMPLATES)
      .map((k) => {
        const href = `?template=${encodeURIComponent(k)}`;
        return `<li><a href="${escapeHtml(href)}">${escapeHtml(k)}</a> · <a href="${escapeHtml(`${href}&format=text`)}">text</a></li>`;
      })
      .join("");
    return new Response(`<!doctype html><meta charset="utf-8"><title>Email preview</title><ul>${items}</ul>`, {
      status: name ? 404 : 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const mail = render(await getTemplateContext());
  if (url.searchParams.get("format") === "text") {
    return new Response(`Subject: ${mail.subject}\n\n${mail.text}`, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(mail.html, {
    headers: { "content-type": "text/html; charset=utf-8", "x-email-subject": encodeURIComponent(mail.subject) },
  });
}

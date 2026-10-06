import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/roles";
import { parseAttachments } from "@/lib/support";
import { getUploadStorage, isUploadKey } from "@/lib/uploads";

export const runtime = "nodejs";

const notFound = () => new Response("not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });

/**
 * Serves a case attachment to the case owner (public messages only) or staff with "cases".
 * The key must belong to the given message, so knowing a hash alone grants nothing.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/support/attachments/[messageId]/[key]">) {
  const user = await currentUser();
  if (!user?.id) return notFound();

  const { messageId, key } = await ctx.params;
  if (!isUploadKey(key)) return notFound();

  const message = await db.caseMessage.findUnique({
    where: { id: messageId },
    select: { internal: true, attachments: true, case: { select: { userId: true } } },
  });
  if (!message) return notFound();

  const isStaff = can(user.role, "cases");
  const isOwner = message.case.userId === user.id;
  if (!isStaff && !(isOwner && !message.internal)) return notFound();

  const attachment = parseAttachments(message.attachments).find((a) => a.key === key);
  if (!attachment) return notFound();

  const file = await getUploadStorage().get(key);
  if (!file) return notFound();

  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.body.length),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": `inline; filename="${key}"`,
    },
  });
}

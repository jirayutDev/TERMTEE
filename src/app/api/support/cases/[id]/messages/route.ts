import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { notify } from "@/lib/email";
import { can } from "@/lib/roles";
import { UploadError } from "@/lib/uploads";
import { MAX_BODY_CHARS, filesFromForm, saveAttachments } from "@/lib/support";

export const runtime = "nodejs";

function error(code: string, message: string, status: number) {
  return Response.json({ error: code, message }, { status });
}

const schema = z.object({
  body: z.string().trim().max(MAX_BODY_CHARS),
  // Staff only (ignored for customers):
  internal: z.enum(["0", "1"]).default("0"),
  resolve: z.enum(["0", "1"]).default("0"),
});

/**
 * Adds a message to a case (multipart: body, up to 3 image `files`).
 * - Case owner: public reply, status -> OPEN (reopens resolved/closed cases).
 * - Staff with "cases": public reply (status -> PENDING_CUSTOMER or RESOLVED with resolve=1,
 *   lastStaffAt, email notification) or internal note (internal=1, status unchanged).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/support/cases/[id]/messages">) {
  const user = await currentUser();
  if (!user?.id) return error("unauthorized", "กรุณาเข้าสู่ระบบ", 401);

  const { id } = await ctx.params;
  const supportCase = await db.supportCase.findUnique({ where: { id }, select: { id: true, userId: true, assigneeId: true } });
  const isStaff = can(user.role, "cases");
  const isOwner = supportCase?.userId === user.id;
  if (!supportCase || (!isOwner && !isStaff)) return error("not_found", "ไม่พบเคส", 404);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error("invalid_body", "ข้อมูลที่ส่งมาไม่ถูกต้อง", 400);
  }
  const parsed = schema.safeParse({
    body: form.get("body") ?? "",
    internal: form.get("internal") ?? undefined,
    resolve: form.get("resolve") ?? undefined,
  });
  if (!parsed.success) {
    return error("invalid_input", `ข้อความยาวเกิน ${MAX_BODY_CHARS.toLocaleString("th-TH")} ตัวอักษร`, 400);
  }
  // Staff replying to their own case from /support act as the customer.
  const asStaff = isStaff && (form.get("as") === "staff" || !isOwner);
  const internal = asStaff && parsed.data.internal === "1";
  const resolve = asStaff && !internal && parsed.data.resolve === "1";
  const files = filesFromForm(form);
  if (!parsed.data.body && files.length === 0) return error("empty", "กรุณาพิมพ์ข้อความหรือแนบรูป", 400);

  let attachments;
  try {
    attachments = await saveAttachments(files);
  } catch (err) {
    if (err instanceof UploadError) return error("invalid_file", err.message, 400);
    throw err;
  }

  const now = new Date();
  await db.$transaction([
    db.caseMessage.create({
      data: {
        caseId: id,
        authorId: user.id,
        isStaff: asStaff,
        internal,
        body: parsed.data.body,
        attachments: attachments as object[],
      },
    }),
    db.supportCase.update({
      where: { id },
      data: internal
        ? { updatedAt: now }
        : asStaff
          ? {
              status: resolve ? "RESOLVED" : "PENDING_CUSTOMER",
              lastStaffAt: now,
              closedAt: resolve ? now : null,
              // First responder takes the case unless someone already has it.
              ...(supportCase.assigneeId ? {} : { assigneeId: user.id }),
            }
          : { status: "OPEN", closedAt: null },
    }),
  ]);

  if (asStaff && !internal) await notify(supportCase.userId, { kind: "case.staff_reply", caseId: id });

  revalidatePath(`/support/${id}`);
  revalidatePath("/support");
  revalidatePath("/admin", "layout");
  return Response.json({ ok: true }, { status: 201 });
}


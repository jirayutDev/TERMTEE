import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { CaseCategory } from "@/generated/prisma/enums";
import { UploadError } from "@/lib/uploads";
import {
  MAX_BODY_CHARS,
  MAX_NEW_CASES_PER_DAY,
  MAX_SUBJECT_CHARS,
  caseRef,
  filesFromForm,
  parseDeviceInfo,
  recentCaseCount,
  saveAttachments,
} from "@/lib/support";

export const runtime = "nodejs";

function error(code: string, message: string, status: number) {
  return Response.json({ error: code, message }, { status });
}

const schema = z.object({
  category: z.enum(CaseCategory),
  subject: z.string().trim().min(3).max(MAX_SUBJECT_CHARS),
  message: z.string().trim().min(1).max(MAX_BODY_CHARS),
  related: z
    .string()
    .regex(/^(|order:[a-z0-9]{10,40}|event:[a-z0-9]{10,40})$/)
    .default(""),
});

/** Customer opens a new support case (multipart: fields + up to 3 image `files`). */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user?.id) return error("unauthorized", "กรุณาเข้าสู่ระบบ", 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error("invalid_body", "ข้อมูลที่ส่งมาไม่ถูกต้อง", 400);
  }

  const parsed = schema.safeParse({
    category: form.get("category"),
    subject: form.get("subject"),
    message: form.get("message"),
    related: form.get("related") ?? "",
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const message =
      field === "subject"
        ? `กรุณาใส่หัวข้อ 3–${MAX_SUBJECT_CHARS} ตัวอักษร`
        : field === "message"
          ? `กรุณาใส่รายละเอียด (ไม่เกิน ${MAX_BODY_CHARS.toLocaleString("th-TH")} ตัวอักษร)`
          : field === "category"
            ? "กรุณาเลือกเรื่องที่ต้องการแจ้ง"
            : "ข้อมูลไม่ถูกต้อง";
    return error("invalid_input", message, 400);
  }
  const { category, subject, message, related } = parsed.data;

  if ((await recentCaseCount(user.id)) >= MAX_NEW_CASES_PER_DAY) {
    return error(
      "rate_limited",
      `แจ้งเคสใหม่ได้ไม่เกิน ${MAX_NEW_CASES_PER_DAY} เคสต่อวัน · ตอบกลับในเคสเดิมได้เลย`,
      429,
    );
  }

  // Related order/event: must be the user's own order; any visible event.
  let orderId: string | null = null;
  let eventId: string | null = null;
  if (related.startsWith("order:")) {
    const order = await db.order.findUnique({ where: { id: related.slice(6) }, select: { id: true, userId: true, eventId: true } });
    if (!order || order.userId !== user.id) return error("order_not_found", "ไม่พบคำสั่งซื้อ", 400);
    orderId = order.id;
    eventId = order.eventId;
  } else if (related.startsWith("event:")) {
    const event = await db.event.findUnique({ where: { id: related.slice(6) }, select: { id: true, status: true } });
    if (!event || event.status === "DRAFT") return error("event_not_found", "ไม่พบ event", 400);
    eventId = event.id;
  }
  const duringLive = eventId
    ? (await db.event.findUnique({ where: { id: eventId }, select: { status: true } }))?.status === "LIVE"
    : false;

  const deviceInfo = parseDeviceInfo(form.get("deviceInfo"));

  let attachments;
  try {
    attachments = await saveAttachments(filesFromForm(form));
  } catch (err) {
    if (err instanceof UploadError) return error("invalid_file", err.message, 400);
    throw err;
  }

  const created = await db.supportCase.create({
    data: {
      userId: user.id,
      orderId,
      eventId,
      category,
      subject,
      duringLive,
      // Live problems jump the queue.
      priority: duringLive ? "HIGH" : "NORMAL",
      ...(deviceInfo ? { deviceInfo } : {}),
      messages: {
        create: { authorId: user.id, isStaff: false, body: message, attachments: attachments as object[] },
      },
    },
    select: { id: true, number: true },
  });

  revalidatePath("/support");
  revalidatePath("/admin", "layout");
  return Response.json({ id: created.id, ref: caseRef(created.number) }, { status: 201 });
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/roles";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { deleteEventMedia, startEvent, stopEvent } from "@/lib/media/client";
import { INPUT_URL_SCHEME, isPushInput } from "@/lib/media/types";
import { KICKED_DEVICE_ID } from "@/lib/viewers";

/** Events, live control, replays and tickets: "events". Kicking viewers: "viewers". */
async function requireEvents() {
  await requirePermission("events");
}

// ---------- Create / edit ----------

export type EventFormState = {
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  values?: Record<string, string>;
};

function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  return out;
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const eventSchema = z
  .object({
    title: z.string().trim().min(1, "กรุณากรอกชื่อรายการ").max(200),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "ใช้ได้เฉพาะ a-z, 0-9 และ - เท่านั้น")
      .max(100),
    description: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
    coverUrl: z.preprocess(emptyToUndefined, z.url("URL ไม่ถูกต้อง").optional()),
    priceThb: z.coerce
      .number("กรุณากรอกราคา")
      .min(0, "ราคาต้องไม่ติดลบ")
      .max(1_000_000)
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "ทศนิยมได้ไม่เกิน 2 ตำแหน่ง"),
    startsAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "กรุณาเลือกวันเวลาเริ่ม")
      // datetime-local input is interpreted as Bangkok time (UTC+7, no DST)
      .transform((v) => new Date(`${v}:00+07:00`))
      .refine((d) => !Number.isNaN(d.getTime()), "วันเวลาไม่ถูกต้อง"),
    replayDays: z.coerce.number().int("ต้องเป็นจำนวนเต็ม").min(0).max(365),
    inputType: z.enum(["SRT", "RTMP", "HLS", "DASH", "RTSP", "BROWSER"]),
    inputUrl: z.preprocess(emptyToUndefined, z.url("URL ไม่ถูกต้อง").optional()),
    status: z.enum(["DRAFT", "SCHEDULED"]),
  })
  .refine((v) => isPushInput(v.inputType) || !!v.inputUrl, {
    path: ["inputUrl"],
    message: "ต้องระบุ URL ต้นทางสำหรับอินพุตแบบนี้",
  })
  .refine((v) => !v.inputUrl || (INPUT_URL_SCHEME[v.inputType]?.test(v.inputUrl) ?? true), {
    path: ["inputUrl"],
    message: "รูปแบบ URL ไม่ตรงกับประเภทอินพุต",
  });

function parseEventForm(formData: FormData) {
  return eventSchema.safeParse({
    title: formData.get("title") ?? "",
    slug: formData.get("slug") ?? "",
    description: formData.get("description") ?? "",
    coverUrl: formData.get("coverUrl") ?? "",
    priceThb: formData.get("priceThb") ?? "",
    startsAt: formData.get("startsAt") ?? "",
    replayDays: formData.get("replayDays") ?? "",
    inputType: formData.get("inputType") ?? "",
    inputUrl: formData.get("inputUrl") ?? "",
    status: formData.get("status") ?? "",
  });
}

function toData(v: z.infer<typeof eventSchema>) {
  return {
    title: v.title,
    slug: v.slug,
    description: v.description ?? null,
    coverUrl: v.coverUrl ?? null,
    priceSatang: Math.round(v.priceThb * 100),
    startsAt: v.startsAt,
    replayDays: v.replayDays,
    inputType: v.inputType,
    inputUrl: isPushInput(v.inputType) ? null : (v.inputUrl ?? null),
  };
}

function uniqueSlugError(err: unknown): EventFormState | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return { fieldErrors: { slug: ["slug นี้ถูกใช้แล้ว"] } };
  }
  return null;
}

export async function createEventAction(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  await requireEvents();
  const parsed = parseEventForm(formData);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: formValues(formData) };
  }

  let id: string;
  try {
    const event = await db.event.create({ data: { ...toData(parsed.data), status: parsed.data.status } });
    id = event.id;
  } catch (err) {
    const slugErr = uniqueSlugError(err);
    if (slugErr) return { ...slugErr, values: formValues(formData) };
    throw err;
  }
  revalidatePath("/");
  revalidatePath("/admin");
  redirect(`/admin/events/${id}`);
}

export async function updateEventAction(
  eventId: string,
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  await requireEvents();
  const parsed = parseEventForm(formData);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: formValues(formData) };
  }

  const current = await db.event.findUnique({ where: { id: eventId }, select: { status: true, slug: true } });
  if (!current) return { error: "ไม่พบรายการ" };

  // Status can only be toggled between DRAFT/SCHEDULED; LIVE/ENDED/ARCHIVED are driven by the media server.
  const editableStatus = current.status === "DRAFT" || current.status === "SCHEDULED";
  // Media inputs cannot change while live.
  const { inputType, inputUrl, ...rest } = toData(parsed.data);
  const data = current.status === "LIVE" ? rest : { ...rest, inputType, inputUrl };

  try {
    await db.event.update({
      where: { id: eventId },
      data: { ...data, ...(editableStatus ? { status: parsed.data.status } : {}) },
    });
  } catch (err) {
    const slugErr = uniqueSlugError(err);
    if (slugErr) return { ...slugErr, values: formValues(formData) };
    throw err;
  }
  revalidatePath("/");
  revalidatePath(`/events/${current.slug}`);
  revalidatePath(`/events/${parsed.data.slug}`);
  revalidatePath("/admin", "layout");
  redirect(`/admin/events/${eventId}`);
}

// ---------- Live control ----------

function msgParam(kind: "ok" | "error", text: string) {
  return `${kind}=${encodeURIComponent(text)}`;
}

export async function startLiveAction(eventId: string) {
  await requireEvents();
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) redirect("/admin");

  let target: string;
  if (event.status !== "SCHEDULED" && event.status !== "DRAFT" && event.status !== "LIVE") {
    target = `/admin/events/${eventId}?${msgParam("error", "เริ่มไลฟ์ได้เฉพาะรายการที่ยังไม่จบ")}`;
  } else {
    try {
      const res = await startEvent({
        eventId: event.id,
        contentId: event.contentId,
        inputType: event.inputType,
        streamKey: event.streamKey,
        ...(!isPushInput(event.inputType) && event.inputUrl ? { inputUrl: event.inputUrl } : {}),
      });
      if (res.ingestUrl) {
        await db.event.update({ where: { id: eventId }, data: { ingestUrl: res.ingestUrl } });
      }
      target = `/admin/events/${eventId}?${msgParam("ok", "ส่งคำสั่งเริ่มไลฟ์แล้ว รอสัญญาณจากเซิร์ฟเวอร์สื่อ")}`;
    } catch (err) {
      console.error("[admin] startEvent failed", err);
      target = `/admin/events/${eventId}?${msgParam("error", `เริ่มไลฟ์ไม่สำเร็จ: ${(err as Error).message}`)}`;
    }
  }
  revalidatePath(`/admin/events/${eventId}`);
  redirect(target);
}

export async function stopLiveAction(eventId: string) {
  await requireEvents();
  let target: string;
  try {
    await stopEvent(eventId);
    target = `/admin/events/${eventId}?${msgParam("ok", "ส่งคำสั่งหยุดไลฟ์แล้ว รอสัญญาณจบจากเซิร์ฟเวอร์สื่อ")}`;
  } catch (err) {
    console.error("[admin] stopEvent failed", err);
    target = `/admin/events/${eventId}?${msgParam("error", `หยุดไลฟ์ไม่สำเร็จ: ${(err as Error).message}`)}`;
  }
  revalidatePath(`/admin/events/${eventId}`);
  redirect(target);
}

export async function archiveReplayAction(eventId: string) {
  await requireEvents();
  const event = await db.event.findUnique({ where: { id: eventId }, select: { status: true, slug: true } });
  if (!event) redirect("/admin");

  let target: string;
  if (event.status === "LIVE") {
    target = `/admin/events/${eventId}?${msgParam("error", "กรุณาหยุดไลฟ์ก่อนลบวิดีโอย้อนหลัง")}`;
  } else {
    try {
      await deleteEventMedia(eventId);
      await db.event.update({ where: { id: eventId }, data: { status: "ARCHIVED", manifestUrl: null } });
      target = `/admin/events/${eventId}?${msgParam("ok", "ลบวิดีโอย้อนหลังแล้ว")}`;
    } catch (err) {
      console.error("[admin] deleteEventMedia failed", err);
      target = `/admin/events/${eventId}?${msgParam("error", `ลบวิดีโอไม่สำเร็จ: ${(err as Error).message}`)}`;
    }
  }
  revalidatePath("/");
  revalidatePath(`/events/${event.slug}`);
  revalidatePath("/admin", "layout");
  redirect(target);
}

// ---------- Tickets ----------

export async function setTicketRevokedAction(ticketId: string, revoked: boolean) {
  await requireEvents();
  const ticket = await db.ticket.update({ where: { id: ticketId }, data: { revoked } });
  if (revoked) {
    // Kick any active playback session immediately.
    await db.viewSession.deleteMany({ where: { userId: ticket.userId, eventId: ticket.eventId } });
  }
  revalidatePath(`/admin/events/${ticket.eventId}`);
}

// ---------- Viewers ----------

/**
 * Kick a viewer out of the player. With `revoke=on`, also revokes the ticket
 * (same as setTicketRevokedAction) so they cannot come back.
 */
export async function kickViewerAction(viewSessionId: string, formData: FormData) {
  await requirePermission("viewers");
  const session = await db.viewSession.findUnique({ where: { id: viewSessionId } });
  if (!session) {
    revalidatePath("/admin/viewers");
    return;
  }
  if (formData.get("revoke") === "on") {
    await db.ticket.updateMany({
      where: { userId: session.userId, eventId: session.eventId },
      data: { revoked: true },
    });
    await db.viewSession.deleteMany({ where: { userId: session.userId, eventId: session.eventId } });
    revalidatePath(`/admin/events/${session.eventId}`);
  } else {
    await db.viewSession.update({ where: { id: viewSessionId }, data: { deviceId: KICKED_DEVICE_ID } });
  }
  revalidatePath("/admin/viewers");
}

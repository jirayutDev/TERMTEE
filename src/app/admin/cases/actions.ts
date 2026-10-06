"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/roles";
import { CasePriority, CaseStatus } from "@/generated/prisma/enums";

const idSchema = z.string().min(1).max(64);

const updateSchema = z.object({
  status: z.enum(CaseStatus),
  priority: z.enum(CasePriority),
  assigneeId: z.string().max(64), // "" = unassigned
});

/** Change status / priority / assignee of a case. Assignee must be a staff user. */
export async function updateCaseAction(caseId: string, formData: FormData) {
  await requirePermission("cases", "/admin/cases");
  const id = idSchema.parse(caseId);
  const data = updateSchema.parse({
    status: formData.get("status"),
    priority: formData.get("priority"),
    assigneeId: formData.get("assigneeId") ?? "",
  });

  if (data.assigneeId) {
    const assignee = await db.user.findUnique({ where: { id: data.assigneeId }, select: { role: true } });
    if (!assignee || assignee.role === "VIEWER") throw new Error("ผู้รับผิดชอบต้องเป็นทีมงาน");
  }
  const current = await db.supportCase.findUnique({ where: { id }, select: { status: true, closedAt: true } });
  if (!current) throw new Error("ไม่พบเคส");
  const closing = data.status === "RESOLVED" || data.status === "CLOSED";

  await db.supportCase.update({
    where: { id },
    data: {
      status: data.status,
      priority: data.priority,
      assigneeId: data.assigneeId || null,
      closedAt: closing ? (current.closedAt ?? new Date()) : null,
    },
  });
  revalidatePath("/admin", "layout");
  revalidatePath(`/support/${id}`);
  revalidatePath("/support");
}

/** "รับเคสนี้" — assign the case to the current staff user. */
export async function assignToMeAction(caseId: string) {
  const user = await requirePermission("cases", "/admin/cases");
  const id = idSchema.parse(caseId);
  await db.supportCase.update({ where: { id }, data: { assigneeId: user.id } });
  revalidatePath("/admin", "layout");
}

// ---------- canned replies ----------

const cannedSchema = z.object({
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(2000),
});

export type CannedState = { error?: string; ok?: boolean };

function parseCanned(formData: FormData) {
  return cannedSchema.safeParse({ title: formData.get("title"), body: formData.get("body") });
}

export async function createCannedReplyAction(_prev: CannedState, formData: FormData): Promise<CannedState> {
  await requirePermission("cases", "/admin/cases/replies");
  const parsed = parseCanned(formData);
  if (!parsed.success) return { error: "กรุณาใส่ชื่อ (ไม่เกิน 60 ตัวอักษร) และข้อความ (ไม่เกิน 2,000 ตัวอักษร)" };
  await db.cannedReply.create({ data: parsed.data });
  revalidatePath("/admin/cases", "layout");
  return { ok: true };
}

export async function updateCannedReplyAction(id: string, _prev: CannedState, formData: FormData): Promise<CannedState> {
  await requirePermission("cases", "/admin/cases/replies");
  const parsed = parseCanned(formData);
  if (!parsed.success) return { error: "กรุณาใส่ชื่อ (ไม่เกิน 60 ตัวอักษร) และข้อความ (ไม่เกิน 2,000 ตัวอักษร)" };
  await db.cannedReply.update({ where: { id: idSchema.parse(id) }, data: parsed.data });
  revalidatePath("/admin/cases", "layout");
  return { ok: true };
}

export async function deleteCannedReplyAction(id: string) {
  await requirePermission("cases", "/admin/cases/replies");
  await db.cannedReply.deleteMany({ where: { id: idSchema.parse(id) } });
  revalidatePath("/admin/cases", "layout");
}

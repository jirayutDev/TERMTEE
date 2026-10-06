"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";

/** Customer closes their own case ("ปัญหาแก้แล้ว ปิดเคส"). Replying later reopens it. */
export async function closeCaseAction(caseId: string) {
  const id = z.string().min(1).max(64).parse(caseId);
  const user = await currentUser();
  if (!user?.id) throw new Error("Unauthorized");
  const res = await db.supportCase.updateMany({
    where: { id, userId: user.id, status: { not: "CLOSED" } },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  if (res.count > 0) {
    revalidatePath(`/support/${id}`);
    revalidatePath("/support");
    revalidatePath("/admin", "layout");
  }
}

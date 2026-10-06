"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/roles";
import { isSettingsSection, saveSettingsSection, type SettingsSection } from "@/lib/settings";

export type SettingsFormState = {
  savedAt?: number;
  error?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

/** Saves one settings section from its form. Bind the section: saveSettingsAction.bind(null, "shop"). */
export async function saveSettingsAction(
  section: SettingsSection,
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const user = await requirePermission("settings", "/admin/settings");
  if (!isSettingsSection(section)) return { error: "ไม่พบหมวดการตั้งค่านี้" };

  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$")) raw[k] = v;

  try {
    await saveSettingsSection(section, raw, user.id);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { error: "กรุณาตรวจสอบข้อมูลที่ไฮไลต์", fieldErrors: z.flattenError(err).fieldErrors };
    }
    console.error("[settings] save failed", section, err);
    return { error: "บันทึกไม่สำเร็จ กรุณาลองใหม่" };
  }

  // Settings show up across the site (pay page, footer policies, watch watermark…).
  revalidatePath("/", "layout");
  return { savedAt: Date.now() };
}

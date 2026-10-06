import "server-only";
import { notFound } from "next/navigation";
import { ForbiddenError, requirePermission } from "@/lib/roles";

/** Page guard: not signed in -> /login, signed in without "cases" -> 404. */
export async function requireCasesStaff(callbackUrl: string) {
  try {
    return await requirePermission("cases", callbackUrl);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }
}

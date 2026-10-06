"use server";

import { signIn, signOut } from "@/auth";
import { safeCallback } from "@/lib/safe-redirect";

/** Google sign-in; returns to the (same-site) `callbackUrl` form field. */
export async function signInWithGoogleAction(formData: FormData) {
  await signIn("google", { redirectTo: safeCallback(formData.get("callbackUrl")) });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

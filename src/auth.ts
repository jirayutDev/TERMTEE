import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/client";

declare module "next-auth" {
  interface Session {
    user: { id: string; email: string; name?: string | null; image?: string | null; role: Role };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "database" },
  providers: [Google],
  pages: { signIn: "/login" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      session.user.role = (user as unknown as { role: Role }).role;
      return session;
    },
  },
});

/** Returns the signed-in user or null. */
export async function currentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/**
 * True only for role ADMIN (unchanged meaning).
 * @deprecated Not used by the app anymore: use `can(user.role, permission)` / `requirePermission`
 * / `userWithPermission` from src/lib/roles.ts, or `isStaffRole` for "any staff".
 */
export async function isAdmin() {
  const user = await currentUser();
  return user?.role === "ADMIN";
}

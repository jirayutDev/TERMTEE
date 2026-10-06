import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate only: redirects to sign-in when no Auth.js session cookie is present.
 * The real authorization (role === ADMIN) is enforced server-side in src/app/admin/layout.tsx
 * and in every admin Server Action.
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};

/** Only allow same-site relative paths as post-login / back destinations. */
export function safeCallback(raw: unknown, fallback = "/"): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) {
    return fallback;
  }
  return v;
}

/** /login URL that returns to `path` after signing in. */
export function loginUrl(path: string): string {
  return `/login?callbackUrl=${encodeURIComponent(path)}`;
}

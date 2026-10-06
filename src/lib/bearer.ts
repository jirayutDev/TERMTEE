import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of an `Authorization: Bearer <token>` header against a secret.
 * Both sides are hashed first so lengths always match.
 */
export function verifyBearer(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  const a = createHash("sha256").update(match[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

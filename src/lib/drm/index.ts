// Server-only: reads DRM secrets from env. Never import from client code.
import { PallyConProvider } from "./pallycon";
import type { DrmProvider } from "./types";

export type { DrmProvider, DrmSystem, DrmTokenRequest } from "./types";

let provider: DrmProvider | null = null;

/**
 * Returns the active DRM provider (PallyCon), built lazily from env so that
 * builds without DRM secrets don't crash at import time.
 * Env: PALLYCON_SITE_ID, PALLYCON_SITE_KEY, PALLYCON_ACCESS_KEY
 * Optional: PALLYCON_LICENSE_URL, PALLYCON_FAIRPLAY_CERT_URL
 */
export function getDrmProvider(): DrmProvider {
  if (provider) return provider;
  const siteId = process.env.PALLYCON_SITE_ID;
  const siteKey = process.env.PALLYCON_SITE_KEY;
  const accessKey = process.env.PALLYCON_ACCESS_KEY;
  if (!siteId || !siteKey || !accessKey) {
    throw new Error("DRM not configured: set PALLYCON_SITE_ID, PALLYCON_SITE_KEY, PALLYCON_ACCESS_KEY");
  }
  provider = new PallyConProvider({
    siteId,
    siteKey,
    accessKey,
    ...(process.env.PALLYCON_LICENSE_URL && { licenseUrl: process.env.PALLYCON_LICENSE_URL }),
    ...(process.env.PALLYCON_FAIRPLAY_CERT_URL && {
      fairplayCertUrl: process.env.PALLYCON_FAIRPLAY_CERT_URL,
    }),
  });
  return provider;
}

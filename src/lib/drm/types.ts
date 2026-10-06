/**
 * DRM provider abstraction. PallyCon is the first implementation; EZDRM can be
 * swapped in by implementing the same interface.
 */

export type DrmSystem = "Widevine" | "PlayReady" | "FairPlay";

export interface DrmTokenRequest {
  userId: string;
  contentId: string;
  drmSystem: DrmSystem;
}

export interface DrmProvider {
  /** License server URL the player sends challenges to. */
  licenseUrl(drmSystem: DrmSystem): string;
  /** FairPlay certificate URL (Safari only). */
  fairplayCertUrl(): string;
  /** Short-lived, server-signed token enforcing hardware-only security policy. */
  createToken(req: DrmTokenRequest): string;
}

// Server-only module (uses secrets + node:crypto). Never import from client code.
import { createCipheriv, createHash } from "node:crypto";
import type { DrmProvider, DrmSystem, DrmTokenRequest } from "./types";

/**
 * PallyCon (now "DoveRunner Multi-DRM") license token v2 implementation.
 *
 * !!! VERIFY BEFORE PRODUCTION !!!
 * Every field name and enum value below (token keys, policy_version 2 layout,
 * security_policy / widevine / playready / fairplay sub-objects, HDCP enum
 * strings, license URLs, fixed IV) was written from the PallyCon token v2
 * documentation as we know it. PallyCon was rebranded to DoveRunner and the
 * docs moved; re-check against the current "License Token Guide" and
 * "Security Policy" pages and test with their token tester before going live.
 * A wrong/unknown field is usually ignored silently by the license server,
 * which would weaken protection without any visible error.
 *
 * Security intent (must hold after any change):
 *  - Hardware-backed DRM only: Widevine L1 (HW_SECURE_ALL), PlayReady SL3000,
 *    FairPlay (always hardware/secure-path on Apple devices).
 *  - HDCP required on every output; content is NOT delivered at a lower
 *    resolution when HDCP fails (security_policy applies to track_type ALL,
 *    so there is no lower-quality "fallback" track the player could use).
 *  - Non-persistent (streaming) licenses only, short duration.
 */

const DEFAULT_LICENSE_URL = "https://license-global.pallycon.com/ri/licenseManager.do";
const DEFAULT_FAIRPLAY_CERT_URL = "https://license-global.pallycon.com/ri/fpsKeyManager.do";

/** PallyCon uses a fixed IV for policy encryption (per token v2 docs — verify). */
const POLICY_IV = Buffer.from("0123456789abcdef", "utf8");

/**
 * License lifetime in seconds. Kept short; playback rights are additionally
 * enforced by the heartbeat/session lock and a fresh token per license request.
 * NOTE: a non-persistent license that expires mid-stream stops playback unless
 * the player re-requests a license — long live events may need renewal support.
 */
// No license renewal yet, so this must outlast the longest live event (license is in-memory only).
const LICENSE_DURATION_SEC = 12 * 60 * 60;

/**
 * HDCP level. HDCP 1.x is trivially stripped by cheap capture devices, so we
 * require 2.2 (Type 1). This blocks some older monitors/TVs — that is a
 * deliberate trade-off: no output instead of a degraded or capturable one.
 */
const WIDEVINE_HDCP = "HDCP_V2_2";

export interface PallyConConfig {
  siteId: string;
  siteKey: string; // 32-char site key (AES-256 key)
  accessKey: string;
  licenseUrl?: string;
  fairplayCertUrl?: string;
}

function buildPolicy() {
  return {
    policy_version: 2,
    playback_policy: {
      persistent: false, // streaming license only, never stored offline
      license_duration: LICENSE_DURATION_SEC,
      allowed_track_types: "ALL",
    },
    security_policy: [
      {
        track_type: "ALL",
        widevine: {
          security_level: 5, // HW_SECURE_ALL (L1, decode + output in TEE)
          required_hdcp_version: WIDEVINE_HDCP,
          required_cgms_flags: "CGMS_NONE",
          disable_analog_output: true,
          hdcp_srm_rule: "HDCP_SRM_RULE_NONE",
        },
        playready: {
          security_level: 3000, // SL3000 = hardware DRM
          digital_video_protection_level: 300, // HDCP must be engaged or no output
          analog_video_protection_level: 201, // block analog output
          digital_audio_protection_level: 300,
          require_hdcp_type_1: true, // HDCP 2.2 Type 1
        },
        fairplay: {
          hdcp_enforcement: 1, // -1 none, 0 HDCP Type 0, 1 HDCP Type 1 (verify)
          allow_airplay: false,
          allow_av_adapter: false,
        },
      },
    ],
  };
}

/** "yyyy-MM-ddTHH:mm:ssZ" in UTC, as required by token v2. */
function timestamp(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export class PallyConProvider implements DrmProvider {
  private readonly cfg: Required<PallyConConfig>;

  constructor(cfg: PallyConConfig) {
    if (Buffer.byteLength(cfg.siteKey, "utf8") !== 32) {
      throw new Error("PALLYCON_SITE_KEY must be 32 bytes (AES-256 key)");
    }
    this.cfg = {
      licenseUrl: DEFAULT_LICENSE_URL,
      fairplayCertUrl: DEFAULT_FAIRPLAY_CERT_URL,
      ...cfg,
    };
  }

  licenseUrl(drmSystem: DrmSystem): string {
    void drmSystem; // single endpoint for all DRM systems
    return this.cfg.licenseUrl;
  }

  fairplayCertUrl(): string {
    return `${this.cfg.fairplayCertUrl}?siteId=${encodeURIComponent(this.cfg.siteId)}`;
  }

  private encryptPolicy(policy: object): string {
    const cipher = createCipheriv("aes-256-cbc", Buffer.from(this.cfg.siteKey, "utf8"), POLICY_IV);
    return Buffer.concat([cipher.update(JSON.stringify(policy), "utf8"), cipher.final()]).toString(
      "base64",
    );
  }

  createToken({ userId, contentId, drmSystem }: DrmTokenRequest): string {
    const { siteId, accessKey } = this.cfg;
    const policy = this.encryptPolicy(buildPolicy());
    const ts = timestamp();
    const hash = createHash("sha256")
      .update(accessKey + drmSystem + siteId + userId + contentId + policy + ts, "utf8")
      .digest("base64");

    const token = {
      drm_type: drmSystem, // "Widevine" | "PlayReady" | "FairPlay"
      site_id: siteId,
      user_id: userId,
      cid: contentId,
      policy,
      timestamp: ts,
      hash,
    };
    return Buffer.from(JSON.stringify(token), "utf8").toString("base64");
  }
}

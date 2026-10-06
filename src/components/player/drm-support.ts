"use client";

import type { DrmSystem } from "@/lib/drm/types";

export interface DrmSupport {
  system: DrmSystem;
  /** EME key system string to use with the player. */
  keySystem: string;
}

const VIDEO = 'video/mp4; codecs="avc1.640028"'; // H.264 High@4.0 (1080p)
const AUDIO = 'audio/mp4; codecs="mp4a.40.2"'; // AAC-LC

interface Probe {
  support: DrmSupport;
  config: MediaKeySystemConfiguration[];
}

/** Probe order matters: FairPlay -> PlayReady SL3000 -> Widevine L1. */
const PROBES: Probe[] = [
  {
    support: { system: "FairPlay", keySystem: "com.apple.fps" },
    config: [
      {
        initDataTypes: ["sinf", "skd"],
        videoCapabilities: [{ contentType: VIDEO }],
        audioCapabilities: [{ contentType: AUDIO }],
      },
    ],
  },
  {
    // The ".3000" key system only resolves when hardware (SL3000) DRM is available.
    support: { system: "PlayReady", keySystem: "com.microsoft.playready.recommendation.3000" },
    config: [
      {
        initDataTypes: ["cenc"],
        videoCapabilities: [{ contentType: VIDEO }],
        audioCapabilities: [{ contentType: AUDIO }],
      },
    ],
  },
  {
    support: { system: "Widevine", keySystem: "com.widevine.alpha" },
    config: [
      {
        initDataTypes: ["cenc"],
        videoCapabilities: [{ contentType: VIDEO, robustness: "HW_SECURE_ALL" }],
        audioCapabilities: [{ contentType: AUDIO, robustness: "SW_SECURE_CRYPTO" }],
      },
    ],
  },
];

let cached: Promise<DrmSupport | null> | null = null;

async function probe(p: Probe): Promise<boolean> {
  try {
    const access = await navigator.requestMediaKeySystemAccess(p.support.keySystem, p.config);
    // Widevine: make sure the browser did not silently drop the robustness.
    if (p.support.system === "Widevine") {
      const caps = access.getConfiguration().videoCapabilities ?? [];
      return caps.some((c) => c.robustness === "HW_SECURE_ALL");
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects the first hardware-backed DRM system this browser supports, or null
 * if none (playback is not allowed on software-only DRM).
 */
export function detectDrmSupport(): Promise<DrmSupport | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!cached) {
    cached = (async () => {
      if (!navigator.requestMediaKeySystemAccess) return null;
      for (const p of PROBES) {
        if (await probe(p)) return p.support;
      }
      return null;
    })();
  }
  return cached;
}

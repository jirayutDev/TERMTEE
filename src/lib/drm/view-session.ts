/** Shared playback-session (single active device) constants and helpers. */

export const HEARTBEAT_INTERVAL_SEC = 30;
export const SESSION_STALE_SEC = 90;

export function isSessionFresh(lastSeenAt: Date, now = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() <= SESSION_STALE_SEC * 1000;
}

/** deviceId is a random per-browser id generated client side. */
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

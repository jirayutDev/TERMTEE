/**
 * Contract between the Next.js app and the media server (media/ folder).
 *
 * Next.js -> media server: POST {MEDIA_CONTROL_URL}/events/:eventId/{start|stop}
 *                          DELETE {MEDIA_CONTROL_URL}/events/:eventId (remove replay media; 404 = already gone)
 *   header: Authorization: Bearer {MEDIA_CONTROL_SECRET}
 * Media server -> Next.js: POST {APP_URL}/api/media/callback
 *   header: Authorization: Bearer {MEDIA_CONTROL_SECRET}
 *   body: MediaCallback
 */

/** Push: SRT, RTMP. Pull: HLS, DASH, RTSP. BROWSER: Chromium captures inputUrl (re-encoded). */
export type InputType = "SRT" | "RTMP" | "HLS" | "DASH" | "RTSP" | "BROWSER";

export const PUSH_INPUT_TYPES: readonly InputType[] = ["SRT", "RTMP"];

export function isPushInput(t: InputType): boolean {
  return PUSH_INPUT_TYPES.includes(t);
}

/** Accepted inputUrl schemes per type; null = push input, no URL (media server re-checks). */
export const INPUT_URL_SCHEME: Record<InputType, RegExp | null> = {
  SRT: null,
  RTMP: null,
  HLS: /^https?:\/\//i,
  DASH: /^https?:\/\//i,
  RTSP: /^rtsps?:\/\//i,
  BROWSER: /^https?:\/\//i,
};

export interface StartEventRequest {
  eventId: string;
  contentId: string; // DRM cid, used to fetch keys via CPIX
  inputType: InputType;
  streamKey: string; // SRT streamid / RTMP stream key
  inputUrl?: string; // required for every non-push input type
}

export interface StartEventResponse {
  ingestUrl?: string; // where the source should push (SRT/RTMP)
}

export type MediaCallback =
  | { type: "live.started"; eventId: string; manifestUrl: string }
  | { type: "live.ended"; eventId: string; manifestUrl: string } // manifest now VOD (replay)
  | { type: "live.error"; eventId: string; message: string };

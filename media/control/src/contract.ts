/**
 * Mirror of src/lib/media/types.ts (the app <-> media server contract).
 * Keep in sync by hand; the media service is built standalone so it cannot import from the app.
 */

/** Push: SRT, RTMP. Pull: HLS, DASH, RTSP. BROWSER: Chromium captures inputUrl (re-encoded). */
export type InputType = "SRT" | "RTMP" | "HLS" | "DASH" | "RTSP" | "BROWSER";

export const PUSH_INPUT_TYPES: readonly InputType[] = ["SRT", "RTMP"];

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

import path from "node:path";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing env ${name}`);
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

export type TranscodeMode = "auto" | "always" | "never";

export const config = {
  port: Number(env("PORT", "8080")),
  secret: env("MEDIA_CONTROL_SECRET"),
  appUrl: env("APP_URL").replace(/\/$/, ""),
  cdnBaseUrl: env("CDN_BASE_URL").replace(/\/$/, ""),

  // Encrypted segments + manifests, one folder per event (served by nginx).
  outputDir: path.resolve(env("OUTPUT_DIR", "/data/output")),
  // Scratch space (FIFOs), never served.
  workDir: path.resolve(env("WORK_DIR", "/data/work")),

  // MediaMTX: auth hook token + internal read credentials used by ffmpeg.
  mediamtxHookToken: env("MEDIAMTX_HOOK_TOKEN"),
  mediamtxRtspUrl: env("MEDIAMTX_RTSP_URL", "rtsp://mediamtx:8554").replace(/\/$/, ""),
  mediamtxReadUser: env("MEDIAMTX_READ_USER", "packager"),
  mediamtxReadPass: env("MEDIAMTX_READ_PASS"),

  // Public ingest endpoints returned to the app as ingestUrl.
  ingestHost: env("INGEST_PUBLIC_HOST", "localhost"),
  srtPort: Number(env("SRT_PUBLIC_PORT", "8890")),
  rtmpPort: Number(env("RTMP_PUBLIC_PORT", "1935")),

  // Packaging
  segmentSeconds: Number(env("SEGMENT_SECONDS", "2")),
  transcode: env("TRANSCODE", "auto") as TranscodeMode,
  ffmpegBin: env("FFMPEG_BIN", "ffmpeg"),
  ffprobeBin: env("FFPROBE_BIN", "ffprobe"),
  packagerBin: env("PACKAGER_BIN", "packager"),

  // DRM keys (PallyCon KMS via CPIX). DRM_DEV_KEY_* is for local testing only.
  pallyconKmsUrl: env("PALLYCON_KMS_URL", "https://kms.pallycon.com/v2/cpix/pallycon/getKey"),
  pallyconKmsToken: optional("PALLYCON_KMS_TOKEN"),
  devKeyId: optional("DRM_DEV_KEY_ID"),
  devKey: optional("DRM_DEV_KEY"),

  // BROWSER input: the capture service (src/capture.ts, own container). Unset token = BROWSER disabled.
  captureUrl: env("CAPTURE_URL", "http://capture:8090").replace(/\/$/, ""),
  captureToken: optional("CAPTURE_TOKEN"),
  // Seconds of the start of a BROWSER capture checked for an all-black picture (0 = off).
  blackCheckSeconds: Number(env("BROWSER_BLACK_CHECK_SECONDS", "30")),
};

if (!["auto", "always", "never"].includes(config.transcode)) {
  throw new Error("TRANSCODE must be auto | always | never");
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Event ids / stream keys end up in paths and URLs: only allow a safe charset. */
export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}

export function eventOutputDir(eventId: string): string {
  if (!isSafeId(eventId)) throw new Error(`Unsafe eventId: ${eventId}`);
  return path.join(config.outputDir, eventId);
}

export function manifestUrl(eventId: string): string {
  return `${config.cdnBaseUrl}/${eventId}/manifest.mpd`;
}

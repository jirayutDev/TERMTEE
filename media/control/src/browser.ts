/**
 * Client for the capture service (src/capture.ts) that runs BROWSER inputs:
 * Chromium renders inputUrl, ffmpeg encodes the screen + audio, and the control service pulls the
 * resulting MPEG-TS from GET /sessions/<eventId>/stream like any other pull input.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { config } from "./config.js";

export interface CaptureStatus {
  state: "starting" | "running" | "failed";
  error?: string;
}

function token(): string {
  if (!config.captureToken) throw new Error("BROWSER input is not configured (CAPTURE_TOKEN unset)");
  return config.captureToken;
}

async function call(method: string, p: string, body?: unknown): Promise<Response> {
  return fetch(`${config.captureUrl}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
}

/** Start (or keep) the capture session for an event. Idempotent; replaces a failed session. */
export async function startCapture(eventId: string, url: string): Promise<void> {
  const res = await call("POST", `/sessions/${eventId}`, { url });
  if (!res.ok) {
    const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(`capture: ${msg}`);
  }
}

/** undefined = no such session (capture restarted or idle-reaped it). Throws on network errors. */
export async function captureStatus(eventId: string): Promise<CaptureStatus | undefined> {
  const res = await call("GET", `/sessions/${eventId}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`capture status HTTP ${res.status}`);
  return (await res.json()) as CaptureStatus;
}

/** Best effort: kill Chromium/Xvfb/PulseAudio/ffmpeg of one session (or all, on boot). */
export async function stopCapture(eventId?: string): Promise<void> {
  if (!config.captureToken) return;
  try {
    await call("DELETE", eventId ? `/sessions/${eventId}` : "/sessions");
  } catch (err) {
    console.warn(`[capture] stop ${eventId ?? "all"} failed: ${(err as Error).message}`);
  }
}

/** URL + ffmpeg/ffprobe input args for the session's live MPEG-TS. */
export function captureSource(eventId: string): { url: string; inputArgs: string[] } {
  return {
    url: `${config.captureUrl}/sessions/${eventId}/stream`,
    inputArgs: ["-headers", `Authorization: Bearer ${token()}\r\n`, "-f", "mpegts"],
  };
}

/**
 * Decode the first `seconds` of the capture and report how long the picture was black.
 * A DRM-protected (EME) player renders black in a CDM-less Chromium, so a fully black start is the
 * typical symptom. Resolves with the longest black stretch in seconds (0 if none).
 */
export function detectBlack(eventId: string, seconds: number, onSpawn: (p: ChildProcess) => void): Promise<number> {
  const { url, inputArgs } = captureSource(eventId);
  const args = [
    "-hide_banner", "-nostats", "-loglevel", "info", "-nostdin",
    ...inputArgs, "-i", url,
    "-t", String(seconds), "-map", "0:v:0", "-an",
    "-vf", "scale=480:-2,blackdetect=d=1:pix_th=0.10:pic_th=0.98",
    "-f", "null", "-",
  ];
  const ff = spawn(config.ffmpegBin, args, { stdio: ["ignore", "ignore", "pipe"] });
  onSpawn(ff);
  let longest = 0;
  ff.stderr!.setEncoding("utf8");
  ff.stderr!.on("data", (s: string) => {
    for (const m of s.matchAll(/black_duration:\s*([\d.]+)/g)) longest = Math.max(longest, Number(m[1]));
  });
  return new Promise((resolve) => ff.on("exit", () => resolve(longest)));
}

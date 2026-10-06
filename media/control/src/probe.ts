import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const run = promisify(execFile);

export interface SourceInfo {
  videoCodec?: string;
  audioCodec?: string;
  height?: number;
  videoIndex?: number; // highest-resolution video stream (HLS masters / DASH MPDs expose every variant)
}

export async function probe(url: string, inputArgs: string[]): Promise<SourceInfo> {
  const { stdout } = await run(
    config.ffprobeBin,
    [...inputArgs, "-v", "error", "-show_entries", "stream=index,codec_type,codec_name,height", "-of", "json", url],
    { timeout: 20_000 },
  );
  const streams = (JSON.parse(stdout).streams ?? []) as { index: number; codec_type: string; codec_name: string; height?: number }[];
  const v = streams
    .filter((s) => s.codec_type === "video")
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
  const a = streams.find((s) => s.codec_type === "audio");
  return { videoCodec: v?.codec_name, audioCodec: a?.codec_name, height: v?.height, videoIndex: v?.index };
}

/**
 * Codec args for ffmpeg. Passthrough (no quality change) when the source is H.264/AAC.
 * Only a non-H.264 video source is re-encoded, to H.264 at native resolution capped at 1080p.
 * Audio that is not AAC is re-encoded to AAC (video untouched).
 * `encoded`: the source was already encoded for us (BROWSER capture), so TRANSCODE=always does not
 * encode it a second time.
 */
export function codecArgs(info: SourceInfo, encoded = false): { args: string[]; summary: string } {
  const gop = config.segmentSeconds;
  const transcodeVideo =
    (config.transcode === "always" && !encoded) || (config.transcode !== "never" && info.videoCodec !== "h264");
  if (config.transcode === "never" && info.videoCodec !== "h264") {
    throw new Error(`Source video codec ${info.videoCodec ?? "none"} is not packageable and TRANSCODE=never`);
  }

  const video = transcodeVideo
    ? [
        "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high",
        "-crf", "18", "-maxrate", "12M", "-bufsize", "24M",
        "-vf", "scale=-2:'min(1080,ih)'", "-pix_fmt", "yuv420p",
        "-force_key_frames", `expr:gte(t,n_forced*${gop})`, "-sc_threshold", "0",
      ]
    : ["-c:v", "copy"];

  const audio = !info.audioCodec
    ? []
    : info.audioCodec === "aac"
      ? ["-c:a", "copy"]
      : ["-c:a", "aac", "-b:a", "256k", "-ar", "48000"];

  const summary = `video ${info.videoCodec}${transcodeVideo ? " -> h264 (transcode)" : " (copy)"}, ` +
    `audio ${info.audioCodec ?? "none"}${info.audioCodec && info.audioCodec !== "aac" ? " -> aac" : ""}`;
  return { args: [...video, ...audio], summary };
}

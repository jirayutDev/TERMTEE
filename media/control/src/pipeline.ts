/**
 * One EventJob per live event:
 *
 *   source --(SRT/RTMP)--> MediaMTX --(RTSP)--> ffmpeg --stdout--> [relay] --FIFO--> Shaka Packager --> OUTPUT_DIR/<eventId>
 *   source --(HLS / DASH / RTSP pull)---------> ffmpeg ...
 *   web page --> capture (Chromium + ffmpeg) --(MPEG-TS over HTTP pull)--> ffmpeg ...   [BROWSER]
 *
 * The packager runs once for the whole event and holds the FIFO open through this process, so the
 * ffmpeg leg can die and restart (publisher reconnect, pull hiccup) without restarting packaging:
 * segment numbering continues and the replay stays one continuous timeline (with a gap).
 */
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rm, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config, eventOutputDir, manifestUrl } from "./config.js";
import { PUSH_INPUT_TYPES, type StartEventRequest } from "./contract.js";
import { captureSource, captureStatus, detectBlack, startCapture, stopCapture } from "./browser.js";
import { sendCallback } from "./callback.js";
import { getContentKey, type ContentKey } from "./kms.js";
import { finalizeManifests } from "./manifest.js";
import { codecArgs, probe, type SourceInfo } from "./probe.js";

const execFileP = promisify(execFile);
const TS_PACKET = 188;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type JobState = "waiting" | "live" | "stopping" | "done";

export class EventJob {
  readonly eventId: string;
  readonly dir: string;
  readonly fifoPath: string;
  state: JobState = "waiting";

  private key?: ContentKey;
  private source?: SourceInfo;
  private codec?: string[];
  private packager?: ChildProcess;
  private ffmpeg?: ChildProcess;
  private blackCheck?: ChildProcess;
  private fifo?: WriteStream;
  private packagerStartedAt = 0;
  private ingestLoop?: Promise<void>;
  private retrigger = false;
  private finished?: Promise<void>;

  constructor(readonly req: StartEventRequest) {
    this.eventId = req.eventId;
    this.dir = eventOutputDir(req.eventId);
    this.fifoPath = path.join(config.workDir, `${req.eventId}.ts`);
  }

  /** Fetch DRM key and prepare the output folder. Throws on failure (start request fails). */
  async init(): Promise<void> {
    const existing = await readFile(path.join(this.dir, "manifest.mpd"), "utf8").catch(() => undefined);
    if (existing && /type="static"/.test(existing)) {
      throw new HttpError(409, "Event already has a finalized replay; DELETE it first to restart");
    }
    this.key = await getContentKey(this.req.contentId);
    // BROWSER: start Chromium now, so a capture error (capacity, bad URL) fails the start request.
    if (this.req.inputType === "BROWSER") await startCapture(this.eventId, this.req.inputUrl!);
    await rm(this.dir, { recursive: true, force: true });
    await mkdir(path.join(this.dir, "video"), { recursive: true });
    await mkdir(path.join(this.dir, "audio"), { recursive: true });
    await mkdir(path.join(this.dir, ".tmp"), { recursive: true });
    await mkdir(config.workDir, { recursive: true });
  }

  private get isPull(): boolean {
    return !PUSH_INPUT_TYPES.includes(this.req.inputType);
  }

  /** URL ffmpeg reads from. */
  private sourceUrl(): { url: string; inputArgs: string[] } {
    const { inputType, streamKey, inputUrl } = this.req;
    if (inputType === "HLS" || inputType === "DASH") return { url: inputUrl!, inputArgs: [] };
    if (inputType === "RTSP") return { url: inputUrl!, inputArgs: ["-rtsp_transport", "tcp"] };
    if (inputType === "BROWSER") return captureSource(this.eventId);
    const auth = `${encodeURIComponent(config.mediamtxReadUser)}:${encodeURIComponent(config.mediamtxReadPass)}`;
    const base = config.mediamtxRtspUrl.replace("rtsp://", `rtsp://${auth}@`);
    const p = inputType === "SRT" ? streamKey : `live/${streamKey}`;
    return { url: `${base}/${p}`, inputArgs: ["-rtsp_transport", "tcp"] };
  }

  /** Called when MediaMTX authorizes a publish (SRT/RTMP) or right after start (pull types). */
  triggerIngest(): void {
    if (!this.key || !this.isActive()) return;
    if (this.ingestLoop) {
      this.retrigger = true; // loop may be about to give up; run again once it does
      return;
    }
    this.retrigger = false;
    this.ingestLoop = this.ingest()
      .catch((err) => this.fail(`ingest: ${(err as Error).message}`))
      .finally(() => {
        this.ingestLoop = undefined;
        if (this.retrigger && !this.ffmpeg) this.triggerIngest();
      });
  }

  private async ingest(): Promise<void> {
    const { url, inputArgs } = this.sourceUrl();
    const type = this.req.inputType;
    const isPull = this.isPull;
    let failures = 0;

    while (this.state === "waiting" || this.state === "live") {
      if (type === "BROWSER") await this.ensureCapture();
      // Probe until the source is readable (publisher may still be handshaking).
      let info: SourceInfo | undefined;
      for (let i = 0; i < 15 && !info && this.isActive(); i++) {
        info = await probe(url, inputArgs).catch(() => undefined);
        if (!info?.videoCodec) info = undefined;
        if (!info) await sleep(1000);
      }
      if (!this.isActive()) return;
      if (!info) {
        if (isPull && ++failures < 10) continue;
        if (isPull) throw new Error(`${type} source unreachable`);
        console.log(`[${this.eventId}] no source, waiting for publisher`);
        return; // SRT/RTMP: next publish hook restarts the loop
      }
      failures = 0;

      if (!this.packager) {
        const c = codecArgs(info, type === "BROWSER");
        this.source = info;
        this.codec = c.args;
        console.log(`[${this.eventId}] source: ${c.summary}`);
        await this.startPackager();
        if (type === "BROWSER") void this.checkBlack();
      }

      const code = await this.runFfmpeg(url, inputArgs);
      if (!this.isActive()) return;

      // HLS/DASH: a clean exit means the source playlist/MPD ended. RTSP/BROWSER: reconnect.
      if ((type === "HLS" || type === "DASH") && code === 0) {
        console.log(`[${this.eventId}] ${type} source ended`);
        void this.stop();
        return;
      }
      if (!isPull && code === 0) {
        console.log(`[${this.eventId}] publisher disconnected, waiting for reconnect`);
        return;
      }
      console.warn(`[${this.eventId}] ffmpeg exited ${code}, retrying`);
      await sleep(3000);
    }
  }

  /**
   * BROWSER: make sure the capture session exists. Recreates it when the capture service lost it
   * (restart / idle reap); a session that failed (Chromium kept crashing, ...) fails the event.
   */
  private async ensureCapture(): Promise<void> {
    let status;
    try {
      status = await captureStatus(this.eventId);
      if (!status) {
        console.warn(`[${this.eventId}] capture session missing, restarting it`);
        await startCapture(this.eventId, this.req.inputUrl!);
        return;
      }
    } catch (err) {
      console.warn(`[${this.eventId}] capture unreachable: ${(err as Error).message}`);
      return; // transient: the probe fails and the pull retry budget applies
    }
    if (status.state === "failed") throw new Error(`browser capture failed: ${status.error ?? "unknown error"}`);
  }

  /** BROWSER: warn the app when the first seconds of the capture are black (typically a DRM player). */
  private async checkBlack(): Promise<void> {
    const seconds = config.blackCheckSeconds;
    if (!(seconds > 0)) return;
    const black = await detectBlack(this.eventId, seconds, (p) => (this.blackCheck = p));
    this.blackCheck = undefined;
    if (!this.isActive() || black < seconds * 0.8) return;
    const host = new URL(this.req.inputUrl!).host;
    const message =
      `Browser capture of ${host} was black for ${Math.round(black)}s of the first ${seconds}s. ` +
      "DRM-protected video (Widevine/PlayReady/FairPlay players) cannot be captured and shows black; " +
      "pages that need a login or a click to start playback show nothing useful either. The live keeps running: stop it if this is not expected.";
    console.warn(`[${this.eventId}] ${message}`);
    await sendCallback({ type: "live.error", eventId: this.eventId, message });
  }

  private isActive(): boolean {
    return this.state === "waiting" || this.state === "live";
  }

  private async startPackager(): Promise<void> {
    const key = this.key!;
    await rm(this.fifoPath, { force: true });
    await execFileP("mkfifo", [this.fifoPath]);

    const seg = String(config.segmentSeconds);
    const descriptors = [
      `in=${this.fifoPath},stream=video,init_segment=video/init.mp4,segment_template=video/$Number$.m4s,drm_label=CENC,playlist_name=video.m3u8`,
    ];
    if (this.source?.audioCodec) {
      descriptors.push(
        `in=${this.fifoPath},stream=audio,init_segment=audio/init.mp4,segment_template=audio/$Number$.m4s,drm_label=CENC,playlist_name=audio.m3u8,hls_group_id=audio,hls_name=main`,
      );
    }
    let keys = `label=CENC:key_id=${key.keyIdHex}:key=${key.keyHex}`;
    if (key.ivHex) keys += `:iv=${key.ivHex}`;

    const args = [
      ...descriptors,
      "--segment_duration", seg,
      "--enable_raw_key_encryption",
      "--keys", keys,
      "--protection_scheme", "cbcs",
      "--protection_systems", "Widevine,PlayReady,FairPlay",
      "--clear_lead", "0",
      "--hls_key_uri", key.fairplayKeyUri,
      "--mpd_output", "manifest.mpd",
      "--hls_master_playlist_output", "manifest.m3u8",
      "--hls_playlist_type", "EVENT",
      // Keep every segment in the live window: the full live is also the replay.
      "--time_shift_buffer_depth", String(48 * 3600),
      "--allow_approximate_segment_timeline",
    ];

    this.packagerStartedAt = Date.now();
    // Manifests are written to a temp file (in TMPDIR) then renamed: keep it on the same filesystem.
    const pk = spawn(config.packagerBin, args, {
      cwd: this.dir,
      env: { ...process.env, TMPDIR: path.join(this.dir, ".tmp") },
      stdio: ["ignore", "inherit", "pipe"],
    });
    this.packager = pk;
    pipeLog(pk, `${this.eventId}/packager`);

    // Opening the FIFO for writing blocks until the packager opens it for reading.
    this.fifo = createWriteStream(this.fifoPath);
    this.fifo.on("error", (err) => console.warn(`[${this.eventId}] fifo: ${err.message}`));

    this.finished = new Promise<void>((resolve) => {
      pk.on("exit", (code, signal) => {
        console.log(`[${this.eventId}] packager exited code=${code} signal=${signal}`);
        this.packager = undefined;
        resolve();
        if (this.isActive()) void this.fail(`packager exited unexpectedly (code ${code})`);
      });
    });

    void this.watchFirstManifest();
  }

  private async watchFirstManifest(): Promise<void> {
    const mpd = path.join(this.dir, "manifest.mpd");
    while (this.state === "waiting") {
      if (await stat(mpd).then(() => true, () => false)) {
        this.state = "live";
        await sendCallback({ type: "live.started", eventId: this.eventId, manifestUrl: manifestUrl(this.eventId) });
        return;
      }
      await sleep(1000);
    }
  }

  /** Run one ffmpeg leg into the FIFO; resolves with the exit code. */
  private runFfmpeg(url: string, inputArgs: string[]): Promise<number> {
    // Shift restarted legs onto the wall-clock timeline so packager timestamps stay monotonic.
    const offset = this.packagerStartedAt ? (Date.now() - this.packagerStartedAt) / 1000 : 0;
    const args = [
      "-hide_banner", "-loglevel", "warning", "-nostdin",
      ...inputArgs, "-i", url,
      "-map", this.source?.videoIndex !== undefined ? `0:${this.source.videoIndex}` : "0:v:0", "-map", "0:a:0?",
      ...this.codec!,
      "-output_ts_offset", offset.toFixed(3),
      "-f", "mpegts", "pipe:1",
    ];
    const ff = spawn(config.ffmpegBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.ffmpeg = ff;
    pipeLog(ff, `${this.eventId}/ffmpeg`);

    // Relay whole TS packets only, so a killed leg never leaves a torn packet in the stream.
    let carry: Buffer = Buffer.alloc(0);
    ff.stdout!.on("data", (chunk: Buffer) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const whole = buf.length - (buf.length % TS_PACKET);
      carry = buf.subarray(whole);
      if (whole && this.fifo && !this.fifo.writableEnded) {
        if (!this.fifo.write(buf.subarray(0, whole))) {
          ff.stdout!.pause();
          this.fifo.once("drain", () => ff.stdout!.resume());
        }
      }
    });

    return new Promise((resolve) => {
      ff.on("exit", (code, signal) => {
        this.ffmpeg = undefined;
        resolve(code ?? (signal ? 255 : 0));
      });
    });
  }

  /** End the live: drain ffmpeg + packager, convert manifests to VOD, notify the app. */
  stop(): Promise<void> {
    if (this.state === "stopping" || this.state === "done") return Promise.resolve();
    return this.shutdown(async () => {
      const hasManifest = await stat(path.join(this.dir, "manifest.mpd")).then(() => true, () => false);
      if (hasManifest) {
        await sendCallback({ type: "live.ended", eventId: this.eventId, manifestUrl: manifestUrl(this.eventId) });
      } else {
        await sendCallback({ type: "live.error", eventId: this.eventId, message: "Stopped before any media was received" });
      }
    });
  }

  private fail(message: string): Promise<void> {
    if (this.state === "stopping" || this.state === "done") return Promise.resolve();
    console.error(`[${this.eventId}] error: ${message}`);
    return this.shutdown(() => sendCallback({ type: "live.error", eventId: this.eventId, message }));
  }

  /** Stop processes without notifying the app (used by DELETE). */
  abort(): Promise<void> {
    if (this.state === "done") return Promise.resolve();
    return this.shutdown(async () => {});
  }

  /** Process exit: kill children, leave manifests dynamic for recoverInterruptedEvents(). */
  killNow(): void {
    this.state = "done";
    this.ffmpeg?.kill("SIGKILL");
    this.blackCheck?.kill("SIGKILL");
    this.packager?.kill("SIGKILL");
    // BROWSER: the capture session is reaped by the capture service (idle timeout) or by the
    // DELETE /sessions control sends on its next boot.
  }

  private async shutdown(notify: () => Promise<void>): Promise<void> {
    this.state = "stopping";
    this.blackCheck?.kill("SIGKILL");
    const ff = this.ffmpeg;
    if (ff) {
      ff.kill("SIGINT"); // ffmpeg flushes its muxer on SIGINT
      await waitExit(ff, 10_000);
    }
    if (this.req.inputType === "BROWSER") await stopCapture(this.eventId);
    this.fifo?.end();
    if (this.packager) {
      const pk = this.packager;
      if (!(await waitExit(pk, 30_000))) {
        pk.kill("SIGTERM");
        await waitExit(pk, 5_000);
      }
    }
    await this.finished;
    await rm(this.fifoPath, { force: true });
    await rm(path.join(this.dir, ".tmp"), { recursive: true, force: true });
    await finalizeManifests(this.dir).catch((err) => console.error(`[${this.eventId}] finalize:`, err));
    this.state = "done";
    jobs.delete(this.eventId);
    await notify();
  }
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function waitExit(proc: ChildProcess, ms: number): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    proc.once("exit", () => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

function pipeLog(proc: ChildProcess, tagName: string): void {
  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (s: string) => {
    for (const line of s.split("\n")) if (line.trim()) console.log(`[${tagName}] ${line}`);
  });
}

// ---- registry --------------------------------------------------------------------------------

export const jobs = new Map<string, EventJob>();

/** MediaMTX publish auth: SRT uses path "<streamKey>", RTMP uses "live/<streamKey>". */
export function findJobForPublish(protocol: string, pathName: string): EventJob | undefined {
  for (const job of jobs.values()) {
    const { inputType, streamKey } = job.req;
    if (inputType === "SRT" && protocol === "srt" && pathName === streamKey) return job;
    if (inputType === "RTMP" && protocol === "rtmp" && pathName === `live/${streamKey}`) return job;
  }
  return undefined;
}

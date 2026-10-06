/**
 * TERMTEE browser capture service (BROWSER input). Runs in its own container (Dockerfile.capture),
 * one session per event:
 *
 *   Xvfb :N 1920x1080x24 + matchbox WM ─┐
 *   PulseAudio null sink ─┼─ Chromium (kiosk, fresh profile, autoplay) renders inputUrl
 *                         └─ ffmpeg x11grab + pulse -> H.264 high 1080p30 + AAC 48k -> MPEG-TS
 *                                                                  │ fan-out, starts at a keyframe
 *   control: ffmpeg <── GET /sessions/:id/stream ◄────────────────┘ (then the normal packaging path)
 *
 *   POST   /sessions/:id { url }   start (idempotent; replaces a failed session)
 *   GET    /sessions/:id           { state, error? }
 *   GET    /sessions/:id/stream    live MPEG-TS
 *   DELETE /sessions/:id           stop and clean up (Chromium, PulseAudio, Xvfb, ffmpeg, profile)
 *   DELETE /sessions               stop all (control calls this when it boots)
 *   GET    /healthz
 *
 * No DRM: this Chromium has no Widevine CDM (and none is ever added), so EME-protected players render
 * black. Untrusted pages run here, not in control, so the DRM keys and MEDIA_CONTROL_SECRET are never
 * in the same container as the browser.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { checkInputUrl } from "./netguard.js";

const env = (name: string, fallback: string) => process.env[name] || fallback;

const PORT = Number(env("CAPTURE_PORT", "8090"));
const TOKEN = process.env.CAPTURE_TOKEN ?? "";
if (!TOKEN) throw new Error("Missing env CAPTURE_TOKEN");
const MAX_SESSIONS = Number(env("CAPTURE_MAX_SESSIONS", "1"));
const SEGMENT_SECONDS = Number(env("SEGMENT_SECONDS", "2"));
const X264_PRESET = env("CAPTURE_X264_PRESET", "veryfast");
const CRF = env("CAPTURE_CRF", "18");
const MAXRATE = env("CAPTURE_MAXRATE", "8M");
const BUFSIZE = env("CAPTURE_BUFSIZE", "16M");
const IDLE_MS = Number(env("CAPTURE_IDLE_SECONDS", "90")) * 1000;
const WORK_DIR = path.resolve(env("CAPTURE_WORK_DIR", path.join(os.tmpdir(), "capture")));
const CHROMIUM = env("CHROMIUM_BIN", "chromium");
const FFMPEG = env("FFMPEG_BIN", "ffmpeg");
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TS_PACKET = 188;
const PMT_PID = 0x1000; // fixed via -mpegts_pmt_start_pid
const VIDEO_PID = 0x100; // fixed via -mpegts_start_pid (video is mapped first)
const MAX_GOP_BYTES = 32 * 1024 * 1024;
const MAX_SUBSCRIBER_BACKLOG = 16 * 1024 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type State = "starting" | "running" | "failed" | "stopped";

class Session {
  state: State = "starting";
  error?: string;
  readonly dir: string;
  idleSince = Date.now();
  endedAt = 0;

  private display = -1;
  private xvfb?: ChildProcess;
  private wm?: ChildProcess;
  private pulse?: ChildProcess;
  private chrome?: ChildProcess;
  private ffmpeg?: ChildProcess;
  private restarts = { wm: 0, chrome: 0, ffmpeg: 0 };
  private subscribers = new Set<ServerResponse>();
  private carry: Buffer = Buffer.alloc(0);
  private pat?: Buffer;
  private pmt?: Buffer;
  private gop: Buffer[] = []; // everything since the latest video keyframe, prefixed with PAT/PMT
  private gopBytes = 0;

  constructor(readonly id: string, readonly url: string) {
    // Random suffix: also the marker used to find leftover processes of this session in /proc.
    this.dir = path.join(WORK_DIR, `${id}-${randomBytes(4).toString("hex")}`);
  }

  private get pulseSocket(): string {
    return path.join(this.dir, "pulse.sock");
  }

  private get childEnv(): NodeJS.ProcessEnv {
    const home = path.join(this.dir, "home");
    return {
      PATH: process.env.PATH,
      HOME: home,
      XDG_RUNTIME_DIR: path.join(this.dir, "run"),
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      DISPLAY: `:${this.display}`,
      PULSE_SERVER: `unix:${this.pulseSocket}`,
      LANG: "C.UTF-8",
    };
  }

  private log(msg: string): void {
    console.log(`[${this.id}] ${msg}`);
  }

  async start(): Promise<void> {
    try {
      await mkdir(path.join(this.dir, "profile"), { recursive: true });
      await mkdir(path.join(this.dir, "home"), { recursive: true });
      await mkdir(path.join(this.dir, "run"), { recursive: true, mode: 0o700 });
      await this.startXvfb();
      this.startWm();
      await this.startPulse();
      this.startChrome();
      await sleep(1500); // let the first paint happen before the encoder starts
      if (this.state !== "starting") return;
      this.startFfmpeg();
      this.state = "running";
      this.log(`capturing ${new URL(this.url).host} on :${this.display}`);
    } catch (err) {
      await this.fail(`start: ${(err as Error).message}`);
    }
  }

  private async startXvfb(): Promise<void> {
    // -displayfd: Xvfb picks a free display number itself and writes it to fd 3 (no races).
    const x = spawn("Xvfb", ["-displayfd", "3", "-screen", "0", `${WIDTH}x${HEIGHT}x24`, "-nolisten", "tcp", "-br", "-noreset"], {
      stdio: ["ignore", "ignore", "pipe", "pipe"],
      detached: true,
      env: { PATH: process.env.PATH },
    });
    this.xvfb = x;
    this.watch(x, "xvfb");
    this.display = await new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Xvfb did not start")), 10_000);
      let out = "";
      (x.stdio[3] as NodeJS.ReadableStream).on("data", (b: Buffer) => {
        out += b.toString();
        const m = /^(\d+)\n/.exec(out);
        if (m) {
          clearTimeout(t);
          resolve(Number(m[1]));
        }
      });
      x.once("exit", () => reject(new Error("Xvfb exited")));
    });
  }

  /**
   * Without a window manager Chromium's kiosk window ends up 1919x1079 (or offset); matchbox makes
   * every window exactly fill the 1920x1080 screen, so the page sees a true 1080p viewport.
   */
  private startWm(): void {
    const wm = spawn("matchbox-window-manager", ["-use_titlebar", "no", "-use_cursor", "no"], {
      stdio: ["ignore", "ignore", "pipe"],
      detached: true,
      env: this.childEnv,
    });
    this.wm = wm;
    this.watch(wm, "wm", () => this.startWm());
  }

  private async startPulse(): Promise<void> {
    // Null sink only: the page's audio goes to "capture" and ffmpeg records capture.monitor.
    // No other modules (no X11 bell, no event sounds), so nothing but the page is ever heard.
    const script = path.join(this.dir, "default.pa");
    await writeFile(
      script,
      [
        "load-module module-null-sink sink_name=capture rate=48000 channels=2 sink_properties=device.description=capture",
        "set-default-sink capture",
        `load-module module-native-protocol-unix socket=${this.pulseSocket} auth-anonymous=1`,
        "",
      ].join("\n"),
    );
    const p = spawn(
      "pulseaudio",
      ["-n", "-F", script, "--daemonize=no", "--exit-idle-time=-1", "--use-pid-file=no", "--disable-shm=yes", "--system=no", "--log-target=stderr", "--log-level=error"],
      { stdio: ["ignore", "ignore", "pipe"], detached: true, env: this.childEnv },
    );
    this.pulse = p;
    this.watch(p, "pulse");
    for (let i = 0; i < 100; i++) {
      if (await stat(this.pulseSocket).then(() => true, () => false)) return;
      if (p.exitCode !== null) break;
      await sleep(100);
    }
    throw new Error("PulseAudio did not start");
  }

  private startChrome(): void {
    const args = [
      `--user-data-dir=${path.join(this.dir, "profile")}`, // fresh, throwaway profile per event: no logins
      // Docker's default seccomp profile blocks Chromium's namespace sandbox. Isolation comes from the
      // container instead (own network, no secrets, non-root, all capabilities dropped).
      "--no-sandbox",
      "--test-type", // hides the "unsupported command-line flag" bar that --no-sandbox would show
      "--kiosk",
      "--window-position=0,0",
      `--window-size=${WIDTH},${HEIGHT}`,
      "--force-device-scale-factor=1",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-infobars",
      "--hide-scrollbars",
      "--noerrdialogs",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--disable-translate",
      "--disable-features=Translate,MediaRouter,GlobalMediaControls,HardwareMediaKeyHandling",
      "--disable-notifications",
      "--deny-permission-prompts",
      "--disable-sync",
      "--disable-extensions",
      "--disable-default-apps",
      "--disable-background-networking",
      "--disable-component-update", // also means no Widevine component download, ever
      "--disable-breakpad",
      "--disable-dev-shm-usage",
      "--password-store=basic",
      "--lang=en-US",
      `--app=${this.url}`, // app window: no tab strip / omnibox, ever
    ];
    const c = spawn(CHROMIUM, args, { stdio: ["ignore", "ignore", "pipe"], detached: true, env: this.childEnv });
    this.chrome = c;
    this.watch(c, "chrome", () => this.startChrome());
  }

  private startFfmpeg(): void {
    const gop = SEGMENT_SECONDS * FPS;
    const args = [
      "-hide_banner", "-loglevel", "warning", "-nostdin",
      "-thread_queue_size", "1024",
      "-f", "x11grab", "-draw_mouse", "0", "-framerate", String(FPS), "-video_size", `${WIDTH}x${HEIGHT}`, "-i", `:${this.display}.0+0,0`,
      "-thread_queue_size", "1024",
      "-f", "pulse", "-sample_rate", "48000", "-channels", "2", "-i", "capture.monitor",
      "-map", "0:v:0", "-map", "1:a:0",
      // High quality 1080p: CRF capped at MAXRATE; keyframe exactly every segment (2 s).
      "-c:v", "libx264", "-preset", X264_PRESET, "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-crf", CRF, "-maxrate", MAXRATE, "-bufsize", BUFSIZE,
      "-g", String(gop), "-keyint_min", String(gop), "-sc_threshold", "0",
      "-force_key_frames", `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
      "-af", "aresample=async=1000",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-mpegts_pmt_start_pid", String(PMT_PID), "-mpegts_start_pid", String(VIDEO_PID),
      "-f", "mpegts", "pipe:1",
    ];
    const ff = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"], detached: true, env: this.childEnv });
    this.ffmpeg = ff;
    this.carry = Buffer.alloc(0);
    ff.stdout!.on("data", (chunk: Buffer) => this.onData(chunk));
    this.watch(ff, "ffmpeg", () => this.startFfmpeg());
  }

  /** Log stderr; on unexpected exit restart (Chromium/ffmpeg, a few times) or fail the session. */
  private watch(proc: ChildProcess, name: "xvfb" | "wm" | "pulse" | "chrome" | "ffmpeg", restart?: () => void): void {
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (s: string) => {
      for (const line of s.split("\n")) {
        if (!line.trim()) continue;
        // Chromium and PulseAudio are chatty about dbus/GPU/GCM in a container; keep only real errors.
        if (/system bus|dbus|bus\.cc/i.test(line)) continue;
        if (name === "chrome" && (!/FATAL|ERROR/.test(line) || /gpu|viz|gl_|angle|vaapi|va_|gcm|zygote/i.test(line))) continue;
        console.log(`[${this.id}/${name}] ${line}`);
      }
    });
    proc.on("exit", (code, signal) => {
      if (this.state !== "starting" && this.state !== "running") return;
      const why = `${name} exited (code ${code}, signal ${signal})`;
      if (restart && name !== "xvfb" && name !== "pulse" && ++this.restarts[name] <= 5) {
        console.warn(`[${this.id}] ${why}, restarting`);
        setTimeout(() => {
          if (this.state === "starting" || this.state === "running") restart();
        }, 2000);
        return;
      }
      void this.fail(why);
    });
  }

  /** Relay whole TS packets to subscribers and keep the current GOP for late joiners. */
  private onData(chunk: Buffer): void {
    const buf = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
    const whole = buf.length - (buf.length % TS_PACKET);
    this.carry = Buffer.from(buf.subarray(whole));
    if (!whole) return;
    let gopStart = 0;
    for (let off = 0; off < whole; off += TS_PACKET) {
      if (buf[off] !== 0x47) continue;
      const pid = ((buf[off + 1]! & 0x1f) << 8) | buf[off + 2]!;
      if (pid === 0) this.pat = Buffer.from(buf.subarray(off, off + TS_PACKET));
      else if (pid === PMT_PID) this.pmt = Buffer.from(buf.subarray(off, off + TS_PACKET));
      else if (pid === VIDEO_PID) {
        const hasAdaptation = (buf[off + 3]! & 0x20) !== 0 && buf[off + 4]! > 0;
        const randomAccess = hasAdaptation && (buf[off + 5]! & 0x40) !== 0; // set by ffmpeg on keyframes
        if (randomAccess) {
          this.gop = this.pat && this.pmt ? [this.pat, this.pmt] : [];
          this.gopBytes = 2 * TS_PACKET;
          gopStart = off;
        }
      }
    }
    const data = buf.subarray(0, whole);
    if (this.gop.length) {
      const part = data.subarray(gopStart);
      this.gop.push(part);
      this.gopBytes += part.length;
      if (this.gopBytes > MAX_GOP_BYTES) this.gop = [];
    }
    for (const res of this.subscribers) {
      if (res.writableLength > MAX_SUBSCRIBER_BACKLOG) {
        console.warn(`[${this.id}] dropping a slow subscriber`);
        res.destroy();
        continue;
      }
      res.write(data);
    }
  }

  subscribe(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "video/mp2t", "Cache-Control": "no-store" });
    for (const part of this.gop) res.write(part);
    this.subscribers.add(res);
    res.on("close", () => {
      this.subscribers.delete(res);
      if (this.subscribers.size === 0) this.idleSince = Date.now();
    });
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  async fail(message: string): Promise<void> {
    if (this.state === "failed" || this.state === "stopped") return;
    console.error(`[${this.id}] failed: ${message}`);
    this.state = "failed";
    this.error = message;
    await this.cleanup();
  }

  async stop(): Promise<void> {
    if (this.state === "stopped") return;
    const wasFailed = this.state === "failed";
    this.state = "stopped";
    if (!wasFailed) await this.cleanup();
  }

  /** Kill every process of the session (whole process groups, then a /proc sweep) and delete the profile. */
  private async cleanup(): Promise<void> {
    this.endedAt = Date.now();
    for (const res of this.subscribers) res.end();
    this.subscribers.clear();
    this.gop = [];
    await killGroup(this.ffmpeg, "SIGINT", 2000);
    await killGroup(this.chrome, "SIGTERM", 3000);
    await killGroup(this.pulse, "SIGTERM", 2000);
    await killGroup(this.wm, "SIGTERM", 2000);
    await killGroup(this.xvfb, "SIGTERM", 2000);
    await killByMarker(this.dir);
    await rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
    this.log("cleaned up");
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

/** Signal the process group (children were spawned detached = own group), then SIGKILL what is left. */
async function killGroup(proc: ChildProcess | undefined, signal: NodeJS.Signals, graceMs: number): Promise<void> {
  if (!proc?.pid) return;
  const group = (sig: NodeJS.Signals) => {
    try {
      process.kill(-proc.pid!, sig);
    } catch {
      /* already gone */
    }
  };
  if (proc.exitCode === null && proc.signalCode === null) {
    group(signal);
    await waitExit(proc, graceMs);
  }
  group("SIGKILL"); // stragglers in the group (Chromium renderers, zygote, ...)
  await waitExit(proc, 2000);
}

/** SIGKILL any process whose command line mentions the session directory (profile, pulse script). */
async function killByMarker(marker: string): Promise<void> {
  const pids = await readdir("/proc").catch(() => [] as string[]);
  for (const pid of pids) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    const cmd = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
    if (cmd.includes(marker)) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        /* gone */
      }
    }
  }
}

// ---- HTTP API -----------------------------------------------------------------------------------

const sessions = new Map<string, Session>();

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) res.writeHead(status).end();
  else res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

function authorized(req: IncomingMessage): boolean {
  const h = Buffer.from(req.headers.authorization ?? "");
  const want = Buffer.from(`Bearer ${TOKEN}`);
  return h.length === want.length && timingSafeEqual(h, want);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 16 * 1024) throw new HttpError(413, "Body too large");
    chunks.push(c as Buffer);
  }
  try {
    return size ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function active(): number {
  let n = 0;
  for (const s of sessions.values()) if (s.state === "starting" || s.state === "running") n++;
  return n;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://local");
  const method = req.method ?? "GET";
  if (method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true, sessions: active() });
  if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "sessions") return send(res, 404, { error: "Not found" });

  if (method === "DELETE" && parts.length === 1) {
    const all = [...sessions.values()];
    sessions.clear();
    await Promise.all(all.map((s) => s.stop()));
    if (all.length) console.log(`stopped all sessions (${all.length})`);
    return send(res, 204);
  }

  const id = parts[1] ?? "";
  if (!SAFE_ID.test(id)) throw new HttpError(400, "Invalid session id");
  const s = sessions.get(id);

  if (method === "POST" && parts.length === 2) {
    const body = await readJson(req);
    // Re-checked here too (defense in depth): http/https only, no private hosts.
    const target = await checkInputUrl("BROWSER", typeof body.url === "string" ? body.url : undefined).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    if (s && (s.state === "starting" || s.state === "running")) {
      if (s.url !== target) throw new HttpError(409, "Session already running with another URL");
      return send(res, 200, { state: s.state });
    }
    if (active() >= MAX_SESSIONS) throw new HttpError(503, `Capture capacity reached (${MAX_SESSIONS} session(s))`);
    if (s) await s.stop();
    const session = new Session(id, target);
    sessions.set(id, session);
    await session.start();
    if (session.state === "failed") throw new HttpError(502, session.error ?? "capture failed to start");
    return send(res, 200, { state: session.state });
  }

  if (!s) return send(res, 404, { error: "No such session" });

  if (method === "GET" && parts.length === 2) return send(res, 200, { state: s.state, error: s.error });

  if (method === "GET" && parts[2] === "stream" && parts.length === 3) {
    if (s.state !== "running") return send(res, 409, { error: `Session is ${s.state}` });
    s.subscribe(res);
    return;
  }

  if (method === "DELETE" && parts.length === 2) {
    sessions.delete(id);
    await s.stop();
    return send(res, 204);
  }

  return send(res, 404, { error: "Not found" });
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: (err as Error).message });
  });
});

// Reaper: sessions nobody reads (control died / lost track) and old failed sessions.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const idle = s.state === "running" && s.subscriberCount === 0 && now - s.idleSince > IDLE_MS;
    const stale = s.state === "failed" && now - s.endedAt > 10 * 60_000;
    if (idle || stale) {
      if (idle) console.warn(`[${id}] no reader for ${IDLE_MS / 1000}s, stopping`);
      sessions.delete(id);
      void s.stop();
    }
  }
}, 10_000).unref();

await rm(WORK_DIR, { recursive: true, force: true }).catch(() => undefined);
await mkdir(WORK_DIR, { recursive: true });
server.listen(PORT, () => console.log(`capture listening on :${PORT}, max sessions ${MAX_SESSIONS}`));

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`${sig}: stopping ${sessions.size} session(s)`);
    void Promise.all([...sessions.values()].map((s) => s.stop())).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}

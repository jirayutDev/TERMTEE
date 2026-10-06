/**
 * TERMTEE media control service.
 *
 *   POST   /events/:eventId/start   StartEventRequest -> StartEventResponse   (Bearer MEDIA_CONTROL_SECRET)
 *   POST   /events/:eventId/stop    -> 202, live.ended callback follows        (Bearer)
 *   DELETE /events/:eventId         -> 204, deletes segments (replay expired)  (Bearer)
 *   POST   /mediamtx/auth?token=..  MediaMTX external auth hook (internal network only)
 *   GET    /healthz
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { config, isSafeId } from "./config.js";
import { PUSH_INPUT_TYPES, type InputType, type StartEventRequest, type StartEventResponse } from "./contract.js";
import { stopCapture } from "./browser.js";
import { checkInputUrl } from "./netguard.js";
import { EventJob, HttpError, findJobForPublish, jobs } from "./pipeline.js";
import { deleteEventOutput, recoverInterruptedEvents } from "./storage.js";

const INPUT_TYPES: InputType[] = ["SRT", "RTMP", "HLS", "DASH", "RTSP", "BROWSER"];

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function requireBearer(req: IncomingMessage): void {
  const h = req.headers.authorization ?? "";
  if (!h.startsWith("Bearer ") || !safeEqual(h.slice(7), config.secret)) throw new HttpError(401, "Unauthorized");
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new HttpError(413, "Body too large");
    chunks.push(c as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

async function parseStart(eventId: string, body: unknown): Promise<StartEventRequest> {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" && b[k] !== "" ? (b[k] as string) : undefined);
  const inputType = str("inputType") as InputType | undefined;
  const contentId = str("contentId");
  const streamKey = str("streamKey");
  let inputUrl = str("inputUrl");

  if (str("eventId") && str("eventId") !== eventId) throw new HttpError(400, "eventId mismatch");
  if (!inputType || !INPUT_TYPES.includes(inputType)) throw new HttpError(400, `inputType must be ${INPUT_TYPES.join(" | ")}`);
  if (!contentId) throw new HttpError(400, "contentId required");
  if (!streamKey || !isSafeId(streamKey)) throw new HttpError(400, "streamKey required ([A-Za-z0-9_-])");
  if (PUSH_INPUT_TYPES.includes(inputType)) {
    inputUrl = undefined;
  } else {
    if (inputType === "BROWSER" && !config.captureToken) throw new HttpError(400, "BROWSER input is not enabled on this media server");
    // Scheme per type + SSRF guard (private/loopback/link-local hosts), see netguard.ts.
    inputUrl = await checkInputUrl(inputType, inputUrl).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
  }
  return { eventId, contentId, inputType, streamKey, inputUrl };
}

function ingestUrl(r: StartEventRequest): string | undefined {
  if (r.inputType === "SRT") return `srt://${config.ingestHost}:${config.srtPort}?streamid=publish:${r.streamKey}`;
  if (r.inputType === "RTMP") return `rtmp://${config.ingestHost}:${config.rtmpPort}/live/${r.streamKey}`;
  return undefined;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://local");
  const parts = url.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true, jobs: jobs.size });

  // MediaMTX external auth. Body: { user, password, ip, action, path, protocol, id, query }.
  if (method === "POST" && url.pathname === "/mediamtx/auth") {
    if (!safeEqual(url.searchParams.get("token") ?? "", config.mediamtxHookToken)) return send(res, 401);
    const b = (await readJson(req)) as Record<string, string>;
    if (b.action === "read") {
      const ok = b.protocol === "rtsp" && b.user === config.mediamtxReadUser && safeEqual(b.password ?? "", config.mediamtxReadPass);
      return send(res, ok ? 200 : 401);
    }
    if (b.action === "publish") {
      const job = findJobForPublish(b.protocol ?? "", b.path ?? "");
      if (!job || (job.state !== "waiting" && job.state !== "live")) {
        console.warn(`[auth] rejected publish ${b.protocol} ${b.path} from ${b.ip}`);
        return send(res, 401);
      }
      console.log(`[auth] publish ${b.protocol} for event ${job.eventId} from ${b.ip}`);
      job.triggerIngest();
      return send(res, 200);
    }
    return send(res, 401);
  }

  if (parts[0] !== "events" || !parts[1]) return send(res, 404, { error: "Not found" });
  requireBearer(req);
  const eventId = parts[1];
  if (!isSafeId(eventId)) throw new HttpError(400, "Invalid eventId");

  // POST /events/:id/start
  if (method === "POST" && parts[2] === "start" && parts.length === 3) {
    const body = await parseStart(eventId, await readJson(req));
    const existing = jobs.get(eventId);
    if (existing) return send(res, 200, { ingestUrl: ingestUrl(existing.req) } satisfies StartEventResponse);
    for (const j of jobs.values()) {
      if (j.req.streamKey === body.streamKey) throw new HttpError(409, "streamKey in use by another event");
    }
    const job = new EventJob(body);
    jobs.set(eventId, job); // reserve before await so concurrent starts are idempotent
    try {
      await job.init();
    } catch (err) {
      jobs.delete(eventId);
      if (body.inputType === "BROWSER") void stopCapture(eventId);
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Start failed: ${(err as Error).message}`);
    }
    job.triggerIngest(); // Pull types: start pulling. SRT/RTMP: picks up a publisher that connected during init.
    console.log(`[${eventId}] started (${body.inputType})`);
    return send(res, 200, { ingestUrl: ingestUrl(body) } satisfies StartEventResponse);
  }

  // POST /events/:id/stop
  if (method === "POST" && parts[2] === "stop" && parts.length === 3) {
    const job = jobs.get(eventId);
    if (!job) throw new HttpError(404, "Event is not running");
    void job.stop();
    return send(res, 202, { status: "stopping" });
  }

  // DELETE /events/:id
  if (method === "DELETE" && parts.length === 2) {
    const job = jobs.get(eventId);
    if (job) await job.abort();
    await deleteEventOutput(eventId);
    console.log(`[${eventId}] output deleted`);
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

server.listen(config.port, () => {
  console.log(`media control listening on :${config.port}, output=${config.outputDir}`);
  void recoverInterruptedEvents();
  // Capture sessions of a previous run have no job any more: drop them (best effort).
  void stopCapture();
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`${sig}: killing ${jobs.size} job(s)`);
    // Manifests stay dynamic; recoverInterruptedEvents() finalizes them and notifies the app on next boot.
    for (const j of jobs.values()) j.killNow();
    process.exit(0);
  });
}

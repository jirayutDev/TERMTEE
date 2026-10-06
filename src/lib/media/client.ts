/**
 * Server-side client for the media server control API.
 * See ./types.ts for the contract. Never import this from a Client Component:
 * it reads MEDIA_CONTROL_SECRET.
 */
import type { StartEventRequest, StartEventResponse } from "./types";

export class MediaServerError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MediaServerError";
  }
}

function config() {
  const baseUrl = process.env.MEDIA_CONTROL_URL;
  const secret = process.env.MEDIA_CONTROL_SECRET;
  if (!baseUrl || !secret) {
    throw new MediaServerError("MEDIA_CONTROL_URL / MEDIA_CONTROL_SECRET is not configured");
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), secret };
}

async function call(method: "POST" | "DELETE", path: string, body?: unknown): Promise<Response> {
  const { baseUrl, secret } = config();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new MediaServerError(`Media server unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new MediaServerError(
      `Media server ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`,
      res.status,
    );
  }
  return res;
}

/** POST /events/:eventId/start — begin ingest + packaging. */
export async function startEvent(req: StartEventRequest): Promise<StartEventResponse> {
  const res = await call("POST", `/events/${encodeURIComponent(req.eventId)}/start`, req);
  const text = await res.text();
  if (!text) return {};
  try {
    const data = JSON.parse(text) as StartEventResponse;
    return typeof data?.ingestUrl === "string" ? { ingestUrl: data.ingestUrl } : {};
  } catch {
    return {};
  }
}

/** POST /events/:eventId/stop — end the live; media server finalizes the VOD manifest. */
export async function stopEvent(eventId: string): Promise<void> {
  await call("POST", `/events/${encodeURIComponent(eventId)}/stop`);
}

/**
 * DELETE /events/:eventId — remove all stored media (replay) for the event.
 * NOTE: not yet listed in types.ts contract header; a 404 is treated as already deleted.
 */
export async function deleteEventMedia(eventId: string): Promise<void> {
  try {
    await call("DELETE", `/events/${encodeURIComponent(eventId)}`);
  } catch (err) {
    if (err instanceof MediaServerError && err.status === 404) return;
    throw err;
  }
}

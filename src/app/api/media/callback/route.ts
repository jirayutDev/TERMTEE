import { z } from "zod";
import { db } from "@/lib/db";
import { verifyBearer } from "@/lib/bearer";
import type { MediaCallback } from "@/lib/media/types";

const callbackSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("live.started"), eventId: z.string().min(1), manifestUrl: z.url() }),
  z.object({ type: z.literal("live.ended"), eventId: z.string().min(1), manifestUrl: z.url() }),
  z.object({ type: z.literal("live.error"), eventId: z.string().min(1), message: z.string() }),
]) satisfies z.ZodType<MediaCallback>;

/**
 * Media server -> app notifications. Idempotent: replays of the same callback
 * (or out-of-order delivery) never move an event backwards in its lifecycle.
 */
export async function POST(request: Request) {
  if (!verifyBearer(request.headers.get("authorization"), process.env.MEDIA_CONTROL_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = callbackSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const msg = parsed.data;

  const event = await db.event.findUnique({
    where: { id: msg.eventId },
    select: { id: true, status: true },
  });
  if (!event) return Response.json({ error: "event_not_found" }, { status: 404 });

  switch (msg.type) {
    case "live.started": {
      // Only DRAFT/SCHEDULED/LIVE may become LIVE (never resurrect ENDED/ARCHIVED).
      const { count } = await db.event.updateMany({
        where: { id: event.id, status: { in: ["DRAFT", "SCHEDULED", "LIVE"] } },
        data: { status: "LIVE", manifestUrl: msg.manifestUrl },
      });
      return Response.json({ ok: true, applied: count > 0 });
    }
    case "live.ended": {
      // First delivery: transition to ENDED and stamp endedAt.
      const { count } = await db.event.updateMany({
        where: { id: event.id, status: { in: ["DRAFT", "SCHEDULED", "LIVE"] } },
        data: { status: "ENDED", endedAt: new Date(), manifestUrl: msg.manifestUrl },
      });
      if (count === 0) {
        // Duplicate delivery: keep the original endedAt, just refresh the manifest.
        await db.event.updateMany({
          where: { id: event.id, status: "ENDED" },
          data: { manifestUrl: msg.manifestUrl },
        });
      }
      return Response.json({ ok: true, applied: count > 0 });
    }
    case "live.error": {
      console.error(`[media] live.error for event ${event.id} (${event.status}): ${msg.message}`);
      return Response.json({ ok: true });
    }
  }
}

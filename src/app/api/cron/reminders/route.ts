import { db } from "@/lib/db";
import { verifyBearer } from "@/lib/bearer";
import { replayExpiresAt } from "@/lib/access";
import { notifyTicketHolders, type BroadcastResult } from "@/lib/email/broadcast";

export const runtime = "nodejs";
export const maxDuration = 300;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
/** "Starting soon" window: events starting between now+15min and now+30min (run every ~5–10 min). */
const START_FROM_MS = 15 * MIN;
const START_TO_MS = 30 * MIN;
/** Replay reminder when the replay window closes within this time. */
const REPLAY_WITHIN_MS = 24 * HOUR;

/**
 * Email reminders to ticket holders, once per user per event (idempotent via EmailLog):
 *  - event.starting: SCHEDULED/LIVE events starting in 15–30 minutes
 *  - replay.expiring: ENDED events whose replay expires within 24 hours
 * Protected by `Authorization: Bearer {CRON_SECRET}`.
 */
async function handle(request: Request) {
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const starting = await db.event.findMany({
    where: {
      status: { in: ["SCHEDULED", "LIVE"] },
      startsAt: { gte: new Date(now + START_FROM_MS), lte: new Date(now + START_TO_MS) },
    },
    select: { id: true },
  });

  const ended = await db.event.findMany({
    where: { status: "ENDED", endedAt: { not: null } },
    select: { id: true, endedAt: true, replayDays: true },
  });
  const expiring = ended.filter((e) => {
    const exp = replayExpiresAt(e.endedAt, e.replayDays)?.getTime();
    return exp !== undefined && exp > now && exp <= now + REPLAY_WITHIN_MS;
  });

  const results: BroadcastResult[] = [];
  for (const e of starting) results.push(await notifyTicketHolders(e.id, "event.starting"));
  for (const e of expiring) results.push(await notifyTicketHolders(e.id, "replay.expiring"));

  const failed = results.reduce((n, r) => n + r.failed, 0);
  return Response.json({ ok: failed === 0, results }, { status: failed ? 207 : 200 });
}

export const GET = handle;
export const POST = handle;

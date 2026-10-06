import { db } from "@/lib/db";
import { verifyBearer } from "@/lib/bearer";
import { replayExpiresAt } from "@/lib/access";
import { deleteEventMedia } from "@/lib/media/client";
import { getSettingsSection } from "@/lib/settings";

/**
 * Cancels PENDING orders older than settings.payment.unpaidOrderTtlMinutes (0 = disabled) that
 * have no slip being checked or waiting for review, and no slip activity within the TTL either
 * (e.g. an order put back to PENDING after an admin rejected its slip gets a fresh window).
 */
async function cancelUnpaidOrders(now: Date): Promise<number> {
  const { unpaidOrderTtlMinutes } = await getSettingsSection("payment");
  if (!unpaidOrderTtlMinutes || unpaidOrderTtlMinutes <= 0) return 0;
  const cutoff = new Date(now.getTime() - unpaidOrderTtlMinutes * 60_000);
  const res = await db.order.updateMany({
    where: {
      status: "PENDING",
      createdAt: { lt: cutoff },
      payments: {
        none: {
          OR: [
            { status: { in: ["PROCESSING", "NEEDS_REVIEW", "VERIFIED"] } },
            { createdAt: { gte: cutoff } },
            { reviewedAt: { gte: cutoff } },
          ],
        },
      },
    },
    data: { status: "CANCELLED" },
  });
  return res.count;
}

/**
 * Also runs cancelUnpaidOrders (above).
 *
 * Archives ENDED events whose replay window (endedAt + replayDays) has passed:
 * deletes media on the media server, then sets status ARCHIVED.
 * Protected by `Authorization: Bearer {CRON_SECRET}` (Vercel Cron sends this automatically).
 */
async function handle(request: Request) {
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  let cancelledOrders = 0;
  try {
    cancelledOrders = await cancelUnpaidOrders(now);
  } catch (err) {
    console.error("[cron] failed to cancel unpaid orders:", err);
  }

  const candidates = await db.event.findMany({
    where: { status: "ENDED", endedAt: { not: null, lte: now } },
    select: { id: true, endedAt: true, replayDays: true },
  });
  const expired = candidates.filter((e) => {
    const exp = replayExpiresAt(e.endedAt, e.replayDays);
    return exp !== null && exp <= now;
  });

  const archived: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const e of expired) {
    try {
      await deleteEventMedia(e.id);
      await db.event.updateMany({
        where: { id: e.id, status: "ENDED" },
        data: { status: "ARCHIVED", manifestUrl: null },
      });
      archived.push(e.id);
    } catch (err) {
      console.error(`[cron] failed to archive ${e.id}:`, err);
      failed.push({ id: e.id, error: (err as Error).message });
    }
  }

  return Response.json(
    { ok: failed.length === 0, checked: candidates.length, archived, failed, cancelledOrders },
    { status: failed.length ? 207 : 200 },
  );
}

export const GET = handle;
export const POST = handle;

import { z } from "zod";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { checkAccess } from "@/lib/access";
import { DEVICE_ID_RE, HEARTBEAT_INTERVAL_SEC } from "@/lib/drm/view-session";

const Body = z.object({
  eventId: z.string().min(1).max(64),
  deviceId: z.string().regex(DEVICE_ID_RE),
  /**
   * true on the first heartbeat of a playback session (player start). A claim
   * takes the session over from any other device ("newest device wins").
   * Regular heartbeats (claim=false) from a device that no longer owns the
   * session get 409 {kicked:true}.
   */
  claim: z.boolean().optional().default(false),
});

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  }
  const { eventId, deviceId, claim } = parsed.data;

  const access = await checkAccess(user.id, eventId);
  if (!access.ok) {
    return Response.json({ error: "forbidden", reason: access.reason }, { status: 403, headers: noStore });
  }

  const now = new Date();
  const key = { userId_eventId: { userId: user.id, eventId } };

  if (claim) {
    // Newest device wins: take over (or create) the session for this device.
    await db.viewSession.upsert({
      where: key,
      create: { userId: user.id, eventId, deviceId, startedAt: now, lastSeenAt: now },
      update: { deviceId, startedAt: now, lastSeenAt: now },
    });
  } else {
    // Only refresh if this device still owns the session (atomic check).
    const updated = await db.viewSession.updateMany({
      where: { userId: user.id, eventId, deviceId },
      data: { lastSeenAt: now },
    });
    if (updated.count === 0) {
      const existing = await db.viewSession.findUnique({ where: key, select: { deviceId: true } });
      if (existing && existing.deviceId !== deviceId) {
        return Response.json({ kicked: true }, { status: 409, headers: noStore });
      }
      // Row vanished (e.g. cleaned up) — recreate for this device.
      await db.viewSession.upsert({
        where: key,
        create: { userId: user.id, eventId, deviceId, startedAt: now, lastSeenAt: now },
        update: { lastSeenAt: now },
      });
    }
  }

  return Response.json(
    { ok: true, mode: access.mode, intervalSec: HEARTBEAT_INTERVAL_SEC },
    { headers: noStore },
  );
}

import { z } from "zod";
import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { checkAccess } from "@/lib/access";
import { getDrmProvider } from "@/lib/drm";
import { DEVICE_ID_RE, isSessionFresh } from "@/lib/drm/view-session";

const Body = z.object({
  eventId: z.string().min(1).max(64),
  drmSystem: z.enum(["Widevine", "PlayReady", "FairPlay"]),
  deviceId: z.string().regex(DEVICE_ID_RE),
});

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  }
  const { eventId, drmSystem, deviceId } = parsed.data;

  const access = await checkAccess(user.id, eventId);
  if (!access.ok) {
    return Response.json({ error: "forbidden", reason: access.reason }, { status: 403, headers: noStore });
  }

  // Caller must own the active (fresh) single-device session for this event.
  const session = await db.viewSession.findUnique({
    where: { userId_eventId: { userId: user.id, eventId } },
    select: { deviceId: true, lastSeenAt: true },
  });
  if (!session || session.deviceId !== deviceId) {
    return Response.json({ kicked: true }, { status: 409, headers: noStore });
  }
  if (!isSessionFresh(session.lastSeenAt)) {
    return Response.json({ error: "session_stale" }, { status: 409, headers: noStore });
  }

  const event = await db.event.findUnique({ where: { id: eventId }, select: { contentId: true } });
  if (!event) return Response.json({ error: "not_found" }, { status: 404, headers: noStore });

  const drm = getDrmProvider();
  const token = drm.createToken({ userId: user.id, contentId: event.contentId, drmSystem });

  return Response.json(
    {
      token,
      licenseUrl: drm.licenseUrl(drmSystem),
      ...(drmSystem === "FairPlay" && { fairplayCertUrl: drm.fairplayCertUrl() }),
    },
    { headers: noStore },
  );
}

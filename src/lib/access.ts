import { db } from "@/lib/db";

export type AccessResult =
  | { ok: true; mode: "live" | "replay"; replayExpiresAt: Date | null }
  | { ok: false; reason: "no_ticket" | "revoked" | "not_started" | "replay_expired" | "archived" };

/** Single source of truth for "may this user play this event right now?". */
export async function checkAccess(userId: string, eventId: string): Promise<AccessResult> {
  const ticket = await db.ticket.findUnique({
    where: { userId_eventId: { userId, eventId } },
    include: { event: true },
  });
  if (!ticket) return { ok: false, reason: "no_ticket" };
  if (ticket.revoked) return { ok: false, reason: "revoked" };

  const { event } = ticket;
  switch (event.status) {
    case "LIVE":
      return { ok: true, mode: "live", replayExpiresAt: null };
    case "ENDED": {
      const expires = replayExpiresAt(event.endedAt, event.replayDays);
      if (!expires || expires < new Date()) return { ok: false, reason: "replay_expired" };
      return { ok: true, mode: "replay", replayExpiresAt: expires };
    }
    case "ARCHIVED":
      return { ok: false, reason: "archived" };
    default:
      return { ok: false, reason: "not_started" };
  }
}

/** Tickets are sold while scheduled, live, or while the replay window is still open. */
export function isOnSale(
  event: { status: string; endedAt: Date | null; replayDays: number },
  now: Date = new Date(),
): boolean {
  if (event.status === "SCHEDULED" || event.status === "LIVE") return true;
  if (event.status !== "ENDED") return false;
  const expires = replayExpiresAt(event.endedAt, event.replayDays);
  return !!expires && expires > now;
}

export function replayExpiresAt(endedAt: Date | null, replayDays: number): Date | null {
  if (!endedAt) return null;
  return new Date(endedAt.getTime() + replayDays * 24 * 60 * 60 * 1000);
}

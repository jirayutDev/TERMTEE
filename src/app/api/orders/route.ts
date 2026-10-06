import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { isOnSale } from "@/lib/access";

/** Creates (or reuses) a PENDING order for an event. Payment happens on /pay/[orderId]. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });

  let eventId: unknown;
  try {
    ({ eventId } = (await request.json()) as { eventId?: unknown });
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof eventId !== "string" || !eventId) {
    return Response.json({ error: "invalid_event" }, { status: 400 });
  }

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "event_not_found" }, { status: 404 });
  if (!isOnSale(event)) return Response.json({ error: "not_on_sale" }, { status: 409 });

  const ticket = await db.ticket.findUnique({
    where: { userId_eventId: { userId: user.id, eventId } },
  });
  if (ticket && !ticket.revoked) {
    return Response.json({ error: "already_owned" }, { status: 409 });
  }

  // Reuse the latest pending order. If the price changed meanwhile and no slip was
  // uploaded for it yet, cancel it and start fresh at the current price.
  const pending = await db.order.findFirst({
    where: { userId: user.id, eventId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: { payments: { where: { status: { not: "REJECTED" } }, select: { id: true } } },
  });
  if (pending) {
    if (pending.amountSatang === event.priceSatang || pending.payments.length > 0) {
      return Response.json({ orderId: pending.id });
    }
    await db.order.update({ where: { id: pending.id }, data: { status: "CANCELLED" } });
  }

  const order = await db.order.create({
    data: { userId: user.id, eventId, amountSatang: event.priceSatang, status: "PENDING" },
  });
  return Response.json({ orderId: order.id }, { status: 201 });
}

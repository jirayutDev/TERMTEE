import { currentUser } from "@/auth";
import { db } from "@/lib/db";
import { toPublicPayment } from "@/lib/payment";

/** Polling endpoint for the payment page (owner only, customer-safe fields). */
export async function GET(_request: Request, ctx: RouteContext<"/api/payment/[paymentId]">) {
  const user = await currentUser();
  if (!user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { paymentId } = await ctx.params;
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { order: { select: { userId: true, status: true } } },
  });
  if (!payment || payment.order.userId !== user.id) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json(
    { ...toPublicPayment(payment), orderStatus: payment.order.status },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

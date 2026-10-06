import { userWithPermission } from "@/lib/roles";
import { db } from "@/lib/db";
import { getSlipStorage } from "@/lib/slip-storage";

/** Serves a private slip image to staff with the "payments" permission only. Never cached. */
export async function GET(_request: Request, ctx: RouteContext<"/api/admin/slips/[paymentId]">) {
  if (!(await userWithPermission("payments"))) return new Response("not found", { status: 404 });

  const { paymentId } = await ctx.params;
  const payment = await db.payment.findUnique({ where: { id: paymentId }, select: { slipPath: true } });
  if (!payment) return new Response("not found", { status: 404 });

  const file = await getSlipStorage().get(payment.slipPath);
  if (!file) return new Response("slip file missing", { status: 404 });

  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.body.length),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${payment.slipPath}"`,
    },
  });
}

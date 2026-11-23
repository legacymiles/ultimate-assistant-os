import { errorResponse, HttpError, requireUser } from "@/lib/dtf/server/access";
import { confirmStripeReturn, customerView } from "@/lib/dtf/server/orders";
import { getOrder } from "@/lib/dtf/server/store";

export const dynamic = "force-dynamic";

/** One order. `?session_id=` confirms a Stripe payment on return, in case the webhook is slow or not set up. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    let order = await getOrder(id).catch(() => null);
    if (!order || order.userId !== user.id) throw new HttpError(404, "That order isn't in your account.");
    const session = new URL(req.url).searchParams.get("session_id");
    if (session) order = await confirmStripeReturn(order, session);
    return Response.json({ order: customerView(order) });
  } catch (e) {
    return errorResponse(e);
  }
}

import { markPaid, stripe, STRIPE_WEBHOOK_SECRET } from "@/lib/dtf/server/orders";
import { getOrderByStripeSession } from "@/lib/dtf/server/store";

export const dynamic = "force-dynamic";

/**
 * Stripe → "this order is paid". The signature is verified before anything is
 * read; an unsigned or wrongly signed request changes nothing. Idempotent:
 * Stripe retries, and a second delivery finds the order already paid.
 */
export async function POST(req: Request) {
  const s = stripe();
  if (!s || !STRIPE_WEBHOOK_SECRET) return Response.json({ error: "Stripe webhooks are not configured." }, { status: 503 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return Response.json({ error: "Missing signature." }, { status: 400 });
  const body = await req.text();
  let event;
  try {
    event = await s.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch {
    return Response.json({ error: "Bad signature." }, { status: 400 });
  }
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object;
    if (session.payment_status === "paid") {
      const order = await getOrderByStripeSession(session.id);
      if (order) await markPaid(order.id, "stripe", `Card payment confirmed (${session.id.slice(-8)}).`);
    }
  }
  return Response.json({ received: true });
}

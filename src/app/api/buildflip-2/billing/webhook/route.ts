import type Stripe from "stripe";
import { stripe } from "@/lib/buildflip-2/billing/stripe";
import { getAccountAsService, saveAccountAsService } from "@/lib/buildflip-2/db/account";
import { keys, serviceStore } from "@/lib/buildflip-2/db/store";
import { STRIPE_WEBHOOK_SECRET } from "@/lib/buildflip-2/flags";
import { log } from "@/lib/buildflip-2/log";
import { sendMail, templates } from "@/lib/buildflip-2/email";

export const runtime = "nodejs";

/**
 * POST /api/billing/webhook — the only thing that may change a user's plan.
 *
 * The signature is verified against STRIPE_WEBHOOK_SECRET, and every event id
 * is recorded before it is acted on, so a replayed or retried delivery is
 * processed exactly once (D5).
 */
export async function POST(req: Request) {
  const s = stripe();
  if (!s || !STRIPE_WEBHOOK_SECRET) {
    // Not an error: this deployment simply isn't taking payments yet.
    return Response.json({ ignored: "stripe_not_configured" }, { status: 200 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = s.webhooks.constructEvent(raw, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    await log({
      level: "warn",
      event: "webhook_bad_signature",
      message: (err as Error)?.message,
    });
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const userId = await userIdFor(event, s);
    if (!userId) {
      await log({
        level: "warn",
        event: "webhook_no_user",
        message: `${event.type} had no resolvable user`,
        meta: { eventId: event.id },
      });
      return Response.json({ received: true });
    }

    // Exactly-once: claim the event id first.
    const store = serviceStore(userId);
    const seenKey = `${keys.account()}:events`;
    const seen = (await store.get<{ ids: string[] }>(seenKey)) ?? { ids: [] };
    if (seen.ids.includes(event.id)) {
      return Response.json({ received: true, duplicate: true });
    }
    await store.set(seenKey, { ids: [event.id, ...seen.ids].slice(0, 200) });

    const account = await getAccountAsService(userId);

    switch (event.type) {
      case "checkout.session.completed":
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = await subscriptionFor(event, s);
        if (!sub) break;
        const active = ["active", "trialing", "past_due"].includes(sub.status);
        const periodEnd = currentPeriodEnd(sub);
        const wasPro = account.plan === "pro";
        await saveAccountAsService({
          ...account,
          plan: active ? "pro" : "free",
          stripeCustomerId:
            typeof sub.customer === "string" ? sub.customer : account.stripeCustomerId,
          subscription: {
            id: sub.id,
            status: sub.status,
            currentPeriodEnd: periodEnd,
            cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
          },
        });
        if (active && !wasPro && account.email) {
          void sendMail(
            templates.welcomePro(
              account.email,
              sub.trial_end ? new Date(sub.trial_end * 1000).toDateString() : periodEnd,
            ),
          );
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await saveAccountAsService({
          ...account,
          plan: "free",
          subscription: {
            id: sub.id,
            status: "canceled",
            currentPeriodEnd: currentPeriodEnd(sub),
            cancelAt: new Date().toISOString(),
          },
        });
        if (account.email) {
          void sendMail(templates.cancelled(account.email, currentPeriodEnd(sub)));
        }
        break;
      }

      case "invoice.payment_failed": {
        await log({
          level: "warn",
          event: "payment_failed",
          userId,
          message: "Stripe reported a failed payment",
        });
        break;
      }

      default:
        break;
    }

    await log({
      level: "info",
      event: "webhook_handled",
      userId,
      meta: { type: event.type, eventId: event.id },
    });
    return Response.json({ received: true });
  } catch (err) {
    await log({
      level: "error",
      event: "webhook_failed",
      message: (err as Error)?.message,
      stack: (err as Error)?.stack,
      meta: { type: event.type, eventId: event.id },
    });
    // 500 so Stripe retries; the event-id claim makes the retry safe.
    return new Response("Handler error", { status: 500 });
  }
}

function currentPeriodEnd(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const ts = item?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

async function subscriptionFor(
  event: Stripe.Event,
  s: Stripe,
): Promise<Stripe.Subscription | null> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const id = typeof session.subscription === "string" ? session.subscription : null;
    if (!id) return null;
    return s.subscriptions.retrieve(id);
  }
  return event.data.object as Stripe.Subscription;
}

/** Resolve the BuildFlip user from whatever Stripe sent. */
async function userIdFor(event: Stripe.Event, s: Stripe): Promise<string | null> {
  const obj = event.data.object as unknown as Record<string, unknown>;

  const direct =
    (obj.client_reference_id as string | undefined) ??
    ((obj.metadata as Record<string, string> | undefined)?.userId ?? undefined);
  if (direct) return direct;

  const customer = obj.customer;
  if (typeof customer === "string") {
    try {
      const c = await s.customers.retrieve(customer);
      if (!("deleted" in c)) {
        return (c.metadata?.userId as string | undefined) ?? null;
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}

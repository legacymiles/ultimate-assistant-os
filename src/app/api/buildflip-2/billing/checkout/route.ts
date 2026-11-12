import { fail, requireUser } from "@/lib/buildflip-2/api";
import { TRIAL_DAYS } from "@/lib/buildflip-2/billing/plans";
import {
  checkoutUrls,
  isTestMode,
  moneyOn,
  priceIdFor,
  stripe,
  stripeReady,
} from "@/lib/buildflip-2/billing/stripe";
import { saveAccount } from "@/lib/buildflip-2/db/account";
import { withLogging, log } from "@/lib/buildflip-2/log";
import { readJson } from "@/lib/buildflip-2/validate";
import { z } from "zod";

export const runtime = "nodejs";

const body = z.object({
  interval: z.enum(["month", "year"]).catch("month"),
  returnTo: z.string().max(200).optional(),
});

/**
 * POST /api/billing/checkout — start a subscription.
 *
 * With Stripe keys: a real Checkout session with the trial, promotion codes
 * enabled, and the exact first-charge date shown on Stripe's own page.
 * Without keys: a clearly-labelled SIMULATED upgrade so the whole path can be
 * walked end to end, and the response says plainly that no card was charged (R4).
 * Nothing is charged without the user confirming on Stripe's page (S7).
 */
export const POST = withLogging("checkout", async (req: Request) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  if (!moneyOn()) {
    return fail(400, "BuildFlip is free right now — there's nothing to buy.");
  }

  const parsed = await readJson(req, body);
  if (!parsed.ok) return fail(400, parsed.error);
  const { interval, returnTo } = parsed.data;

  if (auth.ctx.account.plan === "pro") {
    return Response.json({ alreadyPro: true });
  }

  const s = stripe();
  if (!s || !stripeReady()) {
    // Simulated upgrade — honest about what it is.
    await saveAccount({
      ...auth.ctx.account,
      plan: "pro",
      subscription: {
        id: "sim_" + Date.now().toString(36),
        status: "simulated",
        currentPeriodEnd: new Date(Date.now() + 30 * 864e5).toISOString(),
        cancelAt: null,
      },
    });
    await log({ level: "info", event: "checkout_simulated", userId: auth.ctx.user.id });
    return Response.json({
      simulated: true,
      message:
        "Pro is unlocked in demo mode — no card was asked for and nothing was charged. Add STRIPE_SECRET_KEY and STRIPE_PRICE_MONTHLY to take real payments.",
    });
  }

  const price = priceIdFor(interval);
  if (!price) {
    return fail(
      503,
      interval === "year"
        ? "Annual billing isn't set up yet. Monthly works."
        : "Checkout isn't configured yet.",
    );
  }

  try {
    let customerId = auth.ctx.account.stripeCustomerId;
    if (!customerId) {
      const customer = await s.customers.create({
        email: auth.ctx.user.email,
        metadata: { userId: auth.ctx.user.id },
      });
      customerId = customer.id;
      await saveAccount({ ...auth.ctx.account, stripeCustomerId: customerId });
    }

    const urls = checkoutUrls(returnTo ?? "/apps/buildflip-2/board");
    const session = await s.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { userId: auth.ctx.user.id },
      },
      client_reference_id: auth.ctx.user.id,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      success_url: urls.success,
      cancel_url: urls.cancel,
      metadata: { userId: auth.ctx.user.id },
    });

    return Response.json({ url: session.url, testMode: isTestMode() });
  } catch (err) {
    await log({
      level: "error",
      event: "checkout_failed",
      userId: auth.ctx.user.id,
      message: (err as Error)?.message,
    });
    return fail(
      502,
      "We couldn't open checkout. You haven't been charged — try again in a moment.",
    );
  }
});

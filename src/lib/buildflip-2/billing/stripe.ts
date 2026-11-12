import Stripe from "stripe";
import {
  MONETIZATION_ENABLED,
  STRIPE_PRICE_ANNUAL,
  STRIPE_PRICE_MONTHLY,
  STRIPE_SECRET,
  appUrl,
} from "../flags";

/**
 * Stripe, wired and ready. With no STRIPE_SECRET_KEY the app does not crash and
 * does not hide the money layer either — it runs a clearly-labelled simulated
 * checkout so the whole upgrade path can be walked and tested, and says plainly
 * that no card was charged (R4).
 *
 * The secret key never leaves the server (S1). Webhook signatures are verified
 * and each event is handled exactly once (D5).
 *
 * Inside the hub the money layer is OFF by default (`MONETIZATION_ENABLED` in
 * ../flags) because every app here is free. Turning it on needs one more thing
 * than an env var: the hub's middleware puts every path behind the owner's
 * session, so `/api/buildflip-2/billing/webhook` would have to be added to
 * `TOKEN_AUTH_PATHS` in `src/middleware.ts` before Stripe could reach it.
 */

let client: Stripe | null = null;

export function stripe(): Stripe | null {
  if (!STRIPE_SECRET) return null;
  if (!client) {
    client = new Stripe(STRIPE_SECRET, {
      apiVersion: "2025-08-27.basil",
      appInfo: { name: "BuildFlip 2" },
    });
  }
  return client;
}

export function stripeReady() {
  return Boolean(STRIPE_SECRET && STRIPE_PRICE_MONTHLY);
}

export function moneyOn() {
  return MONETIZATION_ENABLED;
}

export function priceIdFor(interval: "month" | "year"): string | undefined {
  return interval === "year" ? STRIPE_PRICE_ANNUAL : STRIPE_PRICE_MONTHLY;
}

export function checkoutUrls(returnTo = "/apps/buildflip-2/board") {
  const back = encodeURIComponent(returnTo);
  return {
    success: `${appUrl("/upgraded")}?session_id={CHECKOUT_SESSION_ID}&next=${back}`,
    cancel: `${appUrl("/pricing")}?cancelled=1`,
  };
}

/** Is this Stripe account in test mode? Used to label the UI honestly. */
export function isTestMode() {
  return Boolean(STRIPE_SECRET?.startsWith("sk_test_"));
}

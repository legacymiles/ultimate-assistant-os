/**
 * One place that answers "what is actually connected?".
 *
 * Nothing in this app throws because a key is missing (R4). Every capability
 * degrades to a visible, honest demo mode and says what connecting it unlocks.
 * These helpers are server-safe; the client gets the same answers through
 * `/api/buildflip-2/capabilities`.
 *
 * Moved into the hub: Supabase comes from the hub's own config, the AI key is
 * whichever provider `src/lib/ai/provider.ts` can reach, and every URL this
 * builds is relative to the app's route rather than a site root. Deliberately
 * free of imports from `provider.ts` — this module is read by server pages and
 * its `Capabilities` type by client components, and a key check is an env read
 * either way.
 */

import { SUPABASE_ANON_KEY, SUPABASE_URL as HUB_SUPABASE_URL } from "@/lib/supabase/config";

const env = (k: string) => {
  const v = process.env[k];
  return v && v.trim().length > 0 ? v.trim() : undefined;
};

/** Where this app lives inside the hub. Every internal link is built from it. */
export const BASE = "/apps/buildflip-2";
/** Where this app's server routes live. */
export const API_BASE = "/api/buildflip-2";

export const SUPABASE_URL = HUB_SUPABASE_URL || undefined;
export const SUPABASE_ANON = SUPABASE_ANON_KEY || undefined;
export const SUPABASE_SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");

/**
 * True when the hub can reach any AI provider. The app no longer holds an
 * OpenRouter client of its own — every call goes through `aiFetch`, which picks
 * the provider and the model — so "is live research on?" is "is one of the
 * hub's three provider keys set?".
 */
export const AI_KEY =
  env("OPENROUTER_API_KEY") ?? env("AI_GATEWAY_API_KEY") ?? env("ORCAROUTER_API_KEY") ?? env("VERCEL_OIDC_TOKEN");

export const STRIPE_SECRET = env("STRIPE_SECRET_KEY");
export const STRIPE_WEBHOOK_SECRET = env("STRIPE_WEBHOOK_SECRET");
export const STRIPE_PRICE_MONTHLY = env("STRIPE_PRICE_MONTHLY");
export const STRIPE_PRICE_ANNUAL = env("STRIPE_PRICE_ANNUAL");

export const RESEND_KEY = env("RESEND_API_KEY");
export const EMAIL_FROM = env("EMAIL_FROM") ?? "BuildFlip <hello@buildflip.app>";

export const OWNER_EMAIL = (
  env("OWNER_EMAIL") ??
  // The hub already knows who the owner is; falling back to its list means
  // BuildFlip needs no key of its own to work out who the admin page is for.
  (env("HUB_OWNER_EMAILS") ?? "jackstaxx25@gmail.com").split(/[,\s]+/)[0]
).toLowerCase();

/**
 * The money layer.
 *
 * OFF by default here, which is the difference between this and the stand-alone
 * site. Every app on this hub is free — no prices, no paywalls (the owner's
 * rule; Cook Connect's `MONETIZATION_ENABLED` is the same switch). The Stripe
 * plumbing is kept wired behind it so turning it back on is one env var rather
 * than a rebuild.
 */
export const MONETIZATION_ENABLED = (env("MONETIZATION_ENABLED") ?? "false") !== "false";

export const STORAGE_BUCKET = env("STORAGE_BUCKET") ?? "buildflip-refs";

export function siteUrl(): string {
  const explicit = env("NEXT_PUBLIC_SITE_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = env("VERCEL_PROJECT_PRODUCTION_URL") ?? env("VERCEL_URL");
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/** An absolute URL to a page of this app — for emails and Stripe redirects. */
export function appUrl(path = ""): string {
  return `${siteUrl()}${BASE}${path}`;
}

export interface Capabilities {
  /** Accounts, sync across devices, per-user data. */
  auth: boolean;
  /** Where plans are stored. false = this browser only. */
  database: boolean;
  /** Reference photo upload. */
  storage: boolean;
  /** Live web search for prices and sold comps. false = demo catalog. */
  liveResearch: boolean;
  /** Real card checkout. false = simulated upgrade, clearly labelled. */
  payments: boolean;
  /** Account emails. false = logged to the server console. */
  email: boolean;
  monetization: boolean;
}

export function capabilities(): Capabilities {
  const db = Boolean(SUPABASE_URL && SUPABASE_ANON);
  return {
    auth: db,
    database: db,
    storage: Boolean(db && SUPABASE_SERVICE),
    liveResearch: Boolean(AI_KEY),
    payments: Boolean(STRIPE_SECRET && STRIPE_PRICE_MONTHLY),
    email: Boolean(RESEND_KEY),
    monetization: MONETIZATION_ENABLED,
  };
}

/** What each missing key unlocks, in plain English, for the demo-mode banner. */
export const CAPABILITY_COPY: Record<
  keyof Omit<Capabilities, "monetization">,
  { label: string; unlocks: string; key: string }
> = {
  auth: {
    label: "Accounts",
    unlocks: "sign in, and your plans follow you between phone and laptop",
    key: "NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY",
  },
  database: {
    label: "Saved plans",
    unlocks: "plans saved to your account instead of just this browser",
    key: "NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY",
  },
  storage: {
    label: "Reference photos",
    unlocks: "uploading your own reference photos",
    key: "SUPABASE_SERVICE_ROLE_KEY",
  },
  liveResearch: {
    label: "Live prices",
    unlocks: "real current prices and real sold listings instead of the demo catalog",
    key: "OPENROUTER_API_KEY",
  },
  payments: {
    label: "Checkout",
    unlocks: "paying by card — upgrades are simulated until this is set",
    key: "STRIPE_SECRET_KEY + STRIPE_PRICE_MONTHLY",
  },
  email: {
    label: "Account emails",
    unlocks: "welcome and receipt emails actually being sent",
    key: "RESEND_API_KEY",
  },
};

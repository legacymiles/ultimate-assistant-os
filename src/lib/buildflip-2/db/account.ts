import { MONETIZATION_ENABLED } from "../flags";
import { FREE_PLAN_LIMIT, type Account } from "../types";
import { isOwnerEmail } from "./owner";
import { keys, userStore, serviceStore } from "./store";

/**
 * The account record: plan, role, how many plans they've generated (which is
 * what the paywall turns on), and their settings.
 */

export function blankAccount(userId: string, email: string): Account {
  const now = new Date().toISOString();
  return {
    userId,
    email,
    plan: "free",
    role: isOwnerEmail(email) ? "admin" : "user",
    plansGenerated: 0,
    stripeCustomerId: null,
    subscription: null,
    hourlyTarget: 25,
    theme: "dark",
    emailOptIn: false,
    onboarded: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getAccount(
  userId: string,
  email: string,
): Promise<Account> {
  const store = await userStore(userId);
  if (!store) return blankAccount(userId, email);
  const existing = await store.get<Account>(keys.account());
  if (!existing) {
    const fresh = blankAccount(userId, email);
    await store.set(keys.account(), fresh);
    return fresh;
  }
  // Role and email are re-derived every read so ownership can never be
  // smuggled in by writing to the record (S3).
  return {
    ...blankAccount(userId, email),
    ...existing,
    userId,
    email,
    role: isOwnerEmail(email) ? "admin" : "user",
  };
}

export async function saveAccount(account: Account): Promise<void> {
  const store = await userStore(account.userId);
  if (!store) return;
  await store.set(keys.account(), { ...account, updatedAt: new Date().toISOString() });
}

/** Service-role write, for the Stripe webhook which has no user session. */
export async function saveAccountAsService(account: Account): Promise<void> {
  const store = serviceStore(account.userId);
  await store.set(keys.account(), { ...account, updatedAt: new Date().toISOString() });
}

export async function getAccountAsService(
  userId: string,
  email = "",
): Promise<Account> {
  const store = serviceStore(userId);
  const existing = await store.get<Account>(keys.account());
  return existing ?? blankAccount(userId, email);
}

export interface Entitlement {
  canGenerate: boolean;
  plansRemaining: number;
  plan: Account["plan"];
  /** Why they can't, in words the paywall shows. */
  reason?: string;
}

/**
 * The one place that decides whether a plan may be generated. Checked on the
 * SERVER before any paid work happens — hiding the button is not a check (S3).
 */
export function entitlement(account: Account): Entitlement {
  // Free on this hub. With the money layer off there is no plan to buy, so
  // there is no limit to enforce either — a paywall nobody can pay is just a
  // dead end. Flip MONETIZATION_ENABLED and the free tier comes back exactly
  // as the stand-alone site had it.
  if (!MONETIZATION_ENABLED) {
    return { canGenerate: true, plansRemaining: Infinity, plan: "pro" };
  }
  if (account.plan === "pro") {
    return { canGenerate: true, plansRemaining: Infinity, plan: "pro" };
  }
  const used = account.plansGenerated;
  const remaining = Math.max(0, FREE_PLAN_LIMIT - used);
  if (remaining > 0) {
    return { canGenerate: true, plansRemaining: remaining, plan: "free" };
  }
  return {
    canGenerate: false,
    plansRemaining: 0,
    plan: "free",
    reason:
      "You've used your free plan. BuildFlip Pro unlocks unlimited plans, live re-pricing and real-cost tracking.",
  };
}

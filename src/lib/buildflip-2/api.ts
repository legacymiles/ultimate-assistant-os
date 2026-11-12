import { getAccount } from "./db/account";
import { isOwnerEmail, ownerUserId } from "./db/owner";
import { capabilities } from "./flags";
import { log } from "./log";
import { callerIp, rateLimit, type LIMITS } from "./rate-limit";
import { currentUser, type SessionUser } from "./supabase/server";
import type { Account } from "./types";

/**
 * Shared route plumbing: authentication, authorisation, rate limiting and
 * plain-English error envelopes. Every API route goes through here so none of
 * them can forget a check.
 */

export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json(data as object, { status: 200, ...init });
}

export function fail(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
) {
  return Response.json({ error, ...extra }, { status });
}

export const NEEDS_ACCOUNT =
  "Sign in to save this — it takes one tap and keeps your plans on every device.";

export interface Ctx {
  user: SessionUser;
  account: Account;
}

/** Require a signed-in user. Returns a 401 with a next step, never a bare code. */
export async function requireUser(): Promise<
  { ok: true; ctx: Ctx } | { ok: false; response: Response }
> {
  if (!capabilities().auth) {
    return {
      ok: false,
      response: fail(503, "Accounts aren't connected on this deployment yet.", {
        demo: true,
      }),
    };
  }
  const user = await currentUser();
  if (!user) {
    return { ok: false, response: fail(401, NEEDS_ACCOUNT, { needsAuth: true }) };
  }
  const account = await getAccount(user.id, user.email);
  return { ok: true, ctx: { user, account } };
}

/**
 * Require the owner. Checked on the SERVER against OWNER_EMAIL — hiding the
 * admin link in the nav is not a check (S3).
 */
export async function requireOwner(): Promise<
  { ok: true; ctx: Ctx } | { ok: false; response: Response }
> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!isOwnerEmail(auth.ctx.user.email)) {
    await log({
      level: "warn",
      event: "admin_denied",
      userId: auth.ctx.user.id,
      message: "Non-owner requested an admin route",
    });
    return { ok: false, response: fail(404, "Not found.") };
  }
  return auth;
}

/**
 * Consume a rate-limit unit for a signed-in user.
 *
 * `costly` marks a route that spends real money per call. For those, a limiter
 * that has degraded to in-process counting is NOT good enough — on serverless
 * that is one bucket per instance — so we fail closed rather than quietly
 * letting someone run up the bill (S5).
 */
export async function guardRate(
  userId: string,
  name: keyof typeof LIMITS,
  opts: { costly?: boolean } = {},
): Promise<Response | null> {
  const owner = await ownerUserId();
  const result = await rateLimit(`u:${userId}`, name, owner);

  if (opts.costly && result.degraded) {
    await log({
      level: "error",
      event: "rate_limit_unavailable",
      userId,
      message: `Refused ${name}: no shared rate-limit store, so the spend ceiling can't be enforced.`,
    });
    return fail(
      503,
      "We can't run that safely right now — a service we depend on is unavailable. Nothing was charged or lost. Try again in a few minutes.",
    );
  }

  if (!result.ok) {
    return fail(429, result.message ?? "Too many requests. Try again shortly.", {
      resetAt: result.resetAt,
    });
  }
  return null;
}

/** Consume a rate-limit unit for an anonymous caller, keyed on IP. */
export async function guardRateIp(
  req: Request,
  name: keyof typeof LIMITS,
): Promise<Response | null> {
  const owner = await ownerUserId();
  const result = await rateLimit(`ip:${callerIp(req)}`, name, owner);
  if (!result.ok) {
    return fail(429, result.message ?? "Too many requests. Try again shortly.", {
      resetAt: result.resetAt,
    });
  }
  return null;
}

/** Stable hash for lead emails, so we never store a raw address as a key. */
export async function hashEmail(email: string): Promise<string> {
  const data = new TextEncoder().encode(`buildflip:${email.toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

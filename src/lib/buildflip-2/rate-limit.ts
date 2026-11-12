/**
 * Rate limiting for anything that costs money per use (S5).
 *
 * Plan generation and repricing call a paid web-search model, so they are
 * capped per user AND per IP. Limits live in the database when one is
 * connected (so they survive a cold start and work across instances) and fall
 * back to an in-process window otherwise.
 */

import { log } from "./log";
import { supabaseService } from "./supabase/service";

export interface Limit {
  /** How many calls allowed in the window. */
  max: number;
  /** Window length in seconds. */
  windowSec: number;
}

export const LIMITS = {
  /** Plan generation — the expensive one. */
  generate: { max: 8, windowSec: 60 * 60 } satisfies Limit,
  /** Re-pricing an existing plan. */
  reprice: { max: 12, windowSec: 60 * 60 } satisfies Limit,
  /** Anonymous/IP ceiling across everything paid. */
  anonGenerate: { max: 3, windowSec: 60 * 60 } satisfies Limit,
  upload: { max: 60, windowSec: 60 * 60 } satisfies Limit,
  write: { max: 300, windowSec: 60 * 60 } satisfies Limit,
  lead: { max: 5, windowSec: 60 * 60 } satisfies Limit,
} as const;

export interface RateResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
  /** Plain-English message when blocked (R3). */
  message?: string;
  /**
   * True when the count is only held in this process. On serverless that means
   * one bucket per instance, i.e. barely a limit at all — so routes that spend
   * money refuse rather than accept a limit they can't actually enforce.
   */
  degraded?: boolean;
}

const local = new Map<string, { hits: number[]; }>();

function localCheck(id: string, limit: Limit): RateResult {
  const now = Date.now();
  const since = now - limit.windowSec * 1000;
  const entry = local.get(id) ?? { hits: [] };
  entry.hits = entry.hits.filter((t) => t > since);
  if (entry.hits.length >= limit.max) {
    local.set(id, entry);
    const resetAt = (entry.hits[0] ?? now) + limit.windowSec * 1000;
    return {
      ok: false,
      remaining: 0,
      resetAt,
      message: blockedMessage(resetAt),
    };
  }
  entry.hits.push(now);
  local.set(id, entry);
  // marked degraded by the caller — see rateLimit()
  // Keep the map from growing without bound on a long-lived instance.
  if (local.size > 5000) {
    for (const [k, v] of local) {
      if (v.hits.every((t) => t <= since)) local.delete(k);
      if (local.size <= 2500) break;
    }
  }
  return {
    ok: true,
    remaining: limit.max - entry.hits.length,
    resetAt: now + limit.windowSec * 1000,
    degraded: true,
  };
}

function blockedMessage(resetAt: number) {
  const mins = Math.max(1, Math.ceil((resetAt - Date.now()) / 60000));
  return `You've hit the hourly limit on this. It opens up again in about ${mins} minute${
    mins === 1 ? "" : "s"
  } — nothing you've made is lost.`;
}

/**
 * Consume one unit of a limit. `scope` should already include whether this is
 * a user id or an IP so the two never share a bucket.
 */
export async function rateLimit(
  scope: string,
  name: keyof typeof LIMITS,
  ownerIdForStorage?: string | null,
): Promise<RateResult> {
  const limit = LIMITS[name];
  const id = `${name}:${scope}`;

  const sb = supabaseService();
  if (!sb || !ownerIdForStorage) {
    await log({
      level: "warn",
      event: "rate_limit_degraded",
      message:
        "No shared store for rate limits — counting in-process only. Expensive routes will refuse.",
      meta: { limit: name },
    });
    return localCheck(id, limit);
  }

  try {
    const key = `bf:rate:${id}`;
    const now = Date.now();
    const since = now - limit.windowSec * 1000;

    const { data } = await sb
      .from("app_state")
      .select("data")
      .eq("user_id", ownerIdForStorage)
      .eq("key", key)
      .maybeSingle();

    const hits: number[] = ((data?.data as { hits?: number[] } | null)?.hits ?? []).filter(
      (t) => typeof t === "number" && t > since,
    );

    if (hits.length >= limit.max) {
      const resetAt = (hits[0] ?? now) + limit.windowSec * 1000;
      return { ok: false, remaining: 0, resetAt, message: blockedMessage(resetAt) };
    }

    hits.push(now);
    await sb.from("app_state").upsert(
      {
        user_id: ownerIdForStorage,
        key,
        data: { hits: hits.slice(-limit.max * 2) },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,key" },
    );

    /**
     * Read back and re-judge. This is a read-modify-write, so two concurrent
     * callers can both see a count under the limit. Re-reading after writing
     * catches the loser of that race: if the stored window is now over the
     * limit, the request that is reading it is the one that should back off.
     * It narrows the window from "unbounded" to "one extra call".
     */
    const { data: after } = await sb
      .from("app_state")
      .select("data")
      .eq("user_id", ownerIdForStorage)
      .eq("key", key)
      .maybeSingle();
    const settled: number[] = ((after?.data as { hits?: number[] } | null)?.hits ?? []).filter(
      (t) => typeof t === "number" && t > since,
    );
    if (settled.length > limit.max) {
      const resetAt = (settled[0] ?? now) + limit.windowSec * 1000;
      return { ok: false, remaining: 0, resetAt, message: blockedMessage(resetAt) };
    }

    return {
      ok: true,
      remaining: Math.max(0, limit.max - settled.length),
      resetAt: now + limit.windowSec * 1000,
    };
  } catch (err) {
    await log({
      level: "warn",
      event: "rate_limit_fallback",
      message: (err as Error)?.message,
    });
    return localCheck(id, limit);
  }
}

/**
 * The caller's IP, taken from a header the CLIENT cannot forge.
 *
 * `x-forwarded-for` is appended to by each proxy, so its LEFTMOST entry is
 * whatever the client sent — trusting it means anyone can rotate into a fresh
 * rate-limit bucket by sending a random value. The rightmost entry is the one
 * our own edge appended, so that is the one to use. Vercel's
 * `x-vercel-forwarded-for` is set by the platform and is better still.
 */
export function callerIp(req: Request): string {
  const h = req.headers;

  const platform = h.get("x-vercel-forwarded-for") ?? h.get("cf-connecting-ip");
  if (platform) return platform.trim();

  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    // Rightmost = appended by the hop closest to us = not client-controlled.
    if (parts.length) return parts[parts.length - 1]!;
  }

  return h.get("x-real-ip")?.trim() ?? "unknown";
}

import "server-only";

import { cookies } from "next/headers";
import { isConnectable, type ConnectablePlatform } from "../types";

/** A platform whose login is wired up here, or null. */
export function asPlatform(v: string | undefined): ConnectablePlatform | null {
  return v && isConnectable(v) ? v : null;
}

/** The hub account id (middleware stamps it); "local" in no-auth dev. */
export async function viewerUid(): Promise<string> {
  return (await cookies()).get("hub_uid")?.value ?? "local";
}

/** Public origin for OAuth redirect URIs — must match what's registered with the platform. */
export function publicOrigin(req: Request): string {
  const forced = process.env.SOCIAL_OAUTH_ORIGIN?.replace(/\/$/, "");
  if (forced) return forced;
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, ...extra }, { status });
}

export async function body(req: Request): Promise<Record<string, any> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}

/**
 * A small in-process limit on the calls that cost money.
 *
 * In-memory, so it resets on a cold start and is per-instance — which is
 * honest about what it is: a guard against a loop in the UI firing the same
 * paid call fifty times, not a security boundary.
 */
const hits = new Map<string, number[]>();

export function withinRate(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}

export function tooMany(what: string) {
  return fail(429, `That's a lot of ${what} in a short time, so the rest are on hold for a minute. Nothing was lost — try again shortly.`);
}

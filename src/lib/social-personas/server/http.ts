import "server-only";

import { cookies } from "next/headers";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "../types";

export function asPlatform(v: string | undefined): SocialPlatform | null {
  return (SOCIAL_PLATFORMS as string[]).includes(v ?? "") ? (v as SocialPlatform) : null;
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

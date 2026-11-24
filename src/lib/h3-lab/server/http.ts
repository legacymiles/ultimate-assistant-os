import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { uidForWorkerToken } from "./store";

// Who is asking. Browser routes are owner-only in middleware, which stamps the
// owner's id into the hub_uid cookie. Worker routes are session-exempt by
// exact path and carry the worker's bearer token instead.

export async function sessionUid(): Promise<string> {
  return (await cookies()).get("hub_uid")?.value ?? "local";
}

function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

export async function workerUid(req: Request): Promise<string | null> {
  return uidForWorkerToken(bearer(req));
}

/** The scheduled tick's own secret (GitHub Actions), compared in constant time. */
export function isTickToken(req: Request): boolean {
  const want = process.env.H3LAB_TICK_TOKEN ?? "";
  const got = bearer(req);
  if (!want || !got) return false;
  const a = createHash("sha256").update(want).digest();
  const b = createHash("sha256").update(got).digest();
  return timingSafeEqual(a, b);
}

export function unauthorized() {
  return NextResponse.json({ error: "Unknown worker token. Create one in H3 Prompt Lab › H3 Connection." }, { status: 401 });
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

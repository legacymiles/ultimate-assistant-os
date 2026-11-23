// ---------------------------------------------------------------------------
// Who is asking, and what they may touch.
//
// Three callers, three gates:
//   customer — any signed-in account; sees only rows whose user_id is theirs
//   owner    — HUB_OWNER_EMAILS; runs production
//   station  — the Windows print-station companion; a bearer token whose
//              SHA-256 is stored server-side (never the token itself)
//
// Local development without Supabase has no accounts at all. There, everyone
// is one local account that is also the owner — the same rule the rest of the
// hub follows (no keys = the whole hub is the developer's own).
// ---------------------------------------------------------------------------

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isOwner, parseOwnerEmails } from "@/lib/hubAccess";
import { getStation, putStation } from "./store";

export interface Caller {
  id: string;
  email: string;
  owner: boolean;
  /** True when Supabase is not configured and this is the local developer. */
  local: boolean;
}

export const LOCAL_USER_ID = "local-dev-account";

export async function caller(): Promise<Caller | null> {
  if (!isSupabaseConfigured()) {
    return { id: LOCAL_USER_ID, email: "local@dtf.studio", owner: true, local: true };
  }
  const sb = await getSupabaseServerClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user) return null;
    const email = data.user.email ?? "";
    return { id: data.user.id, email, owner: isOwner(email, parseOwnerEmails(process.env.HUB_OWNER_EMAILS)), local: false };
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser(): Promise<Caller> {
  const c = await caller();
  if (!c) throw new HttpError(401, "Sign in to save designs and place orders.");
  return c;
}

export async function requireOwner(): Promise<Caller> {
  const c = await requireUser();
  if (!c.owner) throw new HttpError(403, "Production is for the shop owner only.");
  return c;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Verify the station's bearer token. Records the heartbeat on success. */
export async function requireStation(req: Request): Promise<void> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Missing station token.");
  const rec = await getStation();
  if (!rec) throw new HttpError(401, "No print station is paired. Pair one from the production dashboard.");
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(rec.tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "Station token is not valid.");
  const host = req.headers.get("x-dtf-station-host") ?? undefined;
  const exportDir = req.headers.get("x-dtf-export-dir") ?? undefined;
  // Heartbeat at most once a minute — this runs on every poll.
  if (!rec.lastSeenAt || Date.now() - Date.parse(rec.lastSeenAt) > 60_000) {
    await putStation({ ...rec, lastSeenAt: new Date().toISOString(), lastSeenHost: host ?? rec.lastSeenHost, exportDir: exportDir ?? rec.exportDir });
  }
}

/** Turn a thrown error into a JSON response with a plain-English message. */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  const message = err instanceof Error ? err.message : "Something went wrong.";
  console.error("[dtf]", err);
  return Response.json({ error: message }, { status: 500 });
}

export function newId(prefix = ""): string {
  const raw = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  return prefix ? `${prefix}_${raw}` : raw;
}

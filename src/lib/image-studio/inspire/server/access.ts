// ---------------------------------------------------------------------------
// Who is asking Inspire, and what they may touch.
//
//   visitor  — anyone; may browse public images and read their prompts
//   member   — any signed-in account; owns a private library, collections,
//              uploads and generations, and may publish
//   owner    — HUB_OWNER_EMAILS; unlimited AI and the Moderation tab
//
// Without Supabase there are no accounts: everyone is one local account that is
// also the owner, the rule the rest of the hub follows with no keys set.
// ---------------------------------------------------------------------------

import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isOwner, parseOwnerEmails } from "@/lib/hubAccess";

export interface Caller {
  id: string;
  email: string;
  owner: boolean;
  local: boolean;
}

export const LOCAL_USER_ID = "local-inspire-account";

export async function caller(): Promise<Caller | null> {
  if (!isSupabaseConfigured()) {
    return { id: LOCAL_USER_ID, email: "you@this-computer", owner: true, local: true };
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
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireUser(action = "do that"): Promise<Caller> {
  const c = await caller();
  if (!c) throw new HttpError(401, `Sign in to ${action}.`);
  return c;
}

export async function requireOwner(): Promise<Caller> {
  const c = await requireUser("moderate");
  if (!c.owner) throw new HttpError(403, "Moderation is for the studio owner only.");
  return c;
}

/** A thrown error as JSON with a plain-English message. */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  const message = err instanceof Error ? err.message : "Something went wrong.";
  console.error("[inspire]", err);
  return Response.json({ error: message }, { status: 500 });
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "That request couldn't be read.");
  }
}

export function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

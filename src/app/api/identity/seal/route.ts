import { NextResponse } from "next/server";
import { callerIsMember } from "@/lib/recall/lists/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { configured, open, seal } from "@/lib/identity/server/seal";

// ---------------------------------------------------------------------------
// Seal / open the owner's face data (see lib/identity/server/seal.ts).
//
// Owner only: a family member signed in to Lists can never read or write it.
// The plaintext exists here only for the length of the request; nothing is
// logged and nothing is stored server-side.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

/** 6 MB of JSON is ~200 reference faces at 256px — far past MAX refs per person. */
const MAX_BYTES = 6_000_000;

/**
 * Whose face data this is. With accounts configured, a signed-in user is
 * required (null → 401): the server key must never seal or open for an
 * anonymous caller. Without Supabase (a local, single-user hub) it is "local".
 */
async function account(): Promise<string | null> {
  const db = await getSupabaseServerClient().catch(() => null);
  if (!db) return "local";
  const { data } = await db.auth.getUser();
  return data?.user?.id ?? null;
}

export async function GET() {
  if (await callerIsMember()) return NextResponse.json({ error: "Not shared." }, { status: 403 });
  return NextResponse.json({ configured: configured() });
}

export async function POST(req: Request) {
  if (await callerIsMember()) return NextResponse.json({ error: "Not shared." }, { status: 403 });
  if (!configured()) return NextResponse.json({ configured: false }, { status: 200 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Too much face data in one request." }, { status: 413 });
  let body: { op?: string; data?: unknown; sealed?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const who = await account();
  if (!who) return NextResponse.json({ error: "Sign in to use face data." }, { status: 401 });
  try {
    if (body.op === "seal" && typeof body.data === "string") return NextResponse.json({ configured: true, sealed: seal(body.data, who) });
    if (body.op === "open" && typeof body.sealed === "string") return NextResponse.json({ configured: true, data: open(body.sealed, who) });
  } catch {
    // A blob sealed with an old key or for another account: say so, never 500.
    return NextResponse.json({ configured: true, error: "This face data could not be opened (the key changed?). It will be rebuilt from the profile photos." });
  }
  return NextResponse.json({ error: "op must be seal or open" }, { status: 400 });
}

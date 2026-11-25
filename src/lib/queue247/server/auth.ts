import "server-only";

// ---------------------------------------------------------------------------
// Who is calling the 24/7 Queue API.
//
//   ownerOrUser()  — the browser: the signed-in Supabase account (the same id
//                    In Queue uses, so tasks follow the account everywhere).
//   appCaller()    — an outside website: `Authorization: Bearer q247_…`, a
//                    key the owner created in 24/7 Queue › Apps. Only the
//                    sha256 is stored; the key is bound to one app and one
//                    account.
// ---------------------------------------------------------------------------

import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";
import { NO_DB_MESSAGE, queueDb, queueDbConfigured } from "./db";
import { StoreError } from "./store";
import { ActionError, TaskInputError } from "../engine";

export type Who = { uid: string } | { error: NextResponse };

export async function signedIn(): Promise<Who> {
  if (!queueDbConfigured()) return { error: NextResponse.json({ error: NO_DB_MESSAGE, offline: true }, { status: 503 }) };
  let uid = await browserUid();
  if (!uid) return { error: NextResponse.json({ error: "Sign in to use your 24/7 Queue." }, { status: 401 }) };
  // Local demo mode only (no public Supabase keys, so no sign-in exists at all —
  // never the case on a deployed site): a preview server can be pointed at one
  // account's real queue with QUEUE_LOCAL_UID to look at it.
  if (uid === "local" && process.env.QUEUE_LOCAL_UID && process.env.NODE_ENV !== "production") uid = process.env.QUEUE_LOCAL_UID;
  return { uid };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function newAppKey(): { key: string; prefix: string; hash: string } {
  const key = `q247_${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashKey(key) };
}

export type AppWho = { uid: string; appId: string } | { error: NextResponse };

export async function appCaller(req: Request): Promise<AppWho> {
  if (!queueDbConfigured()) return { error: NextResponse.json({ error: NO_DB_MESSAGE }, { status: 503 }) };
  const header = req.headers.get("authorization") ?? "";
  const key = header.replace(/^Bearer\s+/i, "").trim();
  if (!key.startsWith("q247_")) {
    return { error: NextResponse.json({ error: "Send your 24/7 Queue app key as 'Authorization: Bearer q247_…'." }, { status: 401 }) };
  }
  const db = queueDb();
  const { data } = await db
    .from("queue_app_keys")
    .select("id,user_id,app_id")
    .eq("key_hash", hashKey(key))
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return { error: NextResponse.json({ error: "That app key is not valid or was revoked." }, { status: 401 }) };
  const row = data as { id: string; user_id: string; app_id: string };
  const now = new Date().toISOString();
  await db.from("queue_app_keys").update({ last_used_at: now }).eq("id", row.id);
  await db.from("queue_apps").update({ last_seen_at: now }).eq("user_id", row.user_id).eq("id", row.app_id);
  return { uid: row.user_id, appId: row.app_id };
}

/** Plain-English errors for every route: input problems 400, the rest 500. */
export function errorJson(e: unknown): NextResponse {
  if (e instanceof TaskInputError || e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error("[queue247]", e);
  return NextResponse.json({ error: (e as Error)?.message || "Something went wrong in the 24/7 Queue." }, { status: 500 });
}

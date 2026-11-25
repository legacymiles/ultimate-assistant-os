// 24/7 Queue public API v1 — the calling app describes itself.
// GET  → this app's record, as the queue sees it.
// POST { name?, url?, description?, capabilities?, callback_url? } → updates it.
//      Call on start-up so the queue always knows what the app can do.

import { NextResponse } from "next/server";
import { appCaller, errorJson } from "@/lib/queue247/server/auth";
import { queueDb } from "@/lib/queue247/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function https(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.hostname === "localhost" ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const who = await appCaller(req);
  if ("error" in who) return who.error;
  const { data } = await queueDb().from("queue_apps").select("*").eq("user_id", who.uid).eq("id", who.appId).maybeSingle();
  return NextResponse.json({ app: data });
}

export async function POST(req: Request) {
  const who = await appCaller(req);
  if ("error" in who) return who.error;
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
    if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 80);
    if (typeof b.description === "string") patch.description = b.description.slice(0, 600);
    if (Array.isArray(b.capabilities)) patch.capabilities = b.capabilities.map(String).slice(0, 20);
    const url = https(b.url);
    if (url !== undefined) patch.url = url;
    const cb = https(b.callback_url);
    if (cb !== undefined) patch.callback_url = cb;
    const { data, error } = await queueDb().from("queue_apps").update(patch).eq("user_id", who.uid).eq("id", who.appId).select("*").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ app: data });
  } catch (e) {
    return errorJson(e);
  }
}

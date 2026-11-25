// Connected apps — the owner's side.
// GET  → hub apps (from the catalog, automatic) + outside apps + their keys (prefix only).
// POST { action: "register", id, name, url?, description?, capabilities?, callback_url? }
//        → the app and a NEW key, shown once.
//      { action: "new_key", id } → another key for that app, shown once.
//      { action: "revoke", keyId } · { action: "remove", id }

import { NextResponse } from "next/server";
import { errorJson, newAppKey, signedIn } from "@/lib/queue247/server/auth";
import { queueDb } from "@/lib/queue247/server/db";
import { listExternalApps } from "@/lib/queue247/server/store";
import { allApps } from "@/lib/queue247/apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;

function cleanUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.hostname === "localhost" ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const who = await signedIn();
  if ("error" in who) return who.error;
  try {
    const db = queueDb();
    const external = await listExternalApps(db, who.uid);
    const { data: keys } = await db
      .from("queue_app_keys")
      .select("id,app_id,prefix,created_at,last_used_at,revoked_at")
      .eq("user_id", who.uid)
      .order("created_at", { ascending: false });
    return NextResponse.json({ apps: allApps(external), external, keys: keys ?? [] });
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: Request) {
  const who = await signedIn();
  if ("error" in who) return who.error;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    const db = queueDb();
    if (body.action === "register") {
      const id = String(body.id ?? "").trim().toLowerCase();
      const name = String(body.name ?? "").trim().slice(0, 80);
      if (!ID.test(id)) return NextResponse.json({ error: "App id: lowercase letters, numbers and dashes." }, { status: 400 });
      if (!name) return NextResponse.json({ error: "Give the app a name." }, { status: 400 });
      if (allApps([]).some((a) => a.id === id)) {
        return NextResponse.json({ error: `"${id}" is already a hub app — hub apps are connected automatically.` }, { status: 400 });
      }
      const app = {
        id,
        user_id: who.uid,
        name,
        url: cleanUrl(body.url),
        description: String(body.description ?? "").slice(0, 600),
        capabilities: Array.isArray(body.capabilities) ? body.capabilities.map(String).slice(0, 20) : [],
        callback_url: cleanUrl(body.callback_url),
      };
      const { error } = await db.from("queue_apps").upsert(app, { onConflict: "user_id,id" });
      if (error) throw new Error(error.message);
      const k = newAppKey();
      await db.from("queue_app_keys").insert({ user_id: who.uid, app_id: id, prefix: k.prefix, key_hash: k.hash });
      return NextResponse.json({ app, key: k.key, note: "Copy this key now — it is not shown again." });
    }
    if (body.action === "new_key") {
      const id = String(body.id ?? "");
      const { data } = await db.from("queue_apps").select("id").eq("user_id", who.uid).eq("id", id).maybeSingle();
      if (!data) return NextResponse.json({ error: "No such connected app." }, { status: 404 });
      const k = newAppKey();
      await db.from("queue_app_keys").insert({ user_id: who.uid, app_id: id, prefix: k.prefix, key_hash: k.hash });
      return NextResponse.json({ key: k.key, note: "Copy this key now — it is not shown again." });
    }
    if (body.action === "revoke") {
      await db.from("queue_app_keys").update({ revoked_at: new Date().toISOString() }).eq("user_id", who.uid).eq("id", String(body.keyId ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body.action === "remove") {
      const id = String(body.id ?? "");
      await db.from("queue_app_keys").update({ revoked_at: new Date().toISOString() }).eq("user_id", who.uid).eq("app_id", id).is("revoked_at", null);
      await db.from("queue_apps").delete().eq("user_id", who.uid).eq("id", id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return errorJson(e);
  }
}

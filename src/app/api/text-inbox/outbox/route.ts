import { NextResponse } from "next/server";
import { claimReady } from "@/lib/text-inbox/engine";
import { uidForKey, updateTexts } from "@/lib/text-inbox/server/store";

// ---------------------------------------------------------------------------
// The outbox the iPhone Shortcut "Jarvis Send" reads:
//
//   GET /api/text-inbox/outbox?k=<key>
//     → { ok, count, messages: [{ id, to, name, text }] }
//
// Every approved reply is handed over ONCE and marked Sent in the same step,
// so two check-ins landing together never send a reply twice. The Shortcut
// then sends each one with Messages (Repeat with Each → Send Message). Only
// replies the user approved are ever in here.
//
// Session-exempt in middleware (exact path); the key is checked here.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

async function handle(req: Request): Promise<Response> {
  const uid = await uidForKey(new URL(req.url).searchParams.get("k") ?? "");
  if (!uid) {
    return NextResponse.json(
      { ok: false, count: 0, messages: [], error: "This Shortcut link isn't valid any more. Copy a fresh one from Jarvis › Text Inbox › Set up." },
      { status: 401 },
    );
  }
  try {
    const { out } = await updateTexts(uid, (doc) => claimReady(doc));
    return NextResponse.json({ ok: true, count: out.length, messages: out }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[text-inbox] outbox failed:", e);
    return NextResponse.json({ ok: false, count: 0, messages: [], error: e instanceof Error ? e.message : "Couldn't read your outbox." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

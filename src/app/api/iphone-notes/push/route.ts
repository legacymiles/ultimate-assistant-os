import { after, NextResponse } from "next/server";
import { BATCHED_REASON, emptyReason, ingest, isBatched, MAX_BODY, readIncoming } from "@/lib/iphone-notes/engine";
import { readNote } from "@/lib/iphone-notes/server/brain";
import { uidForPushKey, updateNotes } from "@/lib/iphone-notes/server/store";

// ---------------------------------------------------------------------------
// The door the iPhone Shortcut "Notes to Jarvis" knocks on, once per note:
//
//   POST /api/iphone-notes/push?k=<key>
//        JSON or form: { title, body, folder?, created?, modified? }
//        or plain text: the note itself
//   GET  /api/iphone-notes/push?k=<key>   — "is my link right?" (no note)
//
// The note is stored at once and answered fast, so a Shortcut looping over
// fifty notes doesn't sit waiting on the AI; the read runs after the reply.
// A note already sent with the same text is a no-op, so running the Shortcut
// every day never makes duplicates. Nothing is ACTED on here — every proposal
// waits for the owner's Approve in Jarvis.
//
// Session-exempt in middleware (exact path); the key is checked here.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BAD_KEY = "This Shortcut link isn't valid any more. Copy a fresh one from Jarvis › iPhone Notes › Set up.";

async function uidFrom(req: Request): Promise<string | null> {
  return uidForPushKey(new URL(req.url).searchParams.get("k") ?? "");
}

export async function GET(req: Request) {
  const uid = await uidFrom(req);
  if (!uid) return NextResponse.json({ ok: false, error: BAD_KEY }, { status: 401 });
  return NextResponse.json({ ok: true, message: "Link works. Run your Notes to Jarvis Shortcut and your notes will show up in Jarvis." });
}

export async function POST(req: Request) {
  const uid = await uidFrom(req);
  if (!uid) return NextResponse.json({ ok: false, error: BAD_KEY }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY * 3) {
    return NextResponse.json({ ok: false, error: "That note is too long to send in one go." }, { status: 413 });
  }

  const type = req.headers.get("content-type") ?? "";
  let body: unknown = null;
  if (type.includes("json")) body = await req.json().catch(() => null);
  else if (type.includes("form")) body = Object.fromEntries((await req.formData().catch(() => new FormData())).entries());
  else body = await req.text().catch(() => "");

  if (isBatched(body)) return NextResponse.json({ ok: false, error: BATCHED_REASON }, { status: 400 });
  const incoming = readIncoming(body);
  if (!incoming) {
    return NextResponse.json({ ok: false, error: emptyReason(body) }, { status: 400 });
  }

  try {
    const { out } = await updateNotes(uid, (doc) => ingest(doc, incoming));
    if (out.kind === "same") return NextResponse.json({ ok: true, message: `Already have "${out.note.title}" — no duplicate made.` });
    after(() => readNote(uid, out.note.id).catch((e) => console.error("[iphone-notes] read failed:", e)));
    return NextResponse.json({
      ok: true,
      message: out.kind === "edited" ? `Updated "${out.note.title}" — Jarvis is reading the changes.` : `Got "${out.note.title}" — it's waiting for you in Jarvis.`,
    });
  } catch (e) {
    console.error("[iphone-notes] push failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Couldn't save that note." }, { status: 500 });
  }
}

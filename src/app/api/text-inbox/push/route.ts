import { after, NextResponse } from "next/server";
import { ingest, MAX_TEXT, readIncoming } from "@/lib/text-inbox/engine";
import { draftText } from "@/lib/text-inbox/server/brain";
import { uidForKey, updateTexts } from "@/lib/text-inbox/server/store";

// ---------------------------------------------------------------------------
// The door the iPhone automation "Text to Jarvis" knocks on, once per text:
//
//   POST /api/text-inbox/push?k=<key>
//        JSON or form: { text, from, number }
//   GET  /api/text-inbox/push?k=<key>   — "is my link right?" (no text)
//
// The text is stored at once and answered fast (the automation runs in the
// background and shouldn't wait on the AI); the draft is written after the
// reply, then the phone gets a notification. Nothing is SENT from here — every
// reply waits for the user's Approve in Jarvis.
//
// Session-exempt in middleware (exact path); the key is checked here.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BAD_KEY = "This Shortcut link isn't valid any more. Copy a fresh one from Jarvis › Text Inbox › Set up.";

async function uidFrom(req: Request): Promise<string | null> {
  return uidForKey(new URL(req.url).searchParams.get("k") ?? "");
}

export async function GET(req: Request) {
  const uid = await uidFrom(req);
  if (!uid) return NextResponse.json({ ok: false, error: BAD_KEY }, { status: 401 });
  return NextResponse.json({ ok: true, message: "Link works. Texts from the people you picked will show up in Jarvis with a reply drafted." });
}

export async function POST(req: Request) {
  const uid = await uidFrom(req);
  if (!uid) return NextResponse.json({ ok: false, error: BAD_KEY }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_TEXT * 4) {
    return NextResponse.json({ ok: false, error: "That message is too long to send in one go." }, { status: 413 });
  }

  const type = req.headers.get("content-type") ?? "";
  let body: unknown = null;
  if (type.includes("json")) body = await req.json().catch(() => null);
  else if (type.includes("form")) body = Object.fromEntries((await req.formData().catch(() => new FormData())).entries());
  else body = await req.text().catch(() => "");

  const incoming = readIncoming(body);
  if (!incoming) {
    return NextResponse.json(
      { ok: false, error: "No message came through. In the automation, check the text field is set to Shortcut Input › Content." },
      { status: 400 },
    );
  }

  try {
    const { out } = await updateTexts(uid, (doc) => ingest(doc, incoming));
    if (out.kind === "same") return NextResponse.json({ ok: true, message: "Already have that one." });
    after(() => draftText(uid, out.item.id, { announce: true }).catch((e) => console.error("[text-inbox] draft failed:", e)));
    return NextResponse.json({ ok: true, message: `Got the text from ${out.item.from} — Jarvis is writing a reply for you to approve.` });
  } catch (e) {
    console.error("[text-inbox] push failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Couldn't save that text." }, { status: 500 });
  }
}

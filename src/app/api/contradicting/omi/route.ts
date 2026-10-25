import { NextResponse } from "next/server";
import { attachSummary, receiptText, type Segment } from "@/lib/contradicting/engine";
import { addLines } from "@/lib/contradicting/server/run";
import { readRecord, uidForKey, updateRecord } from "@/lib/contradicting/server/store";

// ---------------------------------------------------------------------------
// The recorder's door. Paste this URL (with your key) into the Omi app as a
// "Real-time transcript" webhook, and optionally as the "Conversation created"
// webhook too.
//
//   POST /api/contradicting/omi?k=<key>&session_id=…&uid=…
//     body: [ {text, speaker, speakerId, is_user, start, end}, … ]   real-time pieces
//        or { segments: [...] }                                       newer shape
//        or { transcript_segments, structured, started_at, … }       conversation done
//
// Answering { message } makes Omi show it on the phone — that's the live
// receipt. Session-exempt in middleware (exact path); the key is checked here.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const MAX_BODY = 400_000;

/** Omi adds its own "?session_id=…" — read the params from the raw URL so either joining style works. */
function param(url: string, name: string): string {
  let raw = url;
  try {
    raw = decodeURIComponent(url); // "?k=…?session_id=…" can arrive as "?k=…%3Fsession_id=…"
  } catch {
    /* keep it as sent */
  }
  const m = raw.match(new RegExp(`[?&]${name}=([^&?#]+)`));
  return m ? m[1] : "";
}

export async function GET() {
  return NextResponse.json({ ok: true, app: "Contradicting", hint: "Omi sends transcripts here with POST." });
}

export async function POST(req: Request) {
  const raw = req.url;
  const uid = await uidForKey(param(raw, "k"));
  if (!uid) return NextResponse.json({ error: "This recorder link isn't valid any more. Copy a fresh one from Contradicting › Setup." }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return NextResponse.json({ error: "Too much at once." }, { status: 413 });

  const body = (await req.json().catch(() => null)) as unknown;
  if (!body) return NextResponse.json({});

  try {
    // Conversation finished: keep Omi's title, overview and action items as the key points.
    if (!Array.isArray(body) && typeof body === "object" && "structured" in (body as object)) {
      const m = body as {
        started_at?: string;
        finished_at?: string;
        structured?: { title?: string; overview?: string; action_items?: { description?: string }[] };
      };
      await updateRecord(uid, (doc) => ({
        doc: attachSummary(doc, {
          startedAt: m.started_at,
          finishedAt: m.finished_at,
          title: m.structured?.title,
          overview: m.structured?.overview,
          points: (m.structured?.action_items ?? []).map((a) => a.description ?? "").filter(Boolean),
        }),
        out: null,
      }));
      return NextResponse.json({});
    }

    const segs: Segment[] = Array.isArray(body)
      ? (body as Segment[])
      : Array.isArray((body as { segments?: unknown }).segments)
        ? (body as { segments: Segment[] }).segments
        : [];
    const sessionId = param(raw, "session_id") || (body as { session_id?: string }).session_id || "omi";
    const { doc, receipts } = await addLines(uid, segs.slice(0, 200), sessionId, "omi");
    const live = receipts.filter((r) => !r.dismissed);
    if (live.length && doc.settings.liveNotify) return NextResponse.json({ message: receiptText(doc, live[live.length - 1]) });
    return NextResponse.json({});
  } catch (e) {
    console.error("contradicting omi webhook failed:", e);
    // Omi doesn't need to retry a transcript piece; a 200 keeps it from hammering us.
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't save that." });
  }
}

/** Lets the setup screen check the link works without sending a transcript. */
export async function HEAD(req: Request) {
  const uid = await uidForKey(param(req.url, "k"));
  if (!uid) return new Response(null, { status: 401 });
  await readRecord(uid);
  return new Response(null, { status: 200 });
}

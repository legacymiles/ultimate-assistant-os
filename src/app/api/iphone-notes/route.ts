import { after, NextResponse } from "next/server";
import {
  askAgain,
  decide,
  ingest,
  NotesError,
  pushUrl,
  readIncoming,
  removeNote,
  stuck,
  viewNote,
  type Decision,
  type NotesDoc,
} from "@/lib/iphone-notes/engine";
import { trackRecord } from "@/lib/confidence/calibrate";
import { readNote } from "@/lib/iphone-notes/server/brain";
import { pushKeyFor, readNotes, updateNotes } from "@/lib/iphone-notes/server/store";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";
import { aiEndpoint } from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// iPhone Notes, for the browser.
//
//   GET  ?tz=<IANA zone>        -> view (notes with confidence, Shortcut link)
//   POST { action, ... }        -> the same view, after the change
//
// Actions:
//   decide  {noteId, itemId, decision: "approve"|"decline", changed?, patch?}
//           — for "approve" the page has ALREADY run the action (added the
//           to-do, the event…) after the owner's tap; this records it and
//           learns from it. Nothing here ever acts on its own.
//   change  {noteId, instruction}   read the note again with the owner's words
//   retry   {noteId}                read it again as it is
//   add     {title?, body}          a note typed or pasted on the page
//   remove  {noteId}                forget the note here (not on the phone)
//   key.rotate                      new Shortcut link; the old one stops working
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_POST = 60_000;

function signIn() {
  return NextResponse.json({ error: "Sign in to Jarvis to see your notes." }, { status: 401 });
}

async function view(req: Request, uid: string, doc: NotesDoc, rotate = false) {
  let push = "";
  let pushError = "";
  try {
    push = pushUrl(new URL(req.url).origin, await pushKeyFor(uid, rotate));
  } catch (e) {
    pushError = e instanceof Error ? e.message : "Couldn't make your Shortcut link.";
  }
  return NextResponse.json({
    notes: doc.notes.map((n) => viewNote(n, doc.outcomes)),
    learning: trackRecord(doc.outcomes),
    push,
    pushError,
    lastPushAt: doc.lastPushAt ?? null,
    lastFail: doc.lastFail ?? null,
    ai: Boolean(aiEndpoint()),
    now: new Date().toISOString(),
  });
}

export async function GET(req: Request) {
  const uid = await browserUid();
  if (!uid) return signIn();
  try {
    const tz = new URL(req.url).searchParams.get("tz") ?? "";
    let doc = await readNotes(uid);
    if (tz && tz.length < 64 && tz !== doc.tz) doc = (await updateNotes(uid, (d) => ({ doc: { ...d, tz }, out: null }))).doc;
    // A read that never finished (the server stopped mid-thought) gets another go.
    const left = stuck(doc).slice(0, 3);
    if (left.length) after(() => Promise.all(left.map((n) => readNote(uid, n.id))).then(() => undefined).catch(() => undefined));
    return await view(req, uid, doc);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't open your notes." }, { status: 500 });
  }
}

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.slice(0, max) : "");

function readPatch(raw: unknown): Decision["patch"] {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: NonNullable<Decision["patch"]> = {};
  for (const k of ["label", "text", "location", "name", "relation", "when", "folder"] as const) if (typeof r[k] === "string") out[k] = str(r[k], 2000);
  if (typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) out.date = r.date;
  if (r.date === null) out.date = null;
  if (typeof r.time === "string" && /^\d{2}:\d{2}$/.test(r.time)) out.time = r.time;
  if (r.time === null) out.time = null;
  return out;
}

export async function POST(req: Request) {
  const uid = await browserUid();
  if (!uid) return signIn();
  if (Number(req.headers.get("content-length") ?? 0) > MAX_POST) return NextResponse.json({ error: "Too much at once." }, { status: 413 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "That request was empty." }, { status: 400 });
  const noteId = str(body.noteId, 80);

  try {
    switch (body.action) {
      case "decide": {
        const decision = body.decision === "approve" ? "approve" : body.decision === "decline" ? "decline" : null;
        if (!decision) throw new NotesError("Approve or decline?");
        const d: Decision = { noteId, itemId: str(body.itemId, 80), decision, changed: body.changed === true, patch: readPatch(body.patch) };
        const { doc } = await updateNotes(uid, (doc) => ({ doc: decide(doc, d), out: null }));
        return await view(req, uid, doc);
      }
      case "change": {
        await updateNotes(uid, (doc) => {
          const r = askAgain(doc, noteId, str(body.instruction));
          return { doc: r.doc, out: null };
        });
        await readNote(uid, noteId);
        return await view(req, uid, await readNotes(uid));
      }
      case "retry": {
        await readNote(uid, noteId);
        return await view(req, uid, await readNotes(uid));
      }
      case "add": {
        const inc = readIncoming({ title: str(body.title, 200), body: str(body.body, 20_000) });
        if (!inc) throw new NotesError("Type or paste a note first.");
        const { out } = await updateNotes(uid, (doc) => ingest(doc, inc));
        if (out.kind !== "same") await readNote(uid, out.note.id);
        return await view(req, uid, await readNotes(uid));
      }
      case "remove": {
        const { doc } = await updateNotes(uid, (doc) => ({ doc: removeNote(doc, noteId), out: null }));
        return await view(req, uid, doc);
      }
      case "key.rotate":
        return await view(req, uid, await readNotes(uid), true);
      default:
        throw new NotesError("Unknown action.");
    }
  } catch (e) {
    const status = e instanceof NotesError ? e.status : 500;
    if (status === 500) console.error("[iphone-notes] failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "That didn't work." }, { status });
  }
}

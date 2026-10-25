import { NextResponse } from "next/server";
import {
  ContradictError,
  addPerson,
  assignSpeaker,
  deleteConvo,
  dismissReceipt,
  emptyDoc,
  removePerson,
  renamePerson,
  setConsent,
  stats,
  unnamedVoices,
  type Doc,
} from "@/lib/contradicting/engine";
import { addLines } from "@/lib/contradicting/server/run";
import { keyFor, readRecord, updateRecord } from "@/lib/contradicting/server/store";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";

// ---------------------------------------------------------------------------
// Contradicting, for the browser.
//
//   GET                                   -> { doc, webhook, unnamed, stats }
//   POST { action, ... }                  -> the same, after the change
//
// Actions: person.add {name, isMe?, consent?} · person.consent {id, agreed} ·
// person.rename {id, name} · person.remove {id} · speaker.assign {convoId,
// label, personId|null} · receipt.dismiss {id, dismissed?} · convo.delete {id} ·
// settings {tz?, liveNotify?, autoPartner?} · say {personId, text} (type a line
// as someone — how you try it without the pendant) · key.rotate · all.clear
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

function signIn() {
  return NextResponse.json({ error: "Sign in to use Contradicting." }, { status: 401 });
}

async function view(req: Request, uid: string, doc: Doc, rotate = false) {
  let webhook = "";
  let webhookError = "";
  try {
    webhook = `${new URL(req.url).origin}/api/contradicting/omi?k=${await keyFor(uid, rotate)}`;
  } catch (e) {
    webhookError = e instanceof Error ? e.message : "Couldn't make your recorder link.";
  }
  return NextResponse.json({ doc, webhook, webhookError, unnamed: unnamedVoices(doc), stats: stats(doc) });
}

export async function GET(req: Request) {
  const uid = await browserUid();
  if (!uid) return signIn();
  try {
    return await view(req, uid, await readRecord(uid));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't open your record." }, { status: 500 });
  }
}

const str = (x: unknown) => (typeof x === "string" ? x : "");

export async function POST(req: Request) {
  const uid = await browserUid();
  if (!uid) return signIn();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "That request was empty." }, { status: 400 });
  const action = str(body.action);
  const now = new Date();

  try {
    if (action === "say") {
      const text = str(body.text).trim();
      if (!text) throw new ContradictError("Type what was said.");
      const current = await readRecord(uid);
      const person = current.people.find((p) => p.id === str(body.personId));
      if (!person) throw new ContradictError("Pick who said it.");
      if (!person.consentAt) throw new ContradictError(`${person.name} hasn't agreed to be recorded yet.`);
      const day = now.toISOString().slice(0, 10);
      const { doc, receipts } = await addLines(
        uid,
        [{ text, is_user: person.isMe, speaker: `TYPED_${person.id}`, speaker_name: person.name, start: now.getTime() / 1000 }],
        `typed-${day}`,
        "typed",
      );
      const res = await view(req, uid, doc);
      const json = await res.json();
      return NextResponse.json({ ...json, caught: receipts.map((r) => r.id) });
    }

    if (action === "key.rotate") return await view(req, uid, await readRecord(uid), true);

    const { doc } = await updateRecord(uid, (d) => {
      switch (action) {
        case "person.add":
          return { doc: addPerson(d, { name: str(body.name), isMe: Boolean(body.isMe), consent: Boolean(body.consent) }, now).doc, out: null };
        case "person.consent":
          return { doc: setConsent(d, str(body.id), Boolean(body.agreed), now), out: null };
        case "person.rename":
          return { doc: renamePerson(d, str(body.id), str(body.name)), out: null };
        case "person.remove":
          return { doc: removePerson(d, str(body.id)), out: null };
        case "speaker.assign":
          return { doc: assignSpeaker(d, str(body.convoId), str(body.label), str(body.personId) || null, now).doc, out: null };
        case "receipt.dismiss":
          return { doc: dismissReceipt(d, str(body.id), body.dismissed !== false), out: null };
        case "convo.delete":
          return { doc: deleteConvo(d, str(body.id)), out: null };
        case "settings": {
          const s = { ...d.settings };
          if (typeof body.tz === "string" && body.tz) s.tz = body.tz.slice(0, 64);
          if (typeof body.liveNotify === "boolean") s.liveNotify = body.liveNotify;
          if (typeof body.autoPartner === "boolean") s.autoPartner = body.autoPartner;
          return { doc: { ...d, settings: s }, out: null };
        }
        case "all.clear":
          return { doc: { ...emptyDoc(d.settings.tz), people: d.people, settings: d.settings }, out: null };
        default:
          throw new ContradictError("That isn't something Contradicting can do.");
      }
    });
    return await view(req, uid, doc);
  } catch (e) {
    const status = e instanceof ContradictError ? 400 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status });
  }
}

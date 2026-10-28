import { after, NextResponse } from "next/server";
import {
  addByHand,
  addPushSub,
  approve,
  clearAll,
  counts,
  decline,
  dropPushSubs,
  readIncoming,
  redo,
  remove,
  sendAgain,
  shortcutUrls,
  stuck,
  TextError,
  unapprove,
  viewItems,
  type TextDoc,
} from "@/lib/text-inbox/engine";
import { draftText, notify, notifyReady } from "@/lib/text-inbox/server/brain";
import { keyFor, readTexts, updateTexts } from "@/lib/text-inbox/server/store";
import { vapidPublicKey } from "@/lib/client-review/push";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";
import { aiEndpoint } from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// Text Inbox, for the browser.
//
//   GET  ?tz=<IANA zone>     -> view (texts newest first, counts, Shortcut links)
//   POST { action, ... }     -> the same view, after the change
//
// Actions:
//   approve    {id, reply, on: "phone"|"computer"}   → Ready to send. From the
//              computer it also buzzes the phone (if allowed) so one tap sends.
//   decline    {id}            unapprove {id}         sendAgain {id}
//   redo       {id, instruction?}   a fresh draft, with the user's words
//   remove     {id}            clear                  (forget everything)
//   add        {from, to?, text}    a text typed in by hand (testing)
//   tone       {tone}          how the user texts, for every draft
//   settings   {notifyNew?, notifyReady?}
//   push.subscribe {subscription} · push.unsubscribe {endpoint} · push.test
//   buzz       tell the phone there are replies ready to send
//   key.rotate new Shortcut links; the old ones stop working
//
// Nothing here sends a text. Only the user's iPhone does, through the
// "Jarvis Send" Shortcut reading /api/text-inbox/outbox.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_POST = 20_000;

function signIn() {
  return NextResponse.json({ error: "Sign in to Jarvis to see your texts." }, { status: 401 });
}

async function view(req: Request, uid: string, doc: TextDoc, rotate = false) {
  let links = { incoming: "", outbox: "" };
  let linkError = "";
  try {
    links = shortcutUrls(new URL(req.url).origin, await keyFor(uid, rotate));
  } catch (e) {
    linkError = e instanceof Error ? e.message : "Couldn't make your Shortcut links.";
  }
  return NextResponse.json({
    items: viewItems(doc),
    counts: counts(doc),
    tone: doc.tone,
    learned: doc.examples.length,
    settings: doc.settings,
    links,
    linkError,
    lastPushAt: doc.lastPushAt ?? null,
    lastCheckInAt: doc.lastCheckInAt ?? null,
    pushDevices: doc.pushSubs.length,
    vapid: await vapidPublicKey(),
    ai: Boolean(aiEndpoint()),
    now: new Date().toISOString(),
  });
}

export async function GET(req: Request) {
  const uid = await browserUid();
  if (!uid) return signIn();
  try {
    const doc = await readTexts(uid);
    const tz = new URL(req.url).searchParams.get("tz") ?? "";
    // A draft that never came back (the server stopped mid-thought) gets another go.
    const left = stuck(doc).slice(0, 3);
    if (left.length) after(() => Promise.all(left.map((i) => draftText(uid, i.id, { tz }))).then(() => undefined).catch(() => undefined));
    return await view(req, uid, doc);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't open your texts." }, { status: 500 });
  }
}

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(req: Request) {
  const uid = await browserUid();
  if (!uid) return signIn();
  if (Number(req.headers.get("content-length") ?? 0) > MAX_POST) return NextResponse.json({ error: "Too much at once." }, { status: 413 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "That request was empty." }, { status: 400 });
  const id = str(body.id, 80);
  const tz = str(body.tz, 64);
  const change = (fn: (d: TextDoc) => TextDoc) => updateTexts(uid, (d) => ({ doc: fn(d), out: null }));

  try {
    switch (body.action) {
      case "approve": {
        const on = body.on === "phone" ? "phone" : "computer";
        const { doc } = await change((d) => approve(d, id, str(body.reply, 2000), on));
        if (on === "computer") {
          const name = doc.items.find((i) => i.id === id)?.from ?? "them";
          after(() => notifyReady(uid, [name]).then(() => undefined));
        }
        return await view(req, uid, doc);
      }
      case "decline":
        return await view(req, uid, (await change((d) => decline(d, id))).doc);
      case "unapprove":
        return await view(req, uid, (await change((d) => unapprove(d, id))).doc);
      case "sendAgain":
        return await view(req, uid, (await change((d) => sendAgain(d, id))).doc);
      case "remove":
        return await view(req, uid, (await change((d) => remove(d, id))).doc);
      case "clear":
        return await view(req, uid, (await change(clearAll)).doc);
      case "redo": {
        await change((d) => redo(d, id, str(body.instruction, 400)));
        await draftText(uid, id, { tz });
        return await view(req, uid, await readTexts(uid));
      }
      case "add": {
        const inc = readIncoming({ from: str(body.from, 120) || "Test", number: str(body.to, 120), text: str(body.text, 4000) });
        if (!inc) throw new TextError("Type the message first.");
        const { out } = await updateTexts(uid, (d) => addByHand(d, inc));
        if (out.kind === "new") await draftText(uid, out.item.id, { tz });
        return await view(req, uid, await readTexts(uid));
      }
      case "tone":
        return await view(req, uid, (await change((d) => ({ ...d, tone: str(body.tone, 600).trim() }))).doc);
      case "settings":
        return await view(
          req,
          uid,
          (
            await change((d) => ({
              ...d,
              settings: {
                notifyNew: typeof body.notifyNew === "boolean" ? body.notifyNew : d.settings.notifyNew,
                notifyReady: typeof body.notifyReady === "boolean" ? body.notifyReady : d.settings.notifyReady,
              },
            }))
          ).doc,
        );
      case "push.subscribe":
        return await view(req, uid, (await change((d) => addPushSub(d, body.subscription))).doc);
      case "push.unsubscribe":
        return await view(req, uid, (await change((d) => dropPushSubs(d, [str(body.endpoint, 1000)]))).doc);
      case "push.test": {
        const sent = await notify(uid, { title: "Jarvis", body: "Notifications work. Approve a reply on your computer and your phone will buzz here.", url: "/apps/text-inbox", tag: "text-test" });
        if (!sent) throw new TextError("No phone is set up for notifications yet. On your iPhone, add Text Inbox to your Home Screen, open it from there and tap Turn on notifications.");
        return await view(req, uid, await readTexts(uid));
      }
      case "buzz": {
        const doc = await readTexts(uid);
        const names = [...new Set(doc.items.filter((i) => i.status === "ready").map((i) => i.from))];
        if (!names.length) throw new TextError("Nothing is waiting to send.");
        const sent = await notifyReady(uid, names);
        if (!sent) throw new TextError("Your phone isn't set up for notifications yet — see Set up › Notifications.");
        return await view(req, uid, doc);
      }
      case "key.rotate":
        return await view(req, uid, await readTexts(uid), true);
      default:
        throw new TextError("Unknown action.");
    }
  } catch (e) {
    const status = e instanceof TextError ? e.status : 500;
    if (status === 500) console.error("[text-inbox] failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "That didn't work." }, { status });
  }
}

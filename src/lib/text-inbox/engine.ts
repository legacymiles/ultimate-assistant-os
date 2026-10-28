// ---------------------------------------------------------------------------
// Text Inbox — the pure engine (no I/O, fully tested).
//
// The iPhone sends each incoming text (an iPhone Shortcut automation on
// "Message received"), Jarvis drafts a reply in the user's voice, and NOTHING
// is sent until the user approves it (owner's rule, Oct 2026). Approved replies
// wait in "Ready to send" until the phone picks them up: the "Jarvis Send"
// Shortcut asks the outbox, sends each one with Messages, and they become Sent.
//
// Apple lets only the iPhone (or a Mac) send a text as you, so the website
// never sends — it hands the words to the phone.
//
//   drafting → waiting → ready → sent
//                  └──→ declined
// ---------------------------------------------------------------------------

export type TextStatus = "drafting" | "waiting" | "ready" | "sent" | "declined";
export type DraftBy = "ai" | "simple" | "you";
export type Device = "phone" | "computer";

export interface TextItem {
  id: string;
  /** Who sent it, as the phone names them (contact name or number). */
  from: string;
  /** Where the reply goes: their phone number (or email for iMessage). */
  to: string;
  text: string;
  receivedAt: string;
  /** One key per message, so the Shortcut firing twice never makes two. */
  hash: string;
  status: TextStatus;
  draft: string;
  draftBy: DraftBy;
  /** Why the draft is simple (no AI key, daily cap, the call failed). */
  draftNote?: string;
  /** The user's words for a redo ("say no but nicely"). */
  instruction?: string;
  draftStartedAt?: string;
  /** The words that will be / were sent. */
  reply?: string;
  edited?: boolean;
  approvedAt?: string;
  approvedOn?: Device;
  sentAt?: string;
  declinedAt?: string;
}

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  addedAt: string;
}

/** A reply the user rewrote — how Jarvis learns their voice. */
export interface StyleExample {
  them: string;
  draft: string;
  sent: string;
}

export interface TextDoc {
  v: 1;
  items: TextItem[];
  /** The user's own words about how they text ("short, no emojis, call people bro"). */
  tone: string;
  examples: StyleExample[];
  pushSubs: PushSub[];
  settings: { notifyNew: boolean; notifyReady: boolean };
  lastPushAt?: string;
  /** Last time the phone asked the outbox (the "Jarvis Send" Shortcut ran). */
  lastCheckInAt?: string;
  daily?: { day: string; count: number };
}

export class TextError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const MAX_TEXT = 4000;
export const MAX_REPLY = 1500;
export const KEEP_DAYS = 30;
export const MAX_ITEMS = 400;
export const MAX_EXAMPLES = 12;
/** AI drafts per account per day; past this, drafts are simple until tomorrow. */
export const DAILY_AI_CAP = 300;
/** A draft that hasn't come back in this long gets another go. */
export const STUCK_MS = 90_000;

const DAY = 86_400_000;

// --- small helpers ------------------------------------------------------------

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v).slice(0, max) : "");

/** Shortcuts sometimes sends a list (["+1 555…"]) or a multi-line value; take the first real one. */
function firstLine(v: unknown, max: number): string {
  if (Array.isArray(v)) return firstLine(v[0], max);
  return str(v, max * 4)
    .split(/\r?\n|,(?=\s*\+?\d)/)
    .map((s) => s.trim())
    .find(Boolean)
    ?.slice(0, max) ?? "";
}

/** "+1 (614) 555-0100" → "+16145550100"; an email stays an email; anything else trimmed. */
export function cleanAddress(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/@/.test(t)) return t.toLowerCase().slice(0, 120);
  const digits = t.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length >= 3) return (digits.startsWith("+") ? "+" : "") + digits.replace(/\D/g, "");
  return t.slice(0, 120);
}

/** Small, stable string hash (FNV-1a) — for dedupe keys only, not security. */
export function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function newId(now: number, salt: string): string {
  return `t${now.toString(36)}${hashOf(salt + Math.random()).slice(0, 5)}`;
}

/** Who a text is "with": the address when we have one, else the name. */
export function personKey(i: Pick<TextItem, "to" | "from">): string {
  return (i.to || i.from).toLowerCase();
}

export function dayIn(tz: string | undefined, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

// --- the document ----------------------------------------------------------------

export function emptyDoc(): TextDoc {
  return { v: 1, items: [], tone: "", examples: [], pushSubs: [], settings: { notifyNew: true, notifyReady: true } };
}

const STATUSES: TextStatus[] = ["drafting", "waiting", "ready", "sent", "declined"];

export function normalizeDoc(raw: unknown): TextDoc {
  const base = emptyDoc();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<TextDoc>;
  const items = Array.isArray(r.items)
    ? r.items.filter((i): i is TextItem => Boolean(i && typeof i.id === "string" && typeof i.text === "string" && STATUSES.includes(i.status)))
    : [];
  return {
    v: 1,
    items,
    tone: typeof r.tone === "string" ? r.tone.slice(0, 600) : "",
    examples: Array.isArray(r.examples) ? r.examples.filter((e) => e && typeof e.sent === "string").slice(-MAX_EXAMPLES) : [],
    pushSubs: Array.isArray(r.pushSubs) ? r.pushSubs.filter((s) => s && typeof s.endpoint === "string" && s.keys) : [],
    settings: {
      notifyNew: r.settings?.notifyNew !== false,
      notifyReady: r.settings?.notifyReady !== false,
    },
    lastPushAt: typeof r.lastPushAt === "string" ? r.lastPushAt : undefined,
    lastCheckInAt: typeof r.lastCheckInAt === "string" ? r.lastCheckInAt : undefined,
    daily: r.daily && typeof r.daily.day === "string" ? { day: r.daily.day, count: Number(r.daily.count) || 0 } : undefined,
  };
}

/** Forget old finished texts (and keep the list a sane size). Waiting ones are never dropped. */
export function prune(doc: TextDoc, now = new Date()): TextDoc {
  const cutoff = now.getTime() - KEEP_DAYS * DAY;
  const open = (i: TextItem) => i.status === "drafting" || i.status === "waiting" || i.status === "ready";
  let items = doc.items.filter((i) => open(i) || (Date.parse(i.receivedAt) || 0) >= cutoff);
  if (items.length > MAX_ITEMS) {
    const keep = new Set(items.filter(open).map((i) => i.id));
    const done = items.filter((i) => !open(i)).sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
    for (const i of done.slice(0, Math.max(0, MAX_ITEMS - keep.size))) keep.add(i.id);
    items = items.filter((i) => keep.has(i.id));
  }
  return { ...doc, items };
}

// --- a text arriving from the phone --------------------------------------------------

export interface Incoming {
  from: string;
  to: string;
  text: string;
  at?: string;
}

/**
 * What the Shortcut sent, from JSON or a form. The Shortcut's fields are
 * `text`, `from` and `number`; a few other spellings are accepted because
 * people name Shortcut fields however they like.
 */
export function readIncoming(body: unknown): Incoming | null {
  if (typeof body === "string") {
    const text = body.trim().slice(0, MAX_TEXT);
    return text ? { from: "Someone", to: "", text } : null;
  }
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const text = str(b.text ?? b.message ?? b.content ?? b.body, MAX_TEXT).trim();
  if (!text) return null;
  const fromRaw = firstLine(b.from ?? b.sender ?? b.name, 120);
  const toRaw = firstLine(b.number ?? b.phone ?? b.to ?? b.address ?? b.email, 120);
  const to = cleanAddress(toRaw || (/^[+\d\s().-]{7,}$|@/.test(fromRaw) ? fromRaw : ""));
  const from = fromRaw || to || "Someone";
  const at = str(b.date ?? b.at, 64);
  return { from, to, text, at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : undefined };
}

/** Same person + same words within 10 minutes = the same text (the Shortcut fired twice). */
const SAME_WINDOW = 10 * 60_000;

export function ingest(doc: TextDoc, inc: Incoming, now = new Date()): { doc: TextDoc; out: { kind: "new" | "same"; item: TextItem } } {
  const key = (inc.to || inc.from).toLowerCase();
  const hash = hashOf(`${key}|${inc.text.trim()}`);
  const same = doc.items.find((i) => i.hash === hash && Math.abs(now.getTime() - Date.parse(i.receivedAt)) < SAME_WINDOW);
  if (same) return { doc, out: { kind: "same", item: same } };
  const at = now.toISOString();
  const item: TextItem = {
    id: newId(now.getTime(), hash),
    from: inc.from,
    to: inc.to,
    text: inc.text,
    receivedAt: inc.at && Math.abs(Date.parse(inc.at) - now.getTime()) < DAY ? inc.at : at,
    hash,
    status: "drafting",
    draft: "",
    draftBy: "simple",
    draftStartedAt: at,
  };
  return { doc: prune({ ...doc, items: [item, ...doc.items], lastPushAt: at }, now), out: { kind: "new", item } };
}

/** A text the user typed in by hand (testing, or a text from another phone). */
export function addByHand(doc: TextDoc, inc: Incoming, now = new Date()) {
  return ingest(doc, inc, now);
}

// --- drafting ---------------------------------------------------------------------------

/** Drafts that never came back (the server stopped mid-thought). */
export function stuck(doc: TextDoc, now = Date.now()): TextItem[] {
  return doc.items.filter((i) => i.status === "drafting" && now - (Date.parse(i.draftStartedAt ?? i.receivedAt) || 0) > STUCK_MS);
}

/** The earlier back-and-forth with this person, oldest first — what a reply needs to sound right. */
export function threadOf(doc: TextDoc, item: TextItem, max = 6): { who: "them" | "me"; text: string }[] {
  const key = personKey(item);
  const earlier = doc.items
    .filter((i) => i.id !== item.id && personKey(i) === key && Date.parse(i.receivedAt) <= Date.parse(item.receivedAt))
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
    .slice(-max);
  const lines: { who: "them" | "me"; text: string }[] = [];
  for (const i of earlier) {
    lines.push({ who: "them", text: i.text.slice(0, 500) });
    if (i.status === "sent" && i.reply) lines.push({ who: "me", text: i.reply.slice(0, 500) });
  }
  return lines;
}

export function systemPrompt(doc: Pick<TextDoc, "tone" | "examples">): string {
  const lines = [
    "You write text-message replies for the user, as the user, in their voice. The user will read your draft and approve, edit or decline it before anything is sent.",
    "Rules:",
    "- Write ONLY the reply text. No quotes, no labels, no explanations, no options.",
    "- Sound like a real person texting: short (usually one or two sentences), casual, matching the other person's energy.",
    "- Never invent facts, plans, times, places or promises the user hasn't given. If the reply needs a decision only the user can make, keep it open (\"let me check and get back to you\").",
    "- Never share private information (addresses, passwords, money details).",
    "- If the message is a one-time code, spam, an automated alert or a business notification, reply with exactly: NO_REPLY",
  ];
  if (doc.tone.trim()) lines.push("", `How the user says they text: ${doc.tone.trim()}`);
  const ex = doc.examples.slice(-6);
  if (ex.length) {
    lines.push("", "Replies the user rewrote — copy their style, not their content:");
    for (const e of ex) lines.push(`They: ${e.them.slice(0, 200)}\nYour draft: ${e.draft.slice(0, 200)}\nWhat the user actually sent: ${e.sent.slice(0, 200)}`);
  }
  return lines.join("\n");
}

export function userPrompt(doc: TextDoc, item: TextItem): string {
  const thread = threadOf(doc, item);
  const parts: string[] = [];
  if (thread.length) parts.push("Earlier in this conversation:\n" + thread.map((l) => `${l.who === "them" ? item.from : "Me"}: ${l.text}`).join("\n"));
  parts.push(`New message from ${item.from}:\n${item.text}`);
  if (item.instruction) parts.push(`The user wants this reply to: ${item.instruction}`);
  parts.push("Write the reply.");
  return parts.join("\n\n");
}

/** The model's answer → a clean draft ("" when it says there's nothing to reply). */
export function cleanDraft(raw: string): { draft: string; noReply: boolean } {
  let t = (raw || "").trim();
  if (/^NO_REPLY\b/i.test(t)) return { draft: "", noReply: true };
  t = t.replace(/^```[a-z]*\s*|```$/gi, "").trim();
  t = t.replace(/^(reply|draft|me)\s*:\s*/i, "").trim();
  if (/^".*"$|^“.*”$/s.test(t)) t = t.slice(1, -1).trim();
  return { draft: t.slice(0, MAX_REPLY), noReply: false };
}

/** No AI (no key, cap spent, call failed): leave a short, safe starter the user can change. */
export function simpleDraft(item: TextItem): string {
  const t = item.text.trim();
  if (/\?\s*$/.test(t)) return "Let me check and get back to you!";
  if (/\b(thanks|thank you|thx|ty)\b/i.test(t)) return "Of course! 🙏";
  if (/\b(lol|lmao|haha|😂)\b/i.test(t)) return "😂";
  return "Got it 👍";
}

export function spendDaily(doc: TextDoc, tz?: string, now = new Date()): { allowed: boolean; doc: TextDoc } {
  const day = dayIn(tz, now);
  const count = doc.daily?.day === day ? doc.daily.count : 0;
  if (count >= DAILY_AI_CAP) return { allowed: false, doc };
  return { allowed: true, doc: { ...doc, daily: { day, count: count + 1 } } };
}

export function applyDraft(doc: TextDoc, id: string, d: { draft: string; by: DraftBy; note?: string; noReply?: boolean }): TextDoc {
  return {
    ...doc,
    items: doc.items.map((i) =>
      i.id === id && i.status === "drafting"
        ? { ...i, status: "waiting", draft: d.draft, draftBy: d.by, draftNote: d.noReply ? "Looks automated — no reply needed. Decline it, or write one." : d.note, draftStartedAt: undefined }
        : i,
    ),
  };
}

/** Ask for a fresh draft, optionally with the user's words about what it should say. */
export function redo(doc: TextDoc, id: string, instruction: string, now = new Date()): TextDoc {
  const item = find(doc, id);
  if (item.status !== "waiting" && item.status !== "drafting") throw new TextError("That text isn't waiting any more.");
  return {
    ...doc,
    items: doc.items.map((i) =>
      i.id === id ? { ...i, status: "drafting", instruction: instruction.trim().slice(0, 400) || undefined, draftStartedAt: now.toISOString(), draftNote: undefined } : i,
    ),
  };
}

// --- the user's yes / no ---------------------------------------------------------------------

function find(doc: TextDoc, id: string): TextItem {
  const item = doc.items.find((i) => i.id === id);
  if (!item) throw new TextError("That text isn't here any more.", 404);
  return item;
}

/**
 * The user's Approve. The reply goes to Ready to send; the phone sends it.
 * If they rewrote the draft, the pair is kept as a style example.
 */
export function approve(doc: TextDoc, id: string, reply: string, on: Device, now = new Date()): TextDoc {
  const item = find(doc, id);
  if (item.status !== "waiting" && item.status !== "drafting") throw new TextError("That text was already answered.");
  const words = reply.trim().slice(0, MAX_REPLY);
  if (!words) throw new TextError("The reply is empty — write something or decline it.");
  if (!item.to && !item.from) throw new TextError("Jarvis doesn't know who to send this to.");
  const edited = Boolean(item.draft) && words !== item.draft.trim();
  const examples =
    edited && item.draftBy === "ai" ? [...doc.examples, { them: item.text.slice(0, 300), draft: item.draft.slice(0, 300), sent: words.slice(0, 300) }].slice(-MAX_EXAMPLES) : doc.examples;
  return {
    ...doc,
    examples,
    items: doc.items.map((i) =>
      i.id === id ? { ...i, status: "ready", reply: words, edited, approvedAt: now.toISOString(), approvedOn: on, draftStartedAt: undefined } : i,
    ),
  };
}

export function decline(doc: TextDoc, id: string, now = new Date()): TextDoc {
  const item = find(doc, id);
  if (item.status === "sent") throw new TextError("That reply was already sent.");
  return { ...doc, items: doc.items.map((i) => (i.id === id ? { ...i, status: "declined", declinedAt: now.toISOString(), draftStartedAt: undefined } : i)) };
}

/** Changed your mind before the phone picked it up: back to waiting. */
export function unapprove(doc: TextDoc, id: string): TextDoc {
  const item = find(doc, id);
  if (item.status !== "ready") throw new TextError(item.status === "sent" ? "Too late — your phone already sent it." : "That reply isn't waiting to send.");
  return { ...doc, items: doc.items.map((i) => (i.id === id ? { ...i, status: "waiting", draft: i.reply ?? i.draft, draftBy: "you", approvedAt: undefined, approvedOn: undefined } : i)) };
}

/** Put a sent (or declined) reply back in Ready to send — e.g. the phone had no signal. */
export function sendAgain(doc: TextDoc, id: string, now = new Date()): TextDoc {
  const item = find(doc, id);
  if (!item.reply) throw new TextError("There's no reply to send again.");
  return { ...doc, items: doc.items.map((i) => (i.id === id ? { ...i, status: "ready", sentAt: undefined, approvedAt: now.toISOString() } : i)) };
}

export function remove(doc: TextDoc, id: string): TextDoc {
  return { ...doc, items: doc.items.filter((i) => i.id !== id) };
}

export function clearAll(doc: TextDoc): TextDoc {
  return { ...doc, items: [], examples: [] };
}

// --- the phone picking up approved replies ------------------------------------------------------

export interface OutMessage {
  id: string;
  to: string;
  name: string;
  text: string;
}

/**
 * The "Jarvis Send" Shortcut asking what to send. Every ready reply is handed
 * over ONCE and marked sent in the same step, so two check-ins landing
 * together can never send the same reply twice. (A reply that didn't go out
 * can be put back with Send again.)
 */
export function claimReady(doc: TextDoc, now = new Date()): { doc: TextDoc; out: OutMessage[] } {
  const at = now.toISOString();
  const ready = doc.items.filter((i) => i.status === "ready" && i.reply).sort((a, b) => Date.parse(a.approvedAt ?? "") - Date.parse(b.approvedAt ?? ""));
  const ids = new Set(ready.map((i) => i.id));
  const out = ready.map((i) => ({ id: i.id, to: i.to || i.from, name: i.from, text: i.reply! }));
  return {
    doc: { ...doc, lastCheckInAt: at, items: doc.items.map((i) => (ids.has(i.id) ? { ...i, status: "sent", sentAt: at } : i)) },
    out,
  };
}

// --- push subscriptions ---------------------------------------------------------------------------

export function addPushSub(doc: TextDoc, raw: unknown, now = new Date()): TextDoc {
  const s = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!s || typeof s.endpoint !== "string" || !/^https:\/\//.test(s.endpoint) || typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") {
    throw new TextError("This browser sent a notification subscription that couldn't be read.");
  }
  return {
    ...doc,
    pushSubs: [
      ...doc.pushSubs.filter((x) => x.endpoint !== s.endpoint),
      { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh as string, auth: s.keys.auth as string }, addedAt: now.toISOString() },
    ].slice(-5),
  };
}

export function dropPushSubs(doc: TextDoc, endpoints: string[]): TextDoc {
  if (!endpoints.length) return doc;
  const gone = new Set(endpoints);
  return { ...doc, pushSubs: doc.pushSubs.filter((s) => !gone.has(s.endpoint)) };
}

// --- what the browser sees ---------------------------------------------------------------------------

export interface TextCounts {
  waiting: number;
  drafting: number;
  ready: number;
  sent: number;
  declined: number;
}

export function counts(doc: TextDoc): TextCounts {
  const c: TextCounts = { waiting: 0, drafting: 0, ready: 0, sent: 0, declined: 0 };
  for (const i of doc.items) c[i.status] += 1;
  return c;
}

/** Newest first; the browser never sees the dedupe hash. */
export function viewItems(doc: TextDoc): Omit<TextItem, "hash">[] {
  return [...doc.items]
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
    .map(({ hash: _hash, ...rest }) => rest);
}

/** The Shortcut links (the incoming door and the outbox), with this account's key. */
export function shortcutUrls(origin: string, key: string): { incoming: string; outbox: string } {
  return {
    incoming: `${origin}/api/text-inbox/push?k=${key}`,
    outbox: `${origin}/api/text-inbox/outbox?k=${key}`,
  };
}

export const SEND_SHORTCUT = "Jarvis Send";

/**
 * Opens the "Jarvis Send" Shortcut on the iPhone and comes back to Jarvis when
 * it's done. Only works on the phone itself.
 */
export function runShortcutUrl(back: string): string {
  return `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(SEND_SHORTCUT)}&x-success=${encodeURIComponent(back)}&x-cancel=${encodeURIComponent(back)}`;
}

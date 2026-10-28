// ---------------------------------------------------------------------------
// iPhone Notes — the engine.
//
// Apple Notes has no API, so an iPhone Shortcut ("Notes to Jarvis") finds the
// notes changed lately and posts each one here. Jarvis reads every note and
// proposes what to do with what is in it — a to-do, a calendar event, a
// birthday, something to remember, a job for In Queue, a job for the super
// chat, or just keeping it — each with a confidence score.
//
// NOTHING RUNS WITHOUT A YES. Owner's rule (Oct 2026): "everything has to be
// approved no matter the confidence score". The score only sorts the list and
// says where to look first; it never acts. The shape enforces it: an item
// only becomes "done" through decide(), which the page calls after the owner
// tapped Approve and the action actually ran.
//
// It gets better on its own two ways:
//   • every decision is an Outcome, and the score is calibrated against them
//     (src/lib/confidence/calibrate.ts) — a kind of guess the owner keeps
//     declining drops, whatever the model says;
//   • the last decisions ride along in the next read as examples, so the
//     model's first guess drifts toward the owner's habits.
//
// Pure: the routes, the page and the tests import it.
// ---------------------------------------------------------------------------

import { calibrate, clamp01, normalizeOutcomes, recordOutcome, type Confidence, type Outcome } from "../confidence/calibrate";

export const ACTIONS = ["todo", "event", "birthday", "memory", "queue", "task", "save", "nothing"] as const;
export type NoteAction = (typeof ACTIONS)[number];

export const ACTION_LABEL: Record<NoteAction, string> = {
  todo: "To-do",
  event: "Calendar",
  birthday: "Birthday",
  memory: "Remember",
  queue: "In Queue",
  task: "Do it (chat)",
  save: "Save to Folders",
  nothing: "Nothing to do",
};

export type ItemState = "waiting" | "done" | "declined";

/** One thing Jarvis found in a note, and what it proposes doing with it. */
export interface NoteItem {
  id: string;
  action: NoteAction;
  /** The short thing the card shows: "Call the dentist", "Mom's birthday". */
  label: string;
  /** The text the action uses: the to-do, the fact, the job, the request. */
  text: string;
  /** To-do due day or event day, "YYYY-MM-DD". */
  date?: string | null;
  /** Event start, "HH:MM". */
  time?: string | null;
  location?: string;
  /** Birthday: whose, how they relate, and the date as written ("March 14"). */
  name?: string;
  relation?: string;
  when?: string;
  /** Save: folder under Folders › iPhone Notes. */
  folder?: string;
  /** Why Jarvis thinks so, one line. */
  why: string;
  /** What the model said about itself, 0-1. Calibrated at view time. */
  raw: number;
  engine: "ai" | "simple";
  state: ItemState;
  decidedAt?: string;
  /** The owner edited it before approving — counts as "not right as guessed". */
  changed?: boolean;
}

export type NoteStatus = "reading" | "ready" | "failed";

export interface Note {
  id: string;
  /** Same note on every push → same key (title + when it was created). */
  key: string;
  /** Fingerprint of the body, so an edit is noticed and a re-send is not. */
  hash: string;
  title: string;
  body: string;
  folder?: string;
  createdAt?: string;
  modifiedAt?: string;
  receivedAt: string;
  status: NoteStatus;
  items: NoteItem[];
  error?: string;
  /** The owner's own words from "Change it" — kept so a re-read follows them. */
  instruction?: string;
}

/** A past decision, as the model sees it next time. */
export interface Example {
  note: string;
  action: NoteAction;
  label: string;
  ok: boolean;
  at: string;
}

export interface NotesDoc {
  notes: Note[];
  outcomes: Outcome[];
  examples: Example[];
  /** The owner's timezone, from their browser — "today" for relative dates. */
  tz?: string;
  lastPushAt?: string;
  /** The last push that held no usable note — its shape only, never its words. */
  lastFail?: { at: string; shape: string; reason: string };
  /** Notes pushed per day, for the daily cap on AI reads. */
  daily?: { day: string; count: number };
}

export class NotesError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const MAX_NOTES = 300;
export const MAX_ITEMS = 6;
export const MAX_BODY = 20_000;
const MAX_EXAMPLES = 40;
/** Examples sent to the model with each read. */
const PROMPT_EXAMPLES = 16;
/** AI reads per account per day; past it, notes are read in simple mode. */
export const DAILY_AI_CAP = 400;

export function emptyDoc(): NotesDoc {
  return { notes: [], outcomes: [], examples: [] };
}

// --- small helpers ------------------------------------------------------------

/** FNV-1a, 32-bit, as hex. Pure and the same in the browser and on the server. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: unknown): v is string => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);

/** "YYYY-MM-DD" in a timezone (falls back to UTC when the zone is unknown). */
export function dayIn(tz: string | undefined, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

// --- what the Shortcut sends -------------------------------------------------------

export interface Incoming {
  title: string;
  body: string;
  folder?: string;
  created?: string;
  modified?: string;
}

/**
 * Whatever the Shortcut sent, as one note — or null. Tolerant on purpose:
 * Shortcuts names fields however the person typed them, sends dates in the
 * phone's own format, and a plain "Text" body is just the note.
 */
export function readIncoming(body: unknown): Incoming | null {
  if (typeof body === "string") {
    const text = body.trim().slice(0, MAX_BODY);
    if (!text) return null;
    return { title: text.split("\n")[0].slice(0, 200), body: text };
  }
  if (!body || typeof body !== "object") return null;
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) r[k.toLowerCase().replace(/[^a-z]/g, "")] = v;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = r[k];
      // A setup step typed in as text instead of the variable is not a value.
      if (typeof v === "string" && v.trim() && !isPlaceholder(v)) return v;
      if (typeof v === "number") return String(v);
    }
    return "";
  };
  let text = pick("body", "note", "text", "content", "notes").replace(/\r\n/g, "\n").trim().slice(0, MAX_BODY);
  // The key was named something else ("Body ", "Repeat Item", a typo): any one
  // field that holds real words is the note.
  if (!text) {
    const known = new Set(["title", "name", "folder", "folders", "created", "creationdate", "createdat", "datecreated", "modified", "lastmodifieddate", "modifiedat", "lastmodified", "datemodified"]);
    text =
      Object.entries(r)
        .filter(([k, v]) => !known.has(k) && typeof v === "string" && v.trim() && !isPlaceholder(v))
        .map(([, v]) => String(v).replace(/\r\n/g, "\n").trim())
        .sort((a, b) => b.length - a.length)[0]
        ?.slice(0, MAX_BODY) ?? "";
  }
  let title = pick("title", "name").trim().slice(0, 200);
  if (!text && title) text = title;
  if (!text) return null;
  // Apple puts the title as the body's first line; don't say it twice.
  if (!title) title = text.split("\n")[0].slice(0, 200);
  return {
    title,
    body: text,
    folder: pick("folder", "folders").trim().slice(0, 120) || undefined,
    created: pick("created", "creationdate", "createdat", "datecreated").trim().slice(0, 80) || undefined,
    modified: pick("modified", "lastmodifieddate", "modifiedat", "lastmodified", "datemodified").trim().slice(0, 80) || undefined,
  };
}

/**
 * True when a Shortcut field holds the setup instructions themselves —
 * "Repeat Item > tap it > Name" typed as text instead of picking the variable.
 * Those values are ignored and the note falls back to what it can work out.
 */
export function isPlaceholder(v: string): boolean {
  const t = v.toLowerCase().replace(/\s+/g, " ").trim();
  if (t.length > 80) return false;
  return /^(repeat item|repeat results?|shortcut input)( ?[>›→-]+ ?.*)?$/.test(t) || /\btap it\b/.test(t);
}

/**
 * True when one push carries MANY notes glued together — the Shortcut used the
 * whole "Notes" list (or sent from outside the Repeat), so every field is a
 * list joined by line breaks: several creation dates, the folder name repeated.
 * Those can't be split back into notes reliably, so the push is refused with
 * the fix instead of saving one jumbled note.
 */
export function isBatched(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) r[k.toLowerCase().replace(/[^a-z]/g, "")] = v;
  const lines = (v: unknown) => (typeof v === "string" ? v.split(/\r?\n/).filter((l) => l.trim()).length : 0);
  return ["created", "creationdate", "modified", "lastmodifieddate", "folder"].some((k) => lines(r[k]) > 1);
}

/**
 * True when the "note" is Jarvis's own reply from an earlier push — the
 * Shortcut's field points at "Contents of URL" (the previous answer) instead
 * of "Repeat Item". Never saved.
 */
export function isEcho(body: unknown): boolean {
  const vals = typeof body === "string" ? [body] : body && typeof body === "object" ? Object.values(body as Record<string, unknown>) : [];
  return vals.some((v) => typeof v === "string" && /^\s*\{\s*"(ok|error|message)"\s*:/.test(v) && /"ok"\s*:\s*(true|false)/.test(v));
}

export const ECHO_REASON =
  'The Shortcut sent Jarvis\'s last answer instead of a note — the body field is set to "Contents of URL". Fix: tap the body value, delete it, then tap "Repeat Item" in the bar above the keyboard.';

export const BATCHED_REASON =
  'The Shortcut sent all your notes as one. Fix: drag "Get Contents of URL" so it sits INSIDE the Repeat (between "Repeat with Each" and "End Repeat"), and make every field\'s blue bubble say "Repeat Item" (not "Notes") before you pick Name, Creation Date and so on.';

/** Why a push held no note, in words for the Shortcut's result. */
/**
 * What a push actually held, without its words: the shape the Shortcut sent
 * (format, field names, how long each value was). Shown in the Shortcut's
 * result and kept as the last failed push, so a bad setup can be seen.
 */
export function describeArrival(body: unknown, contentType = ""): string {
  const kind = contentType.includes("json") ? "JSON" : contentType.includes("form") ? "a form" : contentType ? contentType.split(";")[0] : "no format";
  if (body === null || body === undefined) return `Jarvis got: ${kind}, but it couldn't be read.`;
  if (typeof body === "string") return `Jarvis got: ${kind}, plain text, ${body.trim().length} characters.`;
  if (typeof body !== "object") return `Jarvis got: ${kind}, ${typeof body}.`;
  const entries = Object.entries(body as Record<string, unknown>);
  if (!entries.length) return `Jarvis got: ${kind} with no fields at all.`;
  const parts = entries.slice(0, 8).map(([k, v]) => {
    const name = `"${k.slice(0, 30)}"`;
    if (typeof v === "string") return v.trim() ? `${name} (${v.trim().length} characters${isPlaceholder(v) ? ", step words" : ""})` : `${name} (empty)`;
    if (v === null) return `${name} (empty)`;
    return `${name} (${Array.isArray(v) ? "a list" : typeof v})`;
  });
  return `Jarvis got: ${kind} with ${parts.join(", ")}.`;
}

export function emptyReason(body: unknown): string {
  const vals = body && typeof body === "object" ? Object.values(body as Record<string, unknown>) : [body];
  if (vals.some((v) => typeof v === "string" && isPlaceholder(v))) {
    return 'The Shortcut sent the step words instead of the note. In each field, delete the text, tap "Repeat Item" in the bar above the keyboard, then tap the blue Repeat Item to pick Name, Creation Date and so on.';
  }
  const vals2 = body && typeof body === "object" ? Object.values(body as Record<string, unknown>) : [];
  if (vals2.length && vals2.every((v) => typeof v !== "string" || !v.trim())) {
    return 'The note came through empty. Usually "Get Contents of URL" is below "End Repeat" — drag it up so it sits between "Repeat with Each" and "End Repeat", and make sure Find Notes actually finds notes (try "in the last 30 days").';
  }
  return 'No note came through. In "Get Contents of URL", set Request Body to JSON and add one Text field named body whose value is the blue "Repeat Item" bubble.';
}

/** The same note always gets the same key, however often it is sent. */
export function keyOf(n: Pick<Incoming, "title" | "created" | "body">): string {
  const anchor = n.created ? norm(n.created) : "";
  // No creation date: the title is all there is to recognise it by.
  return fingerprint(`${norm(n.title)}|${anchor}`);
}

export type IngestResult =
  | { kind: "new"; note: Note }
  | { kind: "edited"; note: Note }
  | { kind: "same"; note: Note };

/**
 * Add a pushed note. A note seen before with the same text is a no-op (D5: no
 * duplicates, even when the Shortcut sends it every day). An edited note is
 * read again; whatever the owner already decided stays decided.
 */
export function ingest(doc: NotesDoc, inc: Incoming, now = new Date()): { doc: NotesDoc; out: IngestResult } {
  const key = keyOf(inc);
  const hash = fingerprint(norm(inc.body));
  const at = now.toISOString();
  const found = doc.notes.find((n) => n.key === key) ?? doc.notes.find((n) => n.hash === hash);
  if (found) {
    if (found.hash === hash) {
      // Same words — but the Shortcut may now send a real title or dates where
      // it used to send none (a setup mistake fixed). Take them, no re-read.
      const better = (inc.title && inc.title !== found.title) || (inc.created && !found.createdAt) || (inc.folder && !found.folder);
      if (!better) return { doc, out: { kind: "same", note: found } };
      const note: Note = {
        ...found,
        key,
        title: inc.title || found.title,
        createdAt: inc.created ?? found.createdAt,
        modifiedAt: inc.modified ?? found.modifiedAt,
        folder: inc.folder ?? found.folder,
      };
      return { doc: { ...doc, notes: doc.notes.map((n) => (n.id === found.id ? note : n)) }, out: { kind: "same", note } };
    }
    const note: Note = {
      ...found,
      title: inc.title || found.title,
      body: inc.body,
      hash,
      folder: inc.folder ?? found.folder,
      modifiedAt: inc.modified ?? found.modifiedAt,
      receivedAt: at,
      status: "reading",
      error: undefined,
      // Undecided guesses are about the old text; the read replaces them.
      items: found.items.filter((i) => i.state !== "waiting"),
    };
    // An edited note moves back to the top, like a new one.
    return { doc: { ...doc, notes: [note, ...doc.notes.filter((n) => n.id !== found.id)] }, out: { kind: "edited", note } };
  }
  const note: Note = {
    id: rid("note"),
    key,
    hash,
    title: inc.title,
    body: inc.body,
    folder: inc.folder,
    createdAt: inc.created,
    modifiedAt: inc.modified,
    receivedAt: at,
    status: "reading",
    items: [],
  };
  return { doc: { ...doc, notes: [note, ...doc.notes].slice(0, MAX_NOTES), lastPushAt: at }, out: { kind: "new", note } };
}

// --- reading a note ------------------------------------------------------------------

/**
 * The trust boundary for what the model proposes: known actions only, every
 * field clamped, items that need a field they don't have are dropped.
 */
export function parseItems(raw: unknown, engine: NoteItem["engine"] = "ai"): NoteItem[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const out: NoteItem[] = [];
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const action = ACTIONS.find((x) => x === r.action);
    if (!action) continue;
    const text = str(r.text, 2000);
    const label = str(r.label, 140) || text.split("\n")[0].slice(0, 140);
    const item: NoteItem = {
      id: rid("it"),
      action,
      label: label || ACTION_LABEL[action],
      text: text || label,
      why: str(r.why, 240),
      raw: clamp01(r.confidence ?? r.raw, 0.6),
      engine,
      state: "waiting",
    };
    if (action === "todo") {
      if (!item.text) continue;
      item.date = isDay(r.date) ? r.date : null;
    } else if (action === "event") {
      // A dateless event would land on today and be wrong — make it a to-do instead.
      if (!isDay(r.date)) {
        item.action = "todo";
        item.date = null;
        item.raw = Math.min(item.raw, 0.5);
        item.why = item.why || "No date in the note, so it's a to-do rather than an event.";
      } else {
        item.date = r.date;
        item.time = isTime(r.time) ? r.time : null;
        item.location = str(r.location, 160) || undefined;
      }
    } else if (action === "birthday") {
      item.name = str(r.name, 80) || label;
      item.relation = str(r.relation, 40) || undefined;
      item.when = str(r.when ?? r.date, 40);
      if (!item.name || !item.when) continue;
      item.label = item.label || `${item.name}'s birthday`;
    } else if (action === "save") {
      item.folder = str(r.folder, 80).replace(/[\\/]+/g, " › ") || undefined;
    } else if (action === "memory" || action === "queue" || action === "task") {
      if (!item.text) continue;
    }
    out.push(item);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** The last decisions, as lines the model can learn the owner's habits from. */
export function examplesBlock(examples: Example[]): string {
  const recent = examples.slice(-PROMPT_EXAMPLES);
  if (!recent.length) return "";
  return (
    "HOW THE OWNER DECIDED RECENTLY (match their habits for similar notes):\n" +
    recent
      .map((e) => `- "${e.note.slice(0, 80)}" → ${e.action} "${e.label.slice(0, 60)}" — ${e.ok ? "approved" : "declined or changed"}`)
      .join("\n")
  );
}

export function systemPrompt(today: string, examples: Example[], ownerName = "the owner"): string {
  return (
    `You are Jarvis, ${ownerName}'s assistant. You read one note from ${ownerName}'s iPhone Notes app and propose what to do with what is in it. ` +
    "Every proposal is shown as a card and ONLY runs if the owner taps Approve — so propose freely and say plainly what you would do.\n\n" +
    "ACTIONS (pick per thing in the note; a note can hold several things, e.g. a list → one to-do per line, max 6):\n" +
    '- "todo": something to do. text = the to-do in a few words. date = due day if the note says one.\n' +
    '- "event": something happening at a set day (and maybe time). date required "YYYY-MM-DD", time "HH:MM" 24h or null, location.\n' +
    '- "birthday": someone\'s birthday. name, relation ("Mom", "friend") if said, when = the date as written ("Nov 12").\n' +
    '- "memory": a lasting fact about the owner or their life worth remembering (a preference, a decision, a person\'s detail). text = the fact in one sentence.\n' +
    '- "queue": an idea or request for an app, website, feature or skill to build or change. text = the full request in the owner\'s words.\n' +
    '- "task": a job Jarvis\'s agent can do now with a browser and tools (look something up, find a product, compare prices, draft a message). text = a complete standalone instruction.\n' +
    '- "save": reference info with nothing to do (a code, a recipe, a list of ideas to keep). folder = a short folder name for it.\n' +
    '- "nothing": nothing useful to act on (an empty or throwaway note).\n\n' +
    "CONFIDENCE: for each item give confidence 0-1 = how sure you are this is what the owner wants done with it. " +
    "Be honest: vague notes, missing dates, guessed names and notes that could mean several things get low numbers. " +
    "why = one short line on what in the note made you decide.\n" +
    `Resolve relative dates ("Friday", "next week", "tmrw") against today, ${today}. Never invent a date the note doesn't give.\n\n` +
    (examplesBlock(examples) ? examplesBlock(examples) + "\n\n" : "") +
    'Reply as JSON only: {"items":[{"action":string,"label":string,"text":string,"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,' +
    '"location":string,"name":string,"relation":string,"when":string,"folder":string,"confidence":number,"why":string}]}'
  );
}

export function userPrompt(note: Pick<Note, "title" | "body" | "folder" | "instruction">): string {
  return (
    `NOTE${note.folder ? ` (folder: ${note.folder})` : ""}:\n` +
    `Title: ${note.title}\n${note.body.slice(0, 6000)}` +
    (note.instruction ? `\n\nTHE OWNER SAID ABOUT THIS NOTE (follow it): ${note.instruction}` : "")
  );
}

const MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?\s+\d{1,2}(st|nd|rd|th)?\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/i;

/**
 * No AI key (or the AI failed): still useful, and honest that it is the simple
 * version — every guess it makes is scored low so the owner looks at it.
 */
export function localItems(note: Pick<Note, "title" | "body">): NoteItem[] {
  const text = `${note.title}\n${note.body}`;
  const t = text.toLowerCase();
  const first = note.title || note.body.split("\n")[0] || "Note";
  const date = text.match(MONTH)?.[0];
  const raw: Record<string, unknown>[] = [];
  if (/\b(b-?day|birthday)\b/.test(t) && date) {
    const name = first.replace(/('s)?\s*(b-?day|birthday).*$/i, "").trim() || first;
    raw.push({ action: "birthday", label: `${name}'s birthday`, name, when: date, confidence: 0.45, why: "Says birthday and has a date." });
  } else if (/\b(idea|app|website|feature|plugin|build)\b/.test(t)) {
    raw.push({ action: "queue", label: first, text: note.body || first, confidence: 0.35, why: "Sounds like an app or build idea." });
  } else if (/\b(buy|call|text|email|pay|book|pick up|todo|to-do|remember to|need to)\b/.test(t)) {
    const lines = note.body.split("\n").map((l) => l.replace(/^[-*•\s\d.)\]]+(\[[ x]\])?\s*/i, "").trim()).filter(Boolean);
    const list = lines.length > 1 && lines.length <= MAX_ITEMS ? lines : [first];
    for (const l of list) raw.push({ action: "todo", label: l, text: l, confidence: 0.4, why: "Reads like something to do." });
  } else if (note.body.trim().length < 3) {
    raw.push({ action: "nothing", label: "Empty note", text: "", confidence: 0.5, why: "There's nothing in it." });
  } else {
    raw.push({ action: "save", label: first, text: note.body, folder: "Notes", confidence: 0.3, why: "Couldn't tell — keeping it is the safe guess." });
  }
  return parseItems(raw, "simple");
}

/** Put a fresh read on a note. Guesses matching ones already decided are dropped. */
export function applyRead(doc: NotesDoc, noteId: string, items: NoteItem[], error?: string): NotesDoc {
  const notes = doc.notes.map((n) => {
    if (n.id !== noteId) return n;
    const decided = n.items.filter((i) => i.state !== "waiting");
    const seen = new Set(decided.map((i) => `${i.action}|${norm(i.text || i.label)}`));
    const fresh = items.filter((i) => !seen.has(`${i.action}|${norm(i.text || i.label)}`));
    return { ...n, status: (error && !items.length ? "failed" : "ready") as NoteStatus, error, items: [...decided, ...fresh].slice(0, MAX_ITEMS * 2) };
  });
  return { ...doc, notes };
}

// --- the owner's decision ---------------------------------------------------------------

export interface Decision {
  noteId: string;
  itemId: string;
  decision: "approve" | "decline";
  /** The owner edited the item before approving. */
  changed?: boolean;
  /** The edited version, when changed. */
  patch?: Partial<Pick<NoteItem, "label" | "text" | "date" | "time" | "location" | "name" | "relation" | "when" | "folder">>;
}

/**
 * Record the owner's yes or no. For a yes, the page has ALREADY run the action;
 * this only marks it done and learns from it. An item decided once stays
 * decided (a double tap can't count twice).
 */
export function decide(doc: NotesDoc, d: Decision, now = new Date()): NotesDoc {
  const note = doc.notes.find((n) => n.id === d.noteId);
  const item = note?.items.find((i) => i.id === d.itemId);
  if (!note || !item) throw new NotesError("That note isn't here any more — it may have been decided on another device.", 404);
  if (item.state !== "waiting") return doc;
  const at = now.toISOString();
  const ok = d.decision === "approve" && !d.changed;
  const patch = d.patch ?? {};
  const nextItem: NoteItem = {
    ...item,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "string" || v === null)),
    state: d.decision === "approve" ? "done" : "declined",
    decidedAt: at,
    changed: Boolean(d.changed) || undefined,
  };
  const outcomes = recordOutcome(doc.outcomes, { kind: item.action, raw: item.raw, ok, at });
  const examples = [
    ...doc.examples,
    { note: `${note.title} — ${note.body.replace(/\s+/g, " ")}`.slice(0, 160), action: item.action, label: item.label, ok, at },
  ].slice(-MAX_EXAMPLES);
  return {
    ...doc,
    outcomes,
    examples,
    notes: doc.notes.map((n) => (n.id === note.id ? { ...n, items: n.items.map((i) => (i.id === item.id ? nextItem : i)) } : n)),
  };
}

export function removeNote(doc: NotesDoc, noteId: string): NotesDoc {
  return { ...doc, notes: doc.notes.filter((n) => n.id !== noteId) };
}

/** Ready a note to be read again with the owner's words ("Change it"). */
export function askAgain(doc: NotesDoc, noteId: string, instruction: string): { doc: NotesDoc; note: Note } {
  const note = doc.notes.find((n) => n.id === noteId);
  if (!note) throw new NotesError("That note isn't here any more.", 404);
  const words = instruction.trim().slice(0, 600);
  if (!words) throw new NotesError("Say what to do with it instead.");
  const next: Note = { ...note, instruction: words, status: "reading", items: note.items.filter((i) => i.state !== "waiting") };
  // The owner saying "no, it's X" is a decline of every guess it replaces.
  let outcomes = doc.outcomes;
  for (const i of note.items) if (i.state === "waiting") outcomes = recordOutcome(outcomes, { kind: i.action, raw: i.raw, ok: false });
  return { doc: { ...doc, outcomes, notes: doc.notes.map((n) => (n.id === noteId ? next : n)) }, note: next };
}

// --- for the page ---------------------------------------------------------------------

export interface ItemView extends NoteItem {
  confidence: Confidence;
}

export interface NoteView extends Omit<Note, "items"> {
  items: ItemView[];
  /** Items still waiting for a yes or no. */
  waiting: number;
  /** The highest score among waiting items (null when none), for sorting. */
  top: number | null;
}

export function viewNote(note: Note, outcomes: Outcome[]): NoteView {
  const items = note.items.map((i) => ({ ...i, confidence: calibrate(i.raw, i.action, outcomes, ACTION_LABEL[i.action]) }));
  const waitingItems = items.filter((i) => i.state === "waiting");
  return {
    ...note,
    items,
    waiting: waitingItems.length,
    top: waitingItems.length ? Math.max(...waitingItems.map((i) => i.confidence.score)) : null,
  };
}

/** Tolerant read of a stored doc. */
export function normalizeDoc(raw: unknown): NotesDoc {
  if (!raw || typeof raw !== "object") return emptyDoc();
  const r = raw as Partial<NotesDoc>;
  const notes = Array.isArray(r.notes)
    ? r.notes
        .filter((n): n is Note => Boolean(n) && typeof n === "object" && typeof (n as Note).id === "string")
        .map((n) => ({ ...n, items: Array.isArray(n.items) ? n.items : [], status: n.status ?? "ready" }))
        .slice(0, MAX_NOTES)
    : [];
  return {
    notes,
    outcomes: normalizeOutcomes(r.outcomes),
    examples: Array.isArray(r.examples) ? r.examples.slice(-MAX_EXAMPLES) : [],
    tz: typeof r.tz === "string" ? r.tz : undefined,
    lastPushAt: typeof r.lastPushAt === "string" ? r.lastPushAt : undefined,
    lastFail: r.lastFail && typeof r.lastFail.shape === "string" ? r.lastFail : undefined,
    daily: r.daily && typeof r.daily.day === "string" ? r.daily : undefined,
  };
}

/** Count this push against the daily AI cap. True = this one may use the AI. */
export function spendDaily(doc: NotesDoc, now = new Date()): { doc: NotesDoc; allowed: boolean } {
  const day = dayIn(doc.tz, now);
  const count = doc.daily?.day === day ? doc.daily.count : 0;
  return { doc: { ...doc, daily: { day, count: count + 1 } }, allowed: count < DAILY_AI_CAP };
}

/** Notes still "reading" after this long are read again on the next visit. */
export const STUCK_MS = 90_000;

export function stuck(doc: NotesDoc, now = new Date()): Note[] {
  return doc.notes.filter((n) => n.status === "reading" && now.getTime() - Date.parse(n.receivedAt) > STUCK_MS);
}

export function pushUrl(origin: string, key: string): string {
  return `${origin}/api/iphone-notes/push?k=${key}`;
}

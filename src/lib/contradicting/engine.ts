// ---------------------------------------------------------------------------
// Contradicting — the pure engine.
//
// A clip-on recorder (the Omi pendant, or the Omi phone app) streams what was
// said, line by line, with who said it. This file keeps those lines, notices
// when someone denies saying something ("I never called you a girl"), finds
// the line where they did say it, and writes the receipt: the exact words, the
// exact time, and the back-and-forth that led up to it.
//
// Two rules shape everything here:
//   1. Consent. A line is only kept for a person who agreed to be recorded.
//      Withdrawing consent deletes everything they said. A voice nobody has
//      named yet is held briefly so it can be named, then dropped.
//   2. Fair. Every consenting person is checked the same way — the owner too.
//      The record only works if both people trust it.
//
// No I/O, no clock reads (callers pass `now`), so all of it is tested.
// ---------------------------------------------------------------------------

export type Id = string;

export interface Person {
  id: Id;
  name: string;
  /** The account owner — Omi marks their lines `is_user`. */
  isMe: boolean;
  /** When this person agreed to be recorded. Nothing they say is kept without it. */
  consentAt: string | null;
  /** Other names Omi's speech profiles use for this person, lowercased. */
  voiceNames: string[];
  hue: number;
  createdAt: string;
}

export interface Line {
  id: Id;
  convoId: Id;
  /** The recorder's speaker label within this conversation ("user", "SPEAKER_01"). */
  label: string;
  personId: Id | null;
  text: string;
  at: string;
  source: "omi" | "typed";
}

export interface Convo {
  id: Id;
  startedAt: string;
  lastAt: string;
  title?: string;
  overview?: string;
  points?: string[];
  /** Speaker label → person, for this conversation. */
  speakers: Record<string, Id>;
}

export interface Receipt {
  id: Id;
  at: string;
  personId: Id;
  denialLineId: Id;
  matchLineId: Id;
  denial: string;
  quote: string;
  quoteAt: string;
  /** 0–1: how much of what was denied appears in the quote. */
  score: number;
  why: string;
  by: "words" | "ai";
  dismissed: boolean;
}

export interface Settings {
  /** IANA zone used for the timestamps in receipts. */
  tz: string;
  /** Answer Omi with the receipt so it shows up on the phone right away. */
  liveNotify: boolean;
  /** With exactly one other person set up, give them unnamed voices automatically. */
  autoPartner: boolean;
}

export interface Doc {
  v: 1;
  people: Person[];
  convos: Convo[];
  lines: Line[];
  receipts: Receipt[];
  settings: Settings;
}

export class ContradictError extends Error {}

export const LIMITS = { lines: 6000, receipts: 500, convos: 400, people: 12, unnamedHours: 48 } as const;

const HUES = [28, 190, 320, 140, 260, 55, 0, 210];

// --- ids ---------------------------------------------------------------------

/** Short, stable-enough ids. Callers that need uniqueness across runs pass a seed. */
export function makeId(prefix: string, seed: string): Id {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${prefix}_${(h >>> 0).toString(36)}`;
}

// --- the document ------------------------------------------------------------

export function emptyDoc(tz = "America/New_York"): Doc {
  return { v: 1, people: [], convos: [], lines: [], receipts: [], settings: { tz, liveNotify: true, autoPartner: true } };
}

function arr<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : [];
}

/** Whatever was stored, as a valid Doc. Never throws. */
export function normalizeDoc(raw: unknown): Doc {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<Doc>;
  const base = emptyDoc(typeof d.settings?.tz === "string" ? d.settings.tz : undefined);
  return {
    v: 1,
    people: arr<Person>(d.people).filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
      .map((p) => ({ ...p, voiceNames: arr<string>(p.voiceNames), consentAt: p.consentAt ?? null, isMe: Boolean(p.isMe) })),
    convos: arr<Convo>(d.convos).filter((c) => c && typeof c.id === "string").map((c) => ({ ...c, speakers: c.speakers ?? {} })),
    lines: arr<Line>(d.lines).filter((l) => l && typeof l.id === "string" && typeof l.text === "string"),
    receipts: arr<Receipt>(d.receipts).filter((r) => r && typeof r.id === "string"),
    settings: { ...base.settings, ...(d.settings ?? {}) },
  };
}

/** Drop the oldest, and voices nobody named in time. Newest stay. */
export function prune(doc: Doc, now: Date): Doc {
  const cutoff = now.getTime() - LIMITS.unnamedHours * 3600_000;
  let lines = doc.lines.filter((l) => l.personId !== null || Date.parse(l.at) >= cutoff);
  if (lines.length > LIMITS.lines) lines = sortByTime(lines).slice(-LIMITS.lines);
  const kept = new Set(lines.map((l) => l.id));
  const receipts = sortByTime(doc.receipts.filter((r) => kept.has(r.denialLineId) && kept.has(r.matchLineId)))
    .slice(-LIMITS.receipts);
  const live = new Set(lines.map((l) => l.convoId));
  const convos = doc.convos.filter((c) => live.has(c.id)).sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, LIMITS.convos);
  return { ...doc, lines, receipts, convos };
}

function sortByTime<T extends { at: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => a.at.localeCompare(b.at));
}

// --- people and consent -------------------------------------------------------

export function me(doc: Doc): Person | undefined {
  return doc.people.find((p) => p.isMe);
}

export function addPerson(doc: Doc, input: { name: string; isMe?: boolean; consent?: boolean }, now: Date): { doc: Doc; person: Person } {
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) throw new ContradictError("Give this person a name.");
  if (doc.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new ContradictError(`${name} is already set up.`);
  }
  if (input.isMe && me(doc)) throw new ContradictError("You're already set up.");
  if (doc.people.length >= LIMITS.people) throw new ContradictError("That's the most people one account can have.");
  const person: Person = {
    id: makeId("p", `${name}|${now.toISOString()}`),
    name,
    isMe: Boolean(input.isMe),
    consentAt: input.consent ? now.toISOString() : null,
    voiceNames: [name.toLowerCase()],
    hue: HUES[doc.people.length % HUES.length],
    createdAt: now.toISOString(),
  };
  return { doc: { ...doc, people: [...doc.people, person] }, person };
}

/** Everything a person said, gone — used when they withdraw consent or are removed. */
function forgetPerson(doc: Doc, personId: Id): Doc {
  const gone = new Set(doc.lines.filter((l) => l.personId === personId).map((l) => l.id));
  return {
    ...doc,
    lines: doc.lines.filter((l) => !gone.has(l.id)),
    receipts: doc.receipts.filter((r) => r.personId !== personId && !gone.has(r.matchLineId) && !gone.has(r.denialLineId)),
    convos: doc.convos.map((c) => ({
      ...c,
      speakers: Object.fromEntries(Object.entries(c.speakers).filter(([, id]) => id !== personId)),
    })),
  };
}

export function setConsent(doc: Doc, personId: Id, agreed: boolean, now: Date): Doc {
  const p = doc.people.find((x) => x.id === personId);
  if (!p) throw new ContradictError("That person isn't set up.");
  const people = doc.people.map((x) => (x.id === personId ? { ...x, consentAt: agreed ? now.toISOString() : null } : x));
  const next = { ...doc, people };
  return agreed ? next : forgetPerson(next, personId);
}

export function removePerson(doc: Doc, personId: Id): Doc {
  const next = forgetPerson(doc, personId);
  return { ...next, people: next.people.filter((p) => p.id !== personId) };
}

export function renamePerson(doc: Doc, personId: Id, name: string): Doc {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) throw new ContradictError("Give this person a name.");
  if (doc.people.some((p) => p.id !== personId && p.name.toLowerCase() === clean.toLowerCase())) {
    throw new ContradictError(`${clean} is already set up.`);
  }
  return {
    ...doc,
    people: doc.people.map((p) =>
      p.id === personId
        ? { ...p, name: clean, voiceNames: Array.from(new Set([...p.voiceNames, clean.toLowerCase()])) }
        : p,
    ),
  };
}

function consenting(doc: Doc, personId: Id | null): boolean {
  if (!personId) return false;
  return Boolean(doc.people.find((p) => p.id === personId)?.consentAt);
}

// --- words -------------------------------------------------------------------

const SLANG: Record<string, string> = {
  u: "you", ur: "your", ya: "you", yo: "your", youre: "you", "you're": "you", im: "i", "i'm": "i",
  dont: "do", "don't": "do", didnt: "did", "didn't": "did", aint: "not", "ain't": "not", wanna: "want",
  gonna: "going", gotta: "got", cuz: "because", bc: "because", tho: "though", thx: "thanks", ppl: "people",
  rn: "now", bf: "boyfriend", gf: "girlfriend", lil: "little", tryna: "trying",
};

const STOP = new Set(
  ("a an the and or but if so to of in on at for with from by as is are was were be been being am do does did done " +
    "i me my mine myself you your yours yourself he him his she her hers it its they them their we us our " +
    "this that these those there here what when where who why how which " +
    "said say says saying called call calling told tell telling ever never not no yes just like really " +
    "omg lol bro ok okay oh um uh yeah yea well then than too very all any some about up out " +
    "have has had would could should will can cant can't shall may might must " +
    "because though going got want thing stuff")
    .split(/\s+/),
);

/** One word to its comparison form: lowercase, slang expanded, light stemming. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9']/g, "");
  w = SLANG[w] ?? w;
  w = w.replace(/'/g, "");
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

/** The words that carry meaning, in comparison form, without repeats. */
export function keywords(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const expanded = SLANG[raw.toLowerCase().replace(/[^a-z']/g, "")];
    const w = stem(raw);
    if (!w || STOP.has(w) || (expanded && STOP.has(expanded))) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

// --- denials -------------------------------------------------------------------

export interface Denial {
  /** What they say they never said; empty when it points back ("I never said that"). */
  phrase: string;
  /** "that" / "it" — the denied thing is what the other person just quoted. */
  refersBack: boolean;
}

const VERBS = "said|say|called|call|told|tell|promised|promise|agreed|agree|meant|mean|threatened|threaten|accused|accuse|asked|ask|wanted|want";

const DENIAL_PATTERNS: RegExp[] = [
  // "I never said …", "I didn't call you …", "I ain't never told you …", "I did not say …"
  new RegExp(`\\bi\\s+(?:never(?:\\s+ever)?|didn'?t(?:\\s+ever)?|did\\s+not|ain'?t(?:\\s+never)?|have\\s+never|never\\s+once)\\s+(?:${VERBS})\\b(.*)`, "i"),
  // "When did I ever say …"
  new RegExp(`\\bwhen\\s+did\\s+i\\s+(?:ever\\s+)?(?:${VERBS})\\b(.*)`, "i"),
  // "I don't remember saying …"
  /\bi\s+(?:don'?t|do\s+not)\s+remember\s+(?:ever\s+)?(?:saying|calling|telling|promising)\b(.*)/i,
];

const BACK_ONLY = /\b(?:that'?s\s+not\s+what\s+i\s+said|stop\s+putting\s+words\s+in\s+my\s+mouth|i\s+never\s+said\s+all\s+that)\b/i;

/** Is this line someone denying they said something? */
export function detectDenial(text: string): Denial | null {
  const t = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  for (const re of DENIAL_PATTERNS) {
    const m = t.match(re);
    if (!m) continue;
    const rest = (m[1] ?? "").replace(/^[\s,:-]*(?:that|it|this|nothing\s+like\s+that)?[\s,.!?]*$/i, "").trim();
    const phrase = rest.replace(/[.!?]+$/g, "").trim();
    if (!phrase || keywords(phrase).length === 0) return { phrase: "", refersBack: true };
    return { phrase, refersBack: false };
  }
  if (BACK_ONLY.test(t)) return { phrase: "", refersBack: true };
  return null;
}

/** "You said you'd be home by 8" → "you'd be home by 8": what is being quoted at them. */
export function quotedPart(text: string): string {
  return text
    .replace(/^.*?\b(?:you|u)\s+(?:literally\s+|just\s+|even\s+)?(?:said|told\s+me|called\s+me|promised(?:\s+me)?|swore)\s*(?:that\s+)?/i, "")
    .trim();
}

// --- matching --------------------------------------------------------------------

export interface Match {
  line: Line;
  score: number;
  why: string;
}

/** How much of `wanted` appears in `text`, 0–1. */
export function coverage(wanted: string[], text: string): number {
  if (wanted.length === 0) return 0;
  const have = new Set(keywords(text));
  return wanted.filter((w) => have.has(w)).length / wanted.length;
}

function threshold(n: number): number {
  return n <= 2 ? 1 : 0.6;
}

/** The words a denial is about, resolving "that" to what the other person just said. */
export function deniedWords(doc: Doc, denialLine: Line, denial: Denial): { words: string[]; about: string } {
  if (!denial.refersBack) return { words: keywords(denial.phrase), about: denial.phrase };
  const t = Date.parse(denialLine.at);
  const prior = sortByTime(doc.lines)
    .filter(
      (l) =>
        l.convoId === denialLine.convoId &&
        l.id !== denialLine.id &&
        l.personId !== denialLine.personId &&
        Date.parse(l.at) <= t &&
        t - Date.parse(l.at) <= 3 * 60_000,
    )
    .pop();
  if (!prior) return { words: [], about: "" };
  const about = quotedPart(prior.text);
  return { words: keywords(about), about };
}

/** Earlier lines by the same person that say what they now deny. Best (then newest) first. */
export function findContradiction(doc: Doc, denialLine: Line, denial: Denial): Match | null {
  if (!denialLine.personId) return null;
  const { words, about } = deniedWords(doc, denialLine, denial);
  if (words.length === 0) return null;
  const t = Date.parse(denialLine.at);
  let best: Match | null = null;
  for (const l of doc.lines) {
    if (l.personId !== denialLine.personId || l.id === denialLine.id) continue;
    if (Date.parse(l.at) >= t) continue;
    if (detectDenial(l.text)) continue;
    const score = coverage(words, l.text);
    if (score < threshold(words.length)) continue;
    if (!best || score > best.score || (score === best.score && l.at > best.line.at)) {
      const hit = words.filter((w) => keywords(l.text).includes(w));
      best = { line: l, score, why: `Denied “${about}”; earlier line has ${hit.map((w) => `“${w}”`).join(", ")}.` };
    }
  }
  return best;
}

// --- ingest ----------------------------------------------------------------------

/** One transcript piece, the shape Omi's real-time webhook sends (plus newer optional fields). */
export interface Segment {
  text: string;
  speaker?: string;
  speakerId?: number;
  speaker_id?: number;
  is_user?: boolean;
  /** Present when Omi recognised a saved speech profile. */
  speaker_name?: string;
  person_id?: string;
  start?: number;
  end?: number;
}

function labelOf(seg: Segment): string {
  if (seg.is_user) return "user";
  if (seg.speaker) return seg.speaker;
  const n = seg.speakerId ?? seg.speaker_id;
  return typeof n === "number" ? `SPEAKER_${String(n).padStart(2, "0")}` : "SPEAKER_00";
}

function personForVoiceName(doc: Doc, name: string | undefined): Person | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  return doc.people.find((p) => p.voiceNames.includes(n) || p.name.toLowerCase() === n);
}

function resolvePerson(doc: Doc, convo: Convo, label: string, seg: Segment): { personId: Id | null; learned: boolean } {
  if (label === "user") return { personId: me(doc)?.id ?? null, learned: false };
  const named = personForVoiceName(doc, seg.speaker_name);
  if (named) return { personId: named.id, learned: convo.speakers[label] !== named.id };
  if (convo.speakers[label]) return { personId: convo.speakers[label], learned: false };
  if (doc.settings.autoPartner) {
    const others = doc.people.filter((p) => !p.isMe);
    const otherLabels = Object.keys(convo.speakers).filter((k) => k !== "user");
    if (others.length === 1 && otherLabels.length === 0) return { personId: others[0].id, learned: true };
  }
  return { personId: null, learned: false };
}

export interface IngestResult {
  doc: Doc;
  added: Line[];
  receipts: Receipt[];
}

/**
 * Fold a batch of transcript pieces into the record and check every new line
 * from a known person for a denial. `now` is when the batch arrived; the
 * pieces' start/end seconds place each line just before it.
 */
export function ingest(doc: Doc, segs: Segment[], opts: { sessionId: string; now: Date; source?: Line["source"] }): IngestResult {
  const usable = segs.filter((s) => s && typeof s.text === "string" && s.text.trim());
  if (usable.length === 0) return { doc, added: [], receipts: [] };

  const convoId = makeId("c", opts.sessionId);
  const nowIso = opts.now.toISOString();
  let convo: Convo = doc.convos.find((c) => c.id === convoId) ?? { id: convoId, startedAt: nowIso, lastAt: nowIso, speakers: {} };
  const latestEnd = Math.max(0, ...usable.map((s) => s.end ?? s.start ?? 0));

  const lines = [...doc.lines];
  const byId = new Map(lines.map((l, i) => [l.id, i]));
  const added: Line[] = [];

  for (const seg of usable) {
    const label = labelOf(seg);
    const { personId, learned } = resolvePerson({ ...doc, lines }, convo, label, seg);
    if (personId && learned) convo = { ...convo, speakers: { ...convo.speakers, [label]: personId } };
    // A named person who hasn't agreed: their words are never stored.
    if (personId && !consenting(doc, personId)) continue;
    const offsetMs = Math.max(0, (latestEnd - (seg.start ?? latestEnd)) * 1000);
    const at = new Date(opts.now.getTime() - offsetMs).toISOString();
    const id = makeId("l", `${opts.sessionId}|${label}|${Math.round((seg.start ?? opts.now.getTime() / 1000) * 10)}`);
    const line: Line = { id, convoId, label, personId, text: seg.text.trim().slice(0, 2000), at, source: opts.source ?? "omi" };
    const i = byId.get(id);
    if (i !== undefined) {
      // Omi re-sends a piece as its transcript firms up: same piece, newer words.
      if (lines[i].text === line.text && lines[i].personId === line.personId) continue;
      lines[i] = { ...lines[i], text: line.text, personId: line.personId };
      added.push(lines[i]);
    } else {
      byId.set(id, lines.length);
      lines.push(line);
      added.push(line);
    }
  }

  convo = { ...convo, lastAt: nowIso };
  const convos = [convo, ...doc.convos.filter((c) => c.id !== convoId)];
  let next: Doc = { ...doc, lines, convos };
  const receipts: Receipt[] = [];
  for (const line of added) {
    const r = checkLine(next, line, opts.now);
    if (r) {
      next = { ...next, receipts: [...next.receipts, r] };
      receipts.push(r);
    }
  }
  return { doc: next, added, receipts };
}

/** A receipt for this line if it denies something the record shows they said. Never twice. */
export function checkLine(doc: Doc, line: Line, now: Date): Receipt | null {
  if (!line.personId || !consenting(doc, line.personId)) return null;
  if (doc.receipts.some((r) => r.denialLineId === line.id)) return null;
  const denial = detectDenial(line.text);
  if (!denial) return null;
  const m = findContradiction(doc, line, denial);
  if (!m) return null;
  return makeReceipt(line, m, "words", now);
}

export function makeReceipt(denialLine: Line, m: Match, by: Receipt["by"], now: Date): Receipt {
  return {
    id: makeId("r", `${denialLine.id}|${m.line.id}`),
    at: now.toISOString(),
    personId: denialLine.personId as Id,
    denialLineId: denialLine.id,
    matchLineId: m.line.id,
    denial: denialLine.text,
    quote: m.line.text,
    quoteAt: m.line.at,
    score: Math.round(m.score * 100) / 100,
    why: m.why,
    by,
    dismissed: false,
  };
}

/** Name an unknown voice for one conversation; re-checks that conversation's lines. */
export function assignSpeaker(doc: Doc, convoId: Id, label: string, personId: Id | null, now: Date): IngestResult {
  const convo = doc.convos.find((c) => c.id === convoId);
  if (!convo) throw new ContradictError("That conversation is gone.");
  if (personId && !doc.people.some((p) => p.id === personId)) throw new ContradictError("That person isn't set up.");
  const speakers = { ...convo.speakers };
  if (personId) speakers[label] = personId;
  else delete speakers[label];
  const keep = !personId || consenting(doc, personId);
  const lines = doc.lines
    .filter((l) => keep || !(l.convoId === convoId && l.label === label))
    .map((l) => (l.convoId === convoId && l.label === label ? { ...l, personId } : l));
  const touched = new Set(lines.filter((l) => l.convoId === convoId && l.label === label).map((l) => l.id));
  let next: Doc = {
    ...doc,
    lines,
    convos: doc.convos.map((c) => (c.id === convoId ? { ...c, speakers } : c)),
    receipts: doc.receipts.filter((r) => !touched.has(r.denialLineId) && !touched.has(r.matchLineId)),
  };
  const receipts: Receipt[] = [];
  for (const line of sortByTime(next.lines.filter((l) => l.convoId === convoId))) {
    const r = checkLine(next, line, now);
    if (r) {
      next = { ...next, receipts: [...next.receipts, r] };
      receipts.push(r);
    }
  }
  return { doc: next, added: [], receipts };
}

// --- reading the record ----------------------------------------------------------

/** The back-and-forth that led up to a line (and a little after). */
export function leadUp(doc: Doc, lineId: Id, before = 8, after = 2): Line[] {
  const line = doc.lines.find((l) => l.id === lineId);
  if (!line) return [];
  const convo = sortByTime(doc.lines.filter((l) => l.convoId === line.convoId));
  const i = convo.findIndex((l) => l.id === lineId);
  return convo.slice(Math.max(0, i - before), i + after + 1);
}

/** "3:47 PM 10-18-26" in the account's zone. */
export function stamp(iso: string, tz: string): string {
  const d = new Date(iso);
  const safe = (zone: string) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return zone;
    } catch {
      return "UTC";
    }
  };
  const zone = safe(tz);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(d);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "2-digit", day: "2-digit", year: "2-digit" })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  return `${time} ${parts.month}-${parts.day}-${parts.year}`;
}

/** What the phone shows the moment a contradiction lands. */
export function receiptText(doc: Doc, r: Receipt): string {
  const p = doc.people.find((x) => x.id === r.personId);
  const when = stamp(r.quoteAt, doc.settings.tz);
  const quote = r.quote.length > 160 ? `${r.quote.slice(0, 157)}…` : r.quote;
  if (p?.isMe) return `Heads up — at ${when} you did say: “${quote}” Want the back-and-forth that led up to it?`;
  return `Actually, at ${when} ${p?.name ?? "they"} did say: “${quote}” Want the back-and-forth that led up to it?`;
}

const KEY_POINT = /\b(?:i(?:'?ll|\s+will)\b|i\s+promise|i\s+swear|you\s+always|you\s+never|i\s+never|from\s+now\s+on|we\s+agreed|i(?:'?m|\s+am)\s+(?:not\s+)?(?:going|gonna)\s+to?|i\s+(?:don'?t|do\s+not)\s+care|it'?s\s+over|i\s+want\s+you\s+to)\b/i;

/** Promises, absolutes and accusations — the lines that come back up in the next argument. */
export function isKeyPoint(text: string): boolean {
  return KEY_POINT.test(text) || /\b(?:called|calling)\s+(?:me|you|u)\b/i.test(text) || /\byou(?:'?re|\s+are|\s+r)\s+(?:acting|being|so)\b/i.test(text);
}

export interface PersonStats {
  personId: Id;
  lines: number;
  receipts: number;
  keyPoints: number;
}

/** Same scoreboard for everyone — the fairness view. */
export function stats(doc: Doc): PersonStats[] {
  return doc.people.map((p) => ({
    personId: p.id,
    lines: doc.lines.filter((l) => l.personId === p.id).length,
    receipts: doc.receipts.filter((r) => r.personId === p.id && !r.dismissed).length,
    keyPoints: doc.lines.filter((l) => l.personId === p.id && isKeyPoint(l.text)).length,
  }));
}

/** Search the record: every line containing all the words, newest first. */
export function search(doc: Doc, query: string, personId?: Id | null): Line[] {
  const words = keywords(query);
  const plain = query.trim().toLowerCase();
  if (!plain) return [];
  return sortByTime(doc.lines)
    .reverse()
    .filter((l) => (personId ? l.personId === personId : true))
    .filter((l) => (words.length ? coverage(words, l.text) === 1 : l.text.toLowerCase().includes(plain)))
    .slice(0, 100);
}

/** Unnamed voices waiting for "Who's this?", per conversation. */
export function unnamedVoices(doc: Doc): { convoId: Id; label: string; sample: string; count: number }[] {
  const map = new Map<string, { convoId: Id; label: string; sample: string; count: number }>();
  for (const l of doc.lines) {
    if (l.personId) continue;
    const k = `${l.convoId}|${l.label}`;
    const cur = map.get(k);
    if (cur) cur.count++;
    else map.set(k, { convoId: l.convoId, label: l.label, sample: l.text, count: 1 });
  }
  return [...map.values()];
}

export function dismissReceipt(doc: Doc, receiptId: Id, dismissed = true): Doc {
  return { ...doc, receipts: doc.receipts.map((r) => (r.id === receiptId ? { ...r, dismissed } : r)) };
}

export function deleteConvo(doc: Doc, convoId: Id): Doc {
  const gone = new Set(doc.lines.filter((l) => l.convoId === convoId).map((l) => l.id));
  return {
    ...doc,
    lines: doc.lines.filter((l) => !gone.has(l.id)),
    convos: doc.convos.filter((c) => c.id !== convoId),
    receipts: doc.receipts.filter((r) => !gone.has(r.denialLineId) && !gone.has(r.matchLineId)),
  };
}

/** Omi's end-of-conversation summary, laid onto the conversation it covers. */
export function attachSummary(
  doc: Doc,
  s: { startedAt?: string; finishedAt?: string; title?: string; overview?: string; points?: string[] },
): Doc {
  const start = s.startedAt ? Date.parse(s.startedAt) : NaN;
  const end = s.finishedAt ? Date.parse(s.finishedAt) : NaN;
  if (Number.isNaN(start) || Number.isNaN(end)) return doc;
  const slack = 2 * 60_000;
  const hit = doc.convos.find((c) => Date.parse(c.lastAt) >= start - slack && Date.parse(c.startedAt) <= end + slack);
  if (!hit) return doc;
  return {
    ...doc,
    convos: doc.convos.map((c) =>
      c.id === hit.id
        ? { ...c, title: s.title?.slice(0, 120) || c.title, overview: s.overview?.slice(0, 1200) || c.overview, points: s.points?.slice(0, 12) ?? c.points }
        : c,
    ),
  };
}

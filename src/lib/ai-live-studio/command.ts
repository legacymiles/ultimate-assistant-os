// The director's words → what Alex does. The owner talks naturally into a
// private mic ("Alex, be a little more sarcastic", "Respond to Mike next.
// Tell him that's a ridiculous question.") and this turns it into structured
// directions the studio applies at once — without Alex saying a word about it.
//
// Two interpreters share one output shape:
//   1. parseCommand — instant, offline, covers the everyday phrasings.
//   2. The brain route (/api/ai-live-studio/direct) — for anything the parser
//      leaves over, returning the same Directive shape, checked by
//      sanitizeDirectives before it is trusted.
// Then resolveDirectives turns "Mike" / "that" into a real viewer or comment
// against the live chat, asking the owner when a name is ambiguous.
//
// Pure: no clock, no network, no DOM — every rule is a unit test.

import { isEmotion, type Emotion } from "./performance";
import { PRESETS, type ConversationStyle, type PresetId } from "./personality";

// ---- Shapes ------------------------------------------------------------------

/** Who a direction is about, as the owner said it. */
export type TargetRef =
  | { by: "comment"; id: string }
  | { by: "name"; name: string }
  /** "that", "him", "that person" — the selected comment, else the one being answered. */
  | { by: "focus" };

/** Who it turned out to be, against the live chat. */
export type Resolved =
  | { by: "comment"; id: string; handle: string; user: string; text: string }
  | { by: "viewer"; handle: string; user: string; commentId?: string }
  /** Nobody by that name has spoken yet: act the moment they do. */
  | { by: "watch"; name: string };

export type CueKind = "subject" | "audience" | "shoutout" | "react" | "bit" | "line";
export type Scope = "standing" | "next";

export interface Tune {
  humor?: number;
  energy?: number;
  expressiveness?: number;
  interaction?: number;
  /** Delta on the 0.8–1.3 playback rate. */
  speed?: number;
  preset?: PresetId;
  style?: ConversationStyle;
}

export type Directive<T = TargetRef> =
  | ({ type: "tune" } & Tune)
  | { type: "act"; emotion?: Emotion; eyeContact?: number; headMotion?: number; reactions?: boolean; scope: Scope }
  | { type: "note"; text: string; scope: Scope }
  | { type: "reply"; target: T; instruction: string; promote: boolean; expression?: Emotion }
  | { type: "skip"; target: T }
  | { type: "mute"; target: T }
  | { type: "avoid"; topic: string }
  | { type: "cue"; kind: CueKind; intent: string; target?: T }
  | { type: "say"; text: string }
  | { type: "wait"; seconds: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" };

export interface Parsed {
  directives: Directive[];
  /** Clauses the parser couldn't place — sent to the brain, or kept as a note. */
  leftover: string[];
  /** It was a question for Alex, not an instruction. */
  question: boolean;
}

/** A recent comment, as the resolver sees the chat. */
export interface ChatRef {
  id: string;
  handle: string;
  user: string;
  text: string;
  /** Still waiting to be answered. */
  waiting: boolean;
}

export interface CommandContext {
  /** The character's name, stripped from the front of a command ("Alex, …"). */
  name: string;
  /** Recent viewer comments, oldest first. */
  comments: ChatRef[];
  /** The comment "that" means: the owner's selection, else the one being answered. */
  focusId: string | null;
  /** What the conversation is about right now — the last thing answered. */
  topic: string;
}

// ---- Words -------------------------------------------------------------------

const NUMBERS: Record<string, number> = {
  a: 1, one: 1, two: 2, couple: 2, "a couple": 2, three: 3, few: 3, "a few": 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, "forty-five": 45, sixty: 60,
};

export function numberFrom(word: string): number | null {
  const w = word.toLowerCase().trim();
  if (/^\d+(?:\.\d+)?$/.test(w)) return Number(w);
  return NUMBERS[w] ?? null;
}

/** "a little more" → 1, "more" → 2, "much more" → 4. Signed by more/less. */
function amount(c: string): number {
  const less = /\b(?:less|lower|down|tone it down|calm(?:er)? down|not so|too)\b/.test(c);
  const size = /\b(?:a (?:little|bit|touch|tad)|slightly|little|bit)\b/.test(c)
    ? 1
    : /\b(?:way|much|a lot|really|super|extremely|so much)\b/.test(c)
      ? 4
      : /\bvery\b/.test(c)
        ? 3
        : 2;
  return less ? -size : size;
}

const VERBS =
  "ask|tell|say|stop|be|make|respond|reply|answer|give|look|laugh|smile|slow|speed|wait|change|don'?t|do not|skip|ignore|mute|talk|act|sound|keep|go|get|switch|move|shout|try|hold|pause|resume|start|avoid|drop|calm|tone|play|pretend|thank|welcome|react";

/** One utterance → its clauses: "Respond to Mike next. Tell him…" is two. */
export function splitClauses(text: string): string[] {
  const re = new RegExp(`\\s*(?:[.!;?]+(?=\\s|$)|\\band then\\b|,?\\s*\\bthen\\b|,\\s*(?=(?:${VERBS})\\b)|\\band\\s+(?=(?:${VERBS})\\b))\\s*`, "i");
  return text
    .split(re)
    .map((c) => c?.trim())
    .filter((c): c is string => !!c && /[a-z0-9]/i.test(c));
}

/** Drop "Alex," / "hey Alex" / "please" / "can you" — the command is what's left. */
export function stripLead(clause: string, name: string): string {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return clause
    .replace(new RegExp(`^(?:(?:hey|ok(?:ay)?|alright|so|and|now)\\s+)*(?:${n})\\b[,:]?\\s*`, "i"), "")
    .replace(/^(?:(?:hey|ok(?:ay)?|alright|so|and|now)[,]?\s+)+/i, "")
    .replace(/^(?:please\s+|can you\s+|could you\s+|would you\s+|i (?:want|need) you to\s+|go ahead and\s+|i'?d like you to\s+)+/i, "")
    .replace(/[,\s]+please$/i, "")
    .trim();
}

/** The message part of "tell him I disagree", from Alex's point of view. */
export function fromAlex(msg: string): string {
  return msg
    .replace(/\bI'm\b/g, "you're")
    .replace(/\bI am\b/g, "you are")
    .replace(/\bI\b/g, "you")
    .replace(/\bme\b/gi, "you")
    .replace(/\bmy\b/gi, "your")
    .replace(/\b(?:him|her)\b/gi, "them")
    .replace(/\b(?:he|she)\b/gi, "they")
    .replace(/\s+/g, " ")
    .trim();
}

const FOCUS =
  /^(?:that|this|it|him|her|them|that one|this one|that person|this person|that guy|that girl|that user|that viewer|the last one|the last (?:question|comment|message)|(?:that|this|the) (?:question|comment|message|one))$/i;

/** "that question" → focus · "Mike's question" → Mike · "@mike23" → mike23. */
export function targetFrom(raw: string): TargetRef | null {
  const s = raw
    .trim()
    .replace(/[.!?,]+$/, "")
    .replace(/\s+(?:next|now|first|right now|right away|asap)$/i, "")
    .replace(/'s\s+(?:question|comment|message|one)$/i, "")
    .trim();
  if (!s) return null;
  if (FOCUS.test(s)) return { by: "focus" };
  const at = s.match(/^@([\w.]{1,32})$/);
  if (at) return { by: "name", name: at[1] };
  const cleaned = s.replace(/^(?:to|at|the user|the viewer|user|viewer)\s+/i, "").replace(/^@/, "");
  if (/^[\p{L}\p{N}_.'-]{2,32}(?:\s[\p{L}\p{N}_.'-]{2,32})?$/u.test(cleaned) && !/^(?:everyone|everybody|people|all|(?:the )?(?:chat|room|audience|crowd|stream|viewers))$/i.test(cleaned)) {
    return { by: "name", name: cleaned };
  }
  return null;
}

// ---- Traits ------------------------------------------------------------------

const EMOTION_WORDS: [RegExp, Emotion][] = [
  [/\bsarcas/, "sarcastic"],
  [/\b(?:confident|sure of yourself|assertive|bold)\b/, "confident"],
  [/\b(?:surprised|shocked|amazed|astonished)\b/, "surprised"],
  [/\b(?:annoyed|irritated|grumpy|fed up|exasperated)\b/, "annoyed"],
  [/\b(?:playful|cheeky|teasing|mischievous)\b/, "playful"],
  [/\b(?:excited|hyped|pumped|thrilled)\b/, "excited"],
  [/\b(?:thoughtful|reflective|pensive)\b/, "thoughtful"],
  [/\b(?:happy|warm|cheerful|smile|smiling|smiley|friendlier|nicer|kind)\b/, "happy"],
  [/\bcalm\b/, "calm"],
];

function emotionIn(c: string): Emotion | null {
  for (const [re, e] of EMOTION_WORDS) if (re.test(c)) return e;
  return null;
}

function tuneIn(c: string): Tune | null {
  const n = amount(c);
  const t: Tune = {};
  if (/\b(?:funn(?:y|ier)|jok(?:ey|ier|es)|humou?r(?:ous)?|hilarious|silly|sillier)\b/.test(c)) t.humor = /\bless (?:funny|jokey|silly)\b|\bserious\b/.test(c) ? -Math.abs(n) : n;
  if (/\b(?:serious|no jokes|stop joking)\b/.test(c)) t.humor = -Math.abs(n);
  if (/\b(?:energ(?:y|etic)|hype|upbeat|lively|louder|livelier|pumped)\b/.test(c)) t.energy = /\bless energ/.test(c) ? -Math.abs(n) : Math.abs(n);
  if (/\b(?:chill(?:er)?|laid[- ]back|relaxed|mellow|low[- ]key|quieter|calm(?:er)? down|tone it down)\b/.test(c)) t.energy = -Math.abs(n);
  if (/\b(?:expressive|animated|dramatic)\b/.test(c)) t.expressiveness = /\bless (?:expressive|animated|dramatic)\b/.test(c) ? -Math.abs(n) : Math.abs(n);
  if (/\b(?:subtle|understated|deadpan)\b/.test(c)) t.expressiveness = -Math.abs(n);
  if (/\b(?:interactive|engaging|involve|more people involved|ask (?:more|people) questions|get (?:more )?people (?:involved|talking))\b/.test(c)) t.interaction = Math.abs(n);
  return Object.keys(t).length ? t : null;
}

function presetIn(c: string): PresetId | null {
  if (!/\b(?:personality|mode|vibe|persona|character|preset)\b/.test(c) && !/^(?:be|go|switch to|become) (?:the )?(?:energetic host|host)\b/.test(c)) return null;
  if (/\b(?:laid[- ]back|chill|relaxed|mellow|low[- ]key)\b/.test(c)) return "chill";
  if (/\b(?:funny|entertaining|comedian|comedy)\b/.test(c)) return "funny";
  if (/\b(?:friendly|social|welcoming)\b/.test(c)) return "friendly";
  if (/\b(?:confident|charismatic)\b/.test(c)) return "charismatic";
  if (/\b(?:host|hype|energetic)\b/.test(c)) return "host";
  return null;
}

const NEXT = /\b(?:next (?:response|reply|answer|one|line|comment|question)|this time|for the next|when you answer|when you respond|in your next)\b/;

// ---- The parser -----------------------------------------------------------------

/** One clause → directions. Null when the parser can't place it. */
function parseClause(clause: string, prev: Directive | undefined, ctx: CommandContext): Directive[] | null {
  const o = clause;
  const c = o.toLowerCase();

  // Back to normal.
  if (/^(?:reset|back to normal|go back to normal|be yourself(?: again)?|normal again|drop the act|default personality)\b/.test(c)) return [{ type: "reset" }];

  // Topics to stay away from (before "stop talking", which pauses).
  const avoid =
    c.match(/^(?:stop|quit) (?:talking|going on|rambling) about (.+)$/) ??
    c.match(/^(?:don'?t|do not|never) (?:talk about|bring up|mention|discuss) (.+)$/) ??
    c.match(/^(?:avoid|stay away from|steer clear of|drop|leave) (?:the (?:topic|subject) of |talking about )?(.+?)(?: alone)?$/);
  if (avoid) {
    const topic = avoid[1].replace(/[.!?]+$/, "").trim();
    if (/^(?:that|this|it|that subject|this subject|that topic|this topic|the subject|the topic)$/.test(topic)) {
      return [{ type: "note", scope: "next", text: ctx.topic ? `Drop the subject of “${ctx.topic.slice(0, 80)}” and move on` : "Drop the current subject and move on" }];
    }
    return [{ type: "avoid", topic: topic.slice(0, 60) }];
  }

  if (/^(?:pause|stop talking|hold on|hold up|be quiet|go quiet|quiet|shh+|stop for a (?:sec|second|moment|minute)|take a break)\b/.test(c) && !/\d|seconds?/.test(c)) return [{ type: "pause" }];
  if (/^(?:resume|go again|carry on|keep going|you can talk(?: again)?|unpause|start talking(?: again)?|back on)\b/.test(c)) return [{ type: "resume" }];

  // Waiting.
  const wait = c.match(/^(?:wait|pause|hold(?: on)?|give it|take) (?:for )?(a couple|a few|[\w-]+) (?:more )?(?:seconds?|secs?)\b/);
  if (wait) {
    const n = numberFrom(wait[1]);
    if (n !== null) return [{ type: "wait", seconds: Math.min(60, Math.max(1, Math.round(n))) }];
  }

  // Say exactly.
  const exact = o.match(/^say (?:exactly|word for word|this)[,:]?\s+["“]?(.+?)["”]?$/i) ?? o.match(/^say\s+["“](.+?)["”]$/i);
  if (exact) return [{ type: "say", text: exact[1].trim() }];

  // Shout-outs.
  const shout = o.match(/^(?:give|do) (.+?) a (?:shout ?out|shout-out|quick shout ?out)$/i) ?? o.match(/^shout ?out (?:to )?(.+)$/i);
  if (shout) {
    const t = targetFrom(shout[1]);
    if (t) return [{ type: "cue", kind: "shoutout", intent: "Give them a warm shout-out by name", target: t }];
  }

  // "Tell him that's a ridiculous question" right after "Respond to Mike".
  // "that" is kept: "tell her that is a ridiculous question" needs it, and
  // "tell them that they're wrong" reads fine with it.
  const tellPronoun = o.match(/^tell (him|her|them)\s+(.+)$/i);
  if (tellPronoun && prev?.type === "reply") {
    return [{ ...prev, instruction: `Tell them ${fromAlex(tellPronoun[2])}` }];
  }
  const tell = o.match(/^tell ([@\w.'-]+(?: [\w.'-]+)??)\s+(.+)$/i);

  if (tell && !/^(?:everyone|everybody|chat|people|them all|the (?:room|chat|audience))$/i.test(tell[1])) {
    const t = targetFrom(tell[1]);
    if (t) return [{ type: "reply", target: t, instruction: `Tell them ${fromAlex(tell[2])}`, promote: true }];
  }

  // Manner tied to a person: "smile when responding to Sarah".
  const manner = o.match(/^(.+?) when (?:you(?:'re)? )?(?:respond|answer|repl|talk|speak)\w* (?:to )?(.+)$/i);
  if (manner && !/^(?:them|everyone)$/i.test(manner[2])) {
    const t = targetFrom(manner[2]);
    if (t) {
      const e = emotionIn(manner[1].toLowerCase());
      return [{ type: "reply", target: t, instruction: manner[1].trim(), promote: false, ...(e ? { expression: e } : {}) }];
    }
  }
  // Manner for the next answer: "look surprised when you answer".
  if (/ when (?:you(?:'re)? )?(?:answer|respond|reply|talk)\w*$/.test(c) || NEXT.test(c)) {
    const e = emotionIn(c);
    const out: Directive[] = [{ type: "note", scope: "next", text: o.replace(/[.!]+$/, "") }];
    if (e) out.push({ type: "act", emotion: e, scope: "next" });
    return out;
  }

  // Answer / respond / reply to someone.
  const reply = o.match(/^(?:(?:respond|reply|answer|get back)(?: to)?|(?:talk|speak|go|get) to) (.+)$/i);
  if (reply) {
    const t = targetFrom(reply[1]);
    if (t) return [{ type: "reply", target: t, instruction: "", promote: true }];
  }
  const thank = o.match(/^(?:thank|welcome|greet|say (?:hi|hello) to) (.+)$/i);
  if (thank) {
    const t = targetFrom(thank[1]);
    if (t) return [{ type: "reply", target: t, instruction: `${o.split(" ")[0].replace(/^say$/i, "Say hi to")} them`.replace(/^(\w)/, (m) => m.toUpperCase()), promote: true }];
  }

  // Skip / ignore / mute.
  const dont = o.match(/^(?:don'?t|do not) (?:answer|respond to|reply to|read)\s*(.*)$/i);
  if (dont) {
    const t = targetFrom(dont[1] || "that") ?? { by: "focus" };
    return [{ type: "skip", target: t }];
  }
  const skip = o.match(/^(?:skip|pass on|leave) (.+)$/i);
  if (skip) {
    const t = targetFrom(skip[1]);
    if (t) return [{ type: "skip", target: t }];
  }
  const ignore = o.match(/^(?:ignore|mute|block|silence|stop answering|stop responding to) (.+)$/i);
  if (ignore) {
    const rest = ignore[1].replace(/\s+(?:from now on|for the rest of the stream|for now)$/i, "");
    const t = targetFrom(rest);
    if (t) {
      const aboutComment = /\b(?:question|comment|message|one)\b/i.test(rest) || (t.by === "focus" && /^(?:that|this|it)$/i.test(rest));
      return [aboutComment ? { type: "skip", target: t } : { type: "mute", target: t }];
    }
  }

  // The room.
  const room = o.match(/^(?:ask|poll|get) (?:everyone|everybody|the (?:room|chat|audience)|chat|people|the viewers|all of them|them all)\b[,:]?\s*(.*)$/i);
  if (room) return [{ type: "cue", kind: "audience", intent: `Ask everyone ${fromAlex(room[1] || "a question to get them talking")}`.trim() }];
  const subject = o.match(/^(?:change the (?:subject|topic)|switch (?:the )?(?:subject|topic)|move on|talk about|switch to|start talking about|bring up)\b(?: to)?\s*(.*)$/i);
  if (subject) return [{ type: "cue", kind: "subject", intent: subject[1] ? `Change the subject to ${subject[1]}` : "Change the subject to something fresh and fun" }];
  if (/^(?:tell|do) (?:a|us a|them a|everyone a) (?:funny )?(?:story|joke|bit)\b/.test(c)) return [{ type: "cue", kind: "bit", intent: o.replace(/^(?:tell|do)\s+/i, "Tell ") }];
  if (/^(?:laugh|react)(?: to that| at that)?$/.test(c)) return [{ type: "cue", kind: "react", intent: "React to what was just said with a real laugh" }];
  if (/^laugh (?:after|at) your (?:next )?joke/.test(c)) {
    return [{ type: "note", scope: "next", text: "Laugh at your own joke — write a short laugh into the line" }, { type: "act", reactions: true, scope: "standing" }];
  }
  if (/^(?:act|pretend|play it|deliver it) (?:like|as if|as though)\b/.test(c)) return [{ type: "note", scope: "next", text: o.replace(/[.!]+$/, "") }];
  const sayIt = o.match(/^say (.+?) to (.+)$/i);
  if (sayIt) {
    const t = targetFrom(sayIt[2]);
    if (t) return [{ type: "reply", target: t, instruction: `Say ${fromAlex(sayIt[1])}`, promote: true }];
  }
  const sayLoose = o.match(/^say (.+)$/i);
  if (sayLoose) return [{ type: "cue", kind: "line", intent: `Say, in your own words: ${fromAlex(sayLoose[1])}` }];

  // Speed.
  if (/\b(?:slow (?:it )?down|speak slower|talk slower|slower|not so fast)\b/.test(c)) return [{ type: "tune", speed: -0.05 * Math.abs(amount(c)) }];
  if (/\b(?:speed (?:it )?up|speak faster|talk faster|faster|pick up the pace)\b/.test(c)) return [{ type: "tune", speed: 0.05 * Math.abs(amount(c)) }];

  // Eyes and head.
  if (/\b(?:eye contact|look (?:at|into) (?:the )?(?:camera|lens|me|us))\b/.test(c)) return [{ type: "act", eyeContact: /\bless\b/.test(c) ? -3 : 3, scope: "standing" }];
  if (/\blook around\b/.test(c)) return [{ type: "act", eyeContact: -3, scope: "standing" }];
  if (/\b(?:head still|stop moving|less head|move (?:your head )?less|stop nodding|stop swaying)\b/.test(c)) return [{ type: "act", headMotion: -3, scope: "standing" }];
  if (/\b(?:move your head|more head|nod more|more movement|nod)\b/.test(c)) return [{ type: "act", headMotion: 3, scope: "standing" }];

  // Personality presets, sliders and emotions.
  const preset = presetIn(c);
  if (preset) return [{ type: "tune", preset }];
  const trait = /^(?:be|get|sound|act|seem|look|go|stay|keep it|play it|feel|turn it|bring|try|more|less|a (?:little|bit) more|a (?:little|bit) less|calm down|tone it down|lighten up)\b/.test(c);
  if (trait || /^(?:smile|frown)\b/.test(c)) {
    const out: Directive[] = [];
    const e = /\b(?:normal|neutral|yourself)\b/.test(c) ? "neutral" : emotionIn(c);
    if (e) out.push({ type: "act", emotion: e, scope: "standing" });
    const t = tuneIn(c);
    if (t) out.push({ type: "tune", ...t });
    if (out.length) return out;
  }
  const t = tuneIn(c);
  if (t && /^(?:more|less|turn|bring|dial|crank|tone)\b/.test(c)) return [{ type: "tune", ...t }];

  return null;
}

const QUESTION = /^(?:what|what's|how|how's|why|who|where|when|which|do you|did you|are you|is it|is there|was|were|have you|should (?:i|we)|would you|any (?:ideas|thoughts)|thoughts)\b/i;

export function parseCommand(text: string, ctx: CommandContext): Parsed {
  const directives: Directive[] = [];
  const leftover: string[] = [];
  const raw = text.replace(/\s+/g, " ").trim();
  const isQ = /\?\s*$/.test(raw) || QUESTION.test(stripLead(raw, ctx.name));

  for (const part of splitClauses(raw)) {
    const clause = stripLead(part, ctx.name);
    if (!clause) continue;
    const prev = directives[directives.length - 1];
    const got = parseClause(clause, prev, ctx);
    if (!got) {
      leftover.push(clause);
      continue;
    }
    // A "tell him…" that refined the previous reply replaces it.
    if (got.length === 1 && prev?.type === "reply" && got[0].type === "reply" && /^tell (?:him|her|them)\b/i.test(clause)) {
      directives[directives.length - 1] = got[0];
    } else directives.push(...got);
  }
  return { directives, leftover, question: isQ && directives.length === 0 };
}

// ---- Checking what a model returned (S4) -------------------------------------------

const TYPES = new Set(["tune", "act", "note", "reply", "skip", "mute", "avoid", "cue", "say", "wait", "pause", "resume", "reset"]);
const CUES = new Set<CueKind>(["subject", "audience", "shoutout", "react", "bit", "line"]);
const STYLES = new Set<ConversationStyle>(["punchy", "conversational", "storyteller"]);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const delta = (v: unknown, lim: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : undefined);

function refFrom(v: unknown): TargetRef | null {
  if (typeof v === "string") return targetFrom(v);
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (r.by === "focus") return { by: "focus" };
  if (r.by === "comment" && typeof r.id === "string" && r.id) return { by: "comment", id: r.id.slice(0, 120) };
  const name = str(r.name ?? r.user ?? r.handle, 32).replace(/^@/, "");
  return name ? targetFrom(name) ?? { by: "name", name } : null;
}

/** Anything claiming to be directions → only well-formed ones, values clamped. */
export function sanitizeDirectives(raw: unknown): Directive[] {
  if (!Array.isArray(raw)) return [];
  const out: Directive[] = [];
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.type !== "string" || !TYPES.has(r.type)) continue;
    const scope: Scope = r.scope === "next" ? "next" : "standing";
    switch (r.type) {
      case "tune": {
        const d: Directive = { type: "tune" };
        const h = delta(r.humor, 10), e = delta(r.energy, 10), x = delta(r.expressiveness, 10), i = delta(r.interaction, 10), s = delta(r.speed, 0.5);
        if (h !== undefined) d.humor = h;
        if (e !== undefined) d.energy = e;
        if (x !== undefined) d.expressiveness = x;
        if (i !== undefined) d.interaction = i;
        if (s !== undefined) d.speed = s;
        if (typeof r.preset === "string" && PRESETS.some((p) => p.id === r.preset)) d.preset = r.preset as PresetId;
        if (typeof r.style === "string" && STYLES.has(r.style as ConversationStyle)) d.style = r.style as ConversationStyle;
        if (Object.keys(d).length > 1) out.push(d);
        break;
      }
      case "act": {
        const d: Directive = { type: "act", scope };
        if (isEmotion(r.emotion)) d.emotion = r.emotion;
        const ey = delta(r.eyeContact, 10), hm = delta(r.headMotion, 10);
        if (ey !== undefined) d.eyeContact = ey;
        if (hm !== undefined) d.headMotion = hm;
        if (typeof r.reactions === "boolean") d.reactions = r.reactions;
        if (Object.keys(d).length > 2) out.push(d);
        break;
      }
      case "note": {
        const t = str(r.text, 160);
        if (t) out.push({ type: "note", text: t, scope });
        break;
      }
      case "reply": {
        const target = refFrom(r.target);
        if (target) {
          out.push({
            type: "reply", target, instruction: str(r.instruction, 240), promote: r.promote !== false,
            ...(isEmotion(r.expression) ? { expression: r.expression } : {}),
          });
        }
        break;
      }
      case "skip":
      case "mute": {
        const target = refFrom(r.target) ?? (r.type === "skip" ? { by: "focus" as const } : null);
        if (target) out.push({ type: r.type, target });
        break;
      }
      case "avoid": {
        const t = str(r.topic, 60);
        if (t) out.push({ type: "avoid", topic: t });
        break;
      }
      case "cue": {
        const intent = str(r.intent, 240);
        const kind = CUES.has(r.kind as CueKind) ? (r.kind as CueKind) : "line";
        const target = r.target ? refFrom(r.target) : null;
        if (intent) out.push({ type: "cue", kind, intent, ...(target ? { target } : {}) });
        break;
      }
      case "say": {
        const t = str(r.text, 280);
        if (t) out.push({ type: "say", text: t });
        break;
      }
      case "wait": {
        const n = typeof r.seconds === "number" ? Math.round(r.seconds) : NaN;
        if (Number.isFinite(n) && n > 0) out.push({ type: "wait", seconds: Math.min(60, n) });
        break;
      }
      default:
        out.push({ type: r.type as "pause" | "resume" | "reset" });
    }
  }
  return out;
}

// ---- Resolving names against the live chat -----------------------------------------

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");

/** Edit distance, capped — speech recognition hears "Mike" as "Mic". */
function close(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Distinct viewers matching a spoken name, newest speaker first. */
export function matchViewers(name: string, comments: ChatRef[]): { handle: string; user: string }[] {
  const n = norm(name);
  if (!n) return [];
  const seen = new Map<string, { handle: string; user: string; score: number }>();
  for (let k = comments.length - 1; k >= 0; k -= 1) {
    const c = comments[k];
    if (seen.has(c.handle)) continue;
    const h = norm(c.handle);
    const u = norm(c.user);
    const words = c.user.toLowerCase().split(/\s+/).map(norm);
    const score =
      // A typed handle is one person; a first name can be several.
      h === n ? 3 : u === n || words.includes(n) || h.startsWith(n) || u.startsWith(n) ? 2 : (n.length >= 3 && (h.includes(n) || u.includes(n))) || close(n, h) || words.some((w) => close(n, w)) ? 1 : 0;
    if (score) seen.set(c.handle, { handle: c.handle, user: c.user, score });
  }
  const all = [...seen.values()];
  const best = Math.max(0, ...all.map((v) => v.score));
  // Everyone at the best level is a real option; more than one means asking.
  return all.filter((v) => v.score === best).map(({ handle, user }) => ({ handle, user }));
}

export interface Clarify {
  /** Index in the parsed list of the direction that needs an answer. */
  index: number;
  question: string;
  options: { label: string; target: Resolved }[];
}

export interface Resolution {
  ready: { directive: Directive<Resolved>; index: number }[];
  clarify: Clarify | null;
  problems: string[];
}

function latestFrom(handle: string, comments: ChatRef[], waitingOnly: boolean): ChatRef | undefined {
  for (let k = comments.length - 1; k >= 0; k -= 1) {
    const c = comments[k];
    if (c.handle === handle && (!waitingOnly || c.waiting)) return c;
  }
  return undefined;
}

function resolveRef(ref: TargetRef, ctx: CommandContext): { ok: Resolved } | { ask: { label: string; target: Resolved }[] } | { fail: string } {
  if (ref.by === "comment" || ref.by === "focus") {
    const id = ref.by === "comment" ? ref.id : ctx.focusId;
    const c = id ? ctx.comments.find((x) => x.id === id) : undefined;
    if (!c) return { fail: ref.by === "focus" ? "Which comment? Select one in the chat first." : "That comment has scrolled away." };
    return { ok: { by: "comment", id: c.id, handle: c.handle, user: c.user, text: c.text } };
  }
  const found = matchViewers(ref.name, ctx.comments);
  if (found.length === 0) return { ok: { by: "watch", name: ref.name } };
  const toTarget = (v: { handle: string; user: string }): Resolved => {
    const waiting = latestFrom(v.handle, ctx.comments, true);
    return { by: "viewer", handle: v.handle, user: v.user, ...(waiting ? { commentId: waiting.id } : {}) };
  };
  if (found.length === 1) return { ok: toTarget(found[0]) };
  return {
    ask: found.slice(0, 4).map((v) => {
      const last = latestFrom(v.handle, ctx.comments, false);
      return { label: `@${v.handle}${last ? ` · “${last.text.slice(0, 40)}”` : ""}`, target: toTarget(v) };
    }),
  };
}

/** Names and "that" → real viewers and comments. An ambiguous name stops and asks. */
export function resolveDirectives(list: Directive[], ctx: CommandContext): Resolution {
  const ready: Resolution["ready"] = [];
  const problems: string[] = [];
  let clarify: Clarify | null = null;
  list.forEach((d, index) => {
    if (!("target" in d) || !d.target) {
      ready.push({ directive: d as Directive<Resolved>, index });
      return;
    }
    const r = resolveRef(d.target, ctx);
    if ("ok" in r) {
      ready.push({ directive: { ...d, target: r.ok } as Directive<Resolved>, index });
    } else if ("ask" in r) {
      if (!clarify) {
        const name = d.target.by === "name" ? d.target.name : "them";
        clarify = { index, question: `Which ${name}?`, options: r.ask };
      }
    } else problems.push(r.fail);
  });
  return { ready, clarify, problems };
}

export function withTarget(d: Directive, target: Resolved): Directive<Resolved> {
  return { ...d, target } as Directive<Resolved>;
}

// ---- What the owner sees (never said aloud) ------------------------------------------

const who = (t: Resolved) => (t.by === "watch" ? t.name : `@${t.handle}`);
const sign = (n: number) => (n > 0 ? "up" : "down");

export function ackFor(d: Directive<Resolved>): string {
  switch (d.type) {
    case "tune": {
      if (d.preset) return `Personality → ${PRESETS.find((p) => p.id === d.preset)?.label ?? d.preset}`;
      const parts: string[] = [];
      if (d.humor) parts.push(`humour ${sign(d.humor)}`);
      if (d.energy) parts.push(`energy ${sign(d.energy)}`);
      if (d.expressiveness) parts.push(`expression ${sign(d.expressiveness)}`);
      if (d.interaction) parts.push(`audience questions ${sign(d.interaction)}`);
      if (d.speed) parts.push(d.speed < 0 ? "speaking slower" : "speaking faster");
      if (d.style) parts.push(`${d.style} style`);
      return parts.length ? `Personality updated — ${parts.join(", ")}` : "Personality updated";
    }
    case "act": {
      const parts: string[] = [];
      if (d.emotion) parts.push(d.emotion === "neutral" ? "back to neutral" : d.emotion);
      if (d.eyeContact) parts.push(d.eyeContact > 0 ? "more eye contact" : "looking around more");
      if (d.headMotion) parts.push(d.headMotion > 0 ? "more head movement" : "keeping still");
      if (d.reactions !== undefined) parts.push(d.reactions ? "reactions on" : "reactions off");
      return `${d.scope === "next" ? "Next reply" : "Performance"}: ${parts.join(", ") || "updated"}`;
    }
    case "note":
      return d.scope === "next" ? `Next reply: ${d.text}` : `Direction noted: ${d.text}`;
    case "reply":
      if (d.target.by === "watch") return `Watching for ${d.target.name} — will answer them as soon as they comment`;
      if (!d.promote) return `When answering ${who(d.target)}: ${d.instruction}`;
      return `${who(d.target)} prioritized${d.instruction ? ` — ${d.instruction}` : ""}`;
    case "skip":
      return d.target.by === "watch" ? `Will skip ${d.target.name}` : `Skipping ${who(d.target)}${d.target.by === "comment" ? `: “${d.target.text.slice(0, 40)}”` : ""}`;
    case "mute":
      return d.target.by === "watch" ? `Will ignore ${d.target.name}` : `Ignoring ${who(d.target)} for this stream`;
    case "avoid":
      return `Avoiding: ${d.topic}`;
    case "cue":
      return d.kind === "subject" ? "Changing conversation topic" : d.kind === "shoutout" && d.target ? `Shout-out queued for ${who(d.target)}` : d.kind === "audience" ? "Asking the room — queued" : "Response queued";
    case "say":
      return "Line queued, word for word";
    case "wait":
      return `Waiting ${d.seconds} s before the next answer`;
    case "pause":
      return "AI paused";
    case "resume":
      return "Back on";
    case "reset":
      return "Direction reset — back to his normal self";
  }
}

// ---- Typed commands (the booth's command bar) ---------------------------------------

export type CommandType = "direction" | "say" | "reply-comment" | "reply-person" | "subject" | "react" | "skip" | "prioritize";

export const COMMAND_TYPES: { id: CommandType; label: string; placeholder: string; needs?: "comment" }[] = [
  { id: "direction", label: "Direction", placeholder: "Talk to Alex, or type a direction…" },
  { id: "say", label: "Say exactly", placeholder: "The exact words Alex says next…" },
  { id: "reply-comment", label: "Reply to comment", placeholder: "How Alex should answer it…", needs: "comment" },
  { id: "reply-person", label: "Reply to person", placeholder: "@name — what to tell them…" },
  { id: "subject", label: "Change subject", placeholder: "New topic (or leave empty)…" },
  { id: "react", label: "React", placeholder: "How he reacts — “laugh”, “act shocked”…" },
  { id: "skip", label: "Skip", placeholder: "Skips the selected comment — or @name to ignore them", needs: "comment" },
  { id: "prioritize", label: "Prioritize", placeholder: "Answer it next — optional note on how…", needs: "comment" },
];

/**
 * The command bar: a chosen type + what was typed + the selected comment →
 * directions, with no guessing. An error says what's missing, in plain words.
 */
export function typedCommand(type: CommandType, text: string, targetId: string | null): { directives: Directive[] } | { error: string } {
  const t = text.replace(/\s+/g, " ").trim();
  const at = t.match(/^@([\w.]{1,32})\b[,:]?\s*(.*)$/);
  const comment: TargetRef | null = targetId ? { by: "comment", id: targetId } : null;
  switch (type) {
    case "direction":
      return t ? { directives: [] } : { error: "Type a direction first." };
    case "say":
      return t ? { directives: [{ type: "say", text: t.slice(0, 280) }] } : { error: "Type the exact words first." };
    case "reply-comment":
      if (!comment) return { error: "Select a comment in the chat first." };
      return { directives: [{ type: "reply", target: comment, instruction: t, promote: true }] };
    case "reply-person": {
      if (at) return { directives: [{ type: "reply", target: { by: "name", name: at[1] }, instruction: at[2], promote: true }] };
      if (!comment) return { error: "Start with @name, or select one of their comments first." };
      return { directives: [{ type: "reply", target: comment, instruction: t, promote: true }] };
    }
    case "subject":
      return { directives: [{ type: "cue", kind: "subject", intent: t ? `Change the subject to ${t}` : "Change the subject to something fresh and fun" }] };
    case "react":
      return { directives: [{ type: "cue", kind: "react", intent: t ? `React — ${t}` : "React to what was just said", ...(comment ? { target: comment } : {}) }] };
    case "skip":
      if (at) return { directives: [{ type: "mute", target: { by: "name", name: at[1] } }] };
      if (!comment) return { error: "Select the comment to skip, or type @name to ignore someone." };
      return { directives: [{ type: "skip", target: comment }] };
    case "prioritize":
      if (at) return { directives: [{ type: "reply", target: { by: "name", name: at[1] }, instruction: at[2], promote: true }] };
      if (!comment) return { error: "Select the comment to move up first." };
      return { directives: [{ type: "reply", target: comment, instruction: t, promote: true }] };
  }
}

// ---- The brain's answer ------------------------------------------------------------


export interface DirectAnswer {
  directives: Directive[];
  /** Alex to the director, privately. Empty when there's nothing to say. */
  reply: string;
  /** A few words for the director's screen. */
  ack: string;
}

/** The interpreter's JSON — fenced, wrapped in prose, or broken — into a checked answer. */
export function parseDirectAnswer(content: string): DirectAnswer {
  const empty: DirectAnswer = { directives: [], reply: "", ack: "" };
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return { ...empty, reply: content.replace(/[{}[\]"`*_#]/g, "").replace(/\s+/g, " ").trim().slice(0, 400) };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return empty;
  }
  return {
    directives: sanitizeDirectives(obj.actions ?? obj.directives),
    reply: str(obj.reply, 400),
    ack: str(obj.ack, 60),
  };
}

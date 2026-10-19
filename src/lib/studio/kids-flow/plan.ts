// ---------------------------------------------------------------------------
// Kids Animation Flow — the plan behind one animated story.
//
// The flow in Jarvis › Studio walks a character picture and a one-line story
// through five stages — Character, Story, Storyboard, Render, Watch — and this
// file is the plan those stages edit: who the hero is (a character sheet the
// renderer cannot misread), how the story moves (a shape), and the beats.
//
// The renderer is the `animate-character-story` skill on the owner's PC (the
// cth9191/animate kit), reached through In Queue. `briefText` is what it
// reads, so it is written in the same strict template the Studio skill uses.
//
// Everything here is pure: the planner route falls back to `draftBeats` when no
// AI key is set, and the checks are what the Storyboard stage shows before
// anything is sent.
// ---------------------------------------------------------------------------

export type Mode = "rebuild" | "puppet";
export type Shape = "journey" | "morph" | "three" | "flash";
export type Length = 30 | 45 | 60;
export type Aspect = "16:9" | "9:16" | "both";
export type Words = "captions" | "music" | "voice";
export type Look = "cut-paper" | "sketchbook" | "riso" | "pixel";
export type Mood = "cozy" | "funny" | "adventurous" | "gentle";
export type Expression = "smile" | "wow" | "focus" | "sad" | "delight";
/** A beat's job in the arc — the silence and the payoff are what the score is built around. */
export type BeatRole = "hook" | "problem" | "journey" | "rush" | "silence" | "payoff" | "return";

export interface CharacterSheet {
  name: string;
  /** "about 7" — what the picture suggests, never a guess presented as fact. */
  age: string;
  build: string;
  skin: string;
  hair: string;
  eyes: string;
  /** Top to bottom, each with its colour. */
  outfit: string;
  signature: string;
  /** The one colour that means him for the whole film. */
  heroColor: string;
  /** Dominant colours sampled from the picture, hex. */
  palette: string[];
}

export interface Beat {
  id: string;
  start: number;
  end: number;
  role: BeatRole;
  /** Where, with its own wall colour. */
  place: string;
  /** Visible action: "leans into the wind, cap pressed down". */
  action: string;
  expression: Expression;
  /** ≤ 6 words, or empty for none. */
  caption: string;
}

export interface KidsFlowDraft {
  title: string;
  story: string;
  mode: Mode;
  shape: Shape;
  length: Length;
  aspect: Aspect;
  words: Words;
  look: Look;
  moods: Mood[];
  sheet: CharacterSheet;
  beats: Beat[];
  /** Must / must-not, in the owner's words. */
  notes: string;
}

export const SHAPES: { id: Shape; label: string; blurb: string }[] = [
  { id: "journey", label: "Journey", blurb: "He chases it through place after place — hard cuts on the beat. Proven." },
  { id: "morph", label: "Morph chain", blurb: "Each world closes into one shape that opens the next. Dreamy, bedtime." },
  { id: "three", label: "Rule of three", blurb: "Three tries, the third works. Funny and simple." },
  { id: "flash", label: "Flash-forward", blurb: "Open on the happy ending, rewind, earn it. The strongest hook." },
];

export const LOOKS: { id: Look; label: string }[] = [
  { id: "cut-paper", label: "Cut paper" },
  { id: "sketchbook", label: "Sketchbook" },
  { id: "riso", label: "Riso print" },
  { id: "pixel", label: "Pixel art" },
];

export const EXPRESSIONS: Expression[] = ["smile", "wow", "focus", "sad", "delight"];

export const DEFAULT_STORY =
  "His kite blows away and he chases it through town, a forest and up a hill, and catches it at sunset";

export function blankSheet(name = "Milo"): CharacterSheet {
  return { name, age: "", build: "", skin: "", hair: "", eyes: "", outfit: "", signature: "", heroColor: "", palette: [] };
}

export function blankDraft(): KidsFlowDraft {
  return {
    title: "",
    story: DEFAULT_STORY,
    mode: "rebuild",
    shape: "journey",
    length: 45,
    aspect: "16:9",
    words: "captions",
    look: "cut-paper",
    moods: [],
    sheet: blankSheet(),
    beats: [],
    notes: "",
  };
}

/** Beats per length, as the craft table in the skill sets it. */
export function beatCount(length: Length): number {
  return length === 30 ? 7 : length === 60 ? 12 : 10;
}

function words(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/**
 * Places named in the story line: "through town, a forest and up a hill" →
 * ["town", "a forest", "a hill"]. Good enough to seed beats that are about
 * THIS story rather than a template's.
 */
export function placesIn(story: string): string[] {
  const m = /\b(?:through|past|across|over|into|to)\s+(.+?)(?:,?\s+and\s+(?:catches|finds|gets|wins|saves|brings|comes|makes)\b|[.!?]|$)/i.exec(story);
  if (!m) return [];
  return m[1]
    .split(/,|\band\b/i)
    .map((p) => p.replace(/^\s*(?:up|down|through|past|across|over|into|to)\s+/i, "").trim())
    .filter((p) => p.length > 1 && p.length < 40)
    .slice(0, 6);
}

/** What he is after, for the captions: "kite" from "His kite blows away". */
export function wantIn(story: string): string {
  const m = /\b(?:his|her|their|the|a)\s+([a-z]+(?:\s+[a-z]+)?)\s+(?:blows|flies|floats|runs|rolls|gets|is|goes|falls)\b/i.exec(story);
  return m ? m[1].toLowerCase() : "treasure";
}

/** Round to the 8th-note grid at 120 BPM (0.25 s), so every cut lands on the beat. */
function grid(t: number): number {
  return Math.round(t * 4) / 4;
}

/**
 * A complete starting storyboard from the story line alone — what the planner
 * returns when no AI is configured, and a sane base the AI is asked to beat.
 * The arc is the skill's: hook, problem, places, rush, silence, payoff, return.
 */
export function draftBeats(input: Pick<KidsFlowDraft, "story" | "length" | "sheet" | "moods">): Beat[] {
  const n = beatCount(input.length);
  const name = input.sheet.name.trim() || "He";
  const want = wantIn(input.story);
  const found = placesIn(input.story);
  const places = found.length ? found : ["the street", "the park", "the woods", "the hill"];
  const journeyCount = Math.max(1, n - 6);
  const cozy = input.moods.includes("cozy");

  const roles: BeatRole[] = ["hook", "problem", ...Array(journeyCount).fill("journey"), "rush", "silence", "payoff", "return"];
  // Durations by role, then scaled to the length; the silence stays short and fixed.
  const base: Record<BeatRole, number> = { hook: 4, problem: 3.5, journey: 4.5, rush: 4, silence: 1.5, payoff: 3.5, return: 3 };
  const fixed = base.silence;
  const flex = roles.reduce((s, r) => s + (r === "silence" ? 0 : base[r]), 0);
  const scale = (input.length - fixed) / flex;

  let t = 0;
  return roles.map((role, i) => {
    const d = role === "silence" ? fixed : base[role] * scale;
    const start = grid(t);
    t += d;
    const end = i === roles.length - 1 ? input.length : grid(t);
    const home = "home";
    const far = places[places.length - 1];
    const place =
      role === "journey" ? places[(i - 2) % places.length]
      : role === "hook" || role === "problem" || role === "return" ? home
      : far;
    const by: Record<BeatRole, Pick<Beat, "action" | "expression" | "caption">> = {
      hook: { action: `${name} plays with the ${want} on a bright windy day, grinning`, expression: "smile", caption: cozy ? "A cozy, windy day" : "Windy day!" },
      problem: { action: `the ${want} slips away; ${name} gasps and reaches after it`, expression: "wow", caption: `Oh no — my ${want}!` },
      journey: { action: `${name} runs through ${place}, eyes on the ${want} above`, expression: "focus", caption: i === 2 ? "Come back!" : "" },
      rush: { action: `four quick cuts: ${name} jumps, ducks, climbs, runs`, expression: "focus", caption: "" },
      silence: { action: `${name} leaps, hand at full stretch — the frame holds`, expression: "focus", caption: "" },
      payoff: { action: `${name} catches the ${want} and tumbles, laughing`, expression: "delight", caption: "Got you!" },
      return: { action: `back where it began at sunset, the ${want} safe, now with a patch`, expression: "smile", caption: "Best day." },
    };
    return { id: `b${i + 1}`, start, end, role, place, ...by[role] };
  });
}

export interface PlanProblem {
  /** Beat id, or "plan" for whole-plan problems. */
  at: string;
  message: string;
}

/**
 * The checks the Storyboard stage shows before anything is sent — the same
 * rules the skill's review enforces later, caught here where they are cheap.
 */
export function checkPlan(d: KidsFlowDraft): PlanProblem[] {
  const out: PlanProblem[] = [];
  if (!d.beats.length) out.push({ at: "plan", message: "No beats yet — write the plan first." });
  if (!d.sheet.name.trim()) out.push({ at: "plan", message: "Give your character a name." });
  if (d.beats.length && !d.beats.some((b) => b.role === "silence")) {
    out.push({ at: "plan", message: "Add a short silence just before the big moment — it is what makes the payoff land." });
  }
  if (d.beats.length && !d.beats.some((b) => b.role === "payoff")) {
    out.push({ at: "plan", message: "No payoff beat — the story needs the moment he gets what he wants." });
  }
  d.beats.forEach((b, i) => {
    const len = b.end - b.start;
    if (len <= 0) out.push({ at: b.id, message: `Beat ${i + 1} ends before it starts.` });
    else if (b.role !== "silence" && b.role !== "rush" && len > 6.5) out.push({ at: b.id, message: `Beat ${i + 1} holds ${len.toFixed(1)} s — kids drift after about 6.` });
    if (words(b.caption) > 6) out.push({ at: b.id, message: `Beat ${i + 1}'s caption is ${words(b.caption)} words — keep it to 6.` });
    if (!b.action.trim()) out.push({ at: b.id, message: `Beat ${i + 1} needs an action.` });
    const next = d.beats[i + 1];
    if (next && Math.abs(next.start - b.end) > 0.01) out.push({ at: next.id, message: `Beat ${i + 2} doesn't start where beat ${i + 1} ends.` });
  });
  const last = d.beats[d.beats.length - 1];
  if (last && Math.abs(last.end - d.length) > 3) {
    out.push({ at: "plan", message: `The beats run ${last.end.toFixed(0)} s but you asked for ${d.length} s.` });
  }
  return out;
}

const LOOK_LABEL: Record<Look, string> = { "cut-paper": "cut paper", sketchbook: "sketchbook", riso: "riso print", pixel: "pixel art" };
const WORDS_LABEL: Record<Words, string> = { captions: "music + captions", music: "music only", voice: "narrated voice-over" };

function fmt(t: number): string {
  return t.toFixed(1);
}

/** The strict template the PC skill reads. One block of plain text, nothing else. */
export function briefText(d: KidsFlowDraft): string {
  const s = d.sheet;
  const title = d.title.trim() || `${s.name || "Our hero"} and the story`;
  const sheet = [
    s.age && `about ${s.age.replace(/^about\s+/i, "")}`,
    s.build,
    s.skin && `skin ${s.skin}`,
    s.hair && `hair: ${s.hair}`,
    s.eyes && `eyes: ${s.eyes}`,
    s.outfit && `wearing ${s.outfit}`,
    s.signature && `signature: ${s.signature}`,
  ]
    .filter(Boolean)
    .join("; ");
  const lines = [
    `TITLE: ${title}`,
    `SKILL: animate-character-story · MODE: ${d.mode === "rebuild" ? "Rebuild" : "Puppet"} · LOOK: ${LOOK_LABEL[d.look]} · SHAPE: ${d.aspect} · LENGTH: ~${d.length} s · WORDS: ${WORDS_LABEL[d.words]}`,
    `STORY SHAPE: ${SHAPES.find((x) => x.id === d.shape)?.label ?? d.shape}${d.moods.length ? ` · MOOD: ${d.moods.join(", ")}` : ""}`,
    `STORY: ${d.story.trim()}`,
    `CHARACTER (Subject 1): ${s.name || "the hero"}${sheet ? ` — ${sheet}.` : "."}${s.heroColor ? ` His colour: ${s.heroColor}.` : ""}${s.palette.length ? ` Sampled palette: ${s.palette.join(" ")}.` : ""}`,
    "BEATS:",
    ...d.beats.map(
      (b, i) =>
        `${i + 1} · ${fmt(b.start)}–${fmt(b.end)} · ${b.role === "silence" ? "SILENCE — " : b.role === "payoff" ? "LOUDEST HIT — " : ""}${b.place ? `${b.place}: ` : ""}${b.action} · ${b.expression} · ${b.caption.trim() ? `caption: "${b.caption.trim()}"` : "(no caption)"}`,
    ),
    "SOUND: thin at the start, fullest at the rush, a hard stop for the silence, chord stab + sub on the payoff, a flat chord after. His motif: a rising fifth.",
  ];
  if (d.notes.trim()) lines.push(`NOTES: ${d.notes.trim()}`);
  return lines.join("\n");
}

function str(v: unknown, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

const ROLES: BeatRole[] = ["hook", "problem", "journey", "rush", "silence", "payoff", "return"];

/**
 * Whatever a model sent back, as a plan that cannot break the UI: unknown
 * roles and expressions are clamped, times are re-laid end to end on the grid,
 * captions cut to six words. Returns null when there is nothing usable.
 */
export function coercePlan(raw: unknown, length: Length): { sheet: Partial<CharacterSheet>; beats: Beat[] } | null {
  const r = (raw ?? {}) as { sheet?: Record<string, unknown>; beats?: unknown[] };
  const rawBeats = Array.isArray(r.beats) ? r.beats.slice(0, 16) : [];
  let t = 0;
  const beats: Beat[] = rawBeats
    .map((b) => (b ?? {}) as Record<string, unknown>)
    .filter((b) => str(b.action))
    .map((b, i) => {
      const role = ROLES.includes(b.role as BeatRole) ? (b.role as BeatRole) : "journey";
      const want = Number(b.seconds ?? (Number(b.end) - Number(b.start)));
      const d = Number.isFinite(want) && want > 0 ? Math.min(8, Math.max(1, want)) : 4;
      const start = grid(t);
      t += d;
      return {
        id: `b${i + 1}`,
        start,
        end: grid(t),
        role,
        place: str(b.place, 60),
        action: str(b.action, 240),
        expression: EXPRESSIONS.includes(b.expression as Expression) ? (b.expression as Expression) : "smile",
        caption: str(b.caption, 60).split(/\s+/).filter(Boolean).slice(0, 6).join(" "),
      };
    });
  if (!beats.length) return null;
  // Stretch to the asked length so the board and the brief agree.
  const total = beats[beats.length - 1].end;
  if (total > 0 && Math.abs(total - length) > 0.5) {
    const k = length / total;
    let at = 0;
    beats.forEach((b, i) => {
      const d = (b.end - b.start) * k;
      b.start = grid(at);
      at += d;
      b.end = i === beats.length - 1 ? length : grid(at);
    });
  }
  const s = r.sheet ?? {};
  const sheet: Partial<CharacterSheet> = {};
  for (const k of ["age", "build", "skin", "hair", "eyes", "outfit", "signature", "heroColor"] as const) {
    const v = str(s[k], 240);
    if (v) sheet[k] = v;
  }
  return { sheet, beats };
}

/** Re-time beats end to end after an edit to one beat's length. */
export function relay(beats: Beat[]): Beat[] {
  let t = 0;
  return beats.map((b, i) => {
    const d = Math.max(0.5, b.end - b.start);
    const start = grid(t);
    t += d;
    return { ...b, start, end: grid(t) };
  });
}

/** Total running time, for the timeline ruler. */
export function runtimeOf(beats: Beat[]): number {
  return beats.length ? beats[beats.length - 1].end : 0;
}

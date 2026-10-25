// ---------------------------------------------------------------------------
// 3D Animation Flow — the plan behind one 3D animated story.
//
// The 3D sibling of Kids Animation Flow. Same five stages (Character, Story,
// Storyboard, Render, Watch), but the film is a real Three.js scene made in
// code: a toy-figure hero built from a character spec, worlds built from
// primitives, a director that turns each beat into a camera shot. It plays
// live in the browser while the owner edits, renders to MP4 in the browser,
// and the PC (the threejs-film-story skill) renders the SAME film in HD.
//
// Everything in this file is pure. The beat vocabulary is closed on purpose —
// world, time of day, move, shot, prop and expression are lists the engine
// knows how to draw — so a model's plan can never ask for something the
// renderer can't make. The free-text `action` rides along for the PC skill
// and for the owner, who reads it on the strip.
// ---------------------------------------------------------------------------

import { fromPrompt as kidsFromPrompt, placesIn, wantIn } from "../kids-flow/plan";

export type World =
  | "home" | "town" | "park" | "forest" | "hill" | "beach"
  | "snow" | "space" | "city" | "desert" | "bedroom";
export type TimeOfDay = "morning" | "day" | "sunset" | "night";
export type Move =
  | "idle" | "walk" | "run" | "wave" | "jump" | "cheer" | "dance" | "sit"
  | "point" | "sad" | "reach" | "look" | "talk" | "sleep" | "tumble";
export type Shot = "wide" | "medium" | "close" | "low" | "high" | "follow" | "orbit" | "push" | "overhead";
export type Prop = "none" | "kite" | "balloon" | "ball" | "puppy" | "star" | "gift" | "book" | "robot" | "rocket" | "flower";
export type Expression = "smile" | "wow" | "focus" | "sad" | "delight" | "sleepy";
export type BeatRole = "hook" | "problem" | "journey" | "rush" | "silence" | "payoff" | "return";
export type Look = "toy" | "clay" | "storybook" | "neon";
export type Aspect = "16:9" | "9:16" | "1:1";
export type Length = 30 | 45 | 60;
export type Mood = "cozy" | "funny" | "adventurous" | "gentle";
export type Words = "captions" | "music";

export type HairStyle = "short" | "curly" | "long" | "puffs" | "ponytail" | "spiky" | "afro" | "buzz" | "bun";
export type Accessory = "none" | "cap" | "glasses" | "backpack" | "scarf" | "bow" | "crown" | "headphones" | "cape";
export type TopKind = "tee" | "hoodie" | "dress" | "jacket";
export type BottomKind = "shorts" | "pants" | "skirt";
export type Pattern = "plain" | "stripes" | "dots";
export type Build = "kid" | "teen" | "adult";

export const WORLDS: { id: World; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "town", label: "Town" },
  { id: "park", label: "Park" },
  { id: "forest", label: "Forest" },
  { id: "hill", label: "Hilltop" },
  { id: "beach", label: "Beach" },
  { id: "snow", label: "Snow" },
  { id: "space", label: "Space" },
  { id: "city", label: "City" },
  { id: "desert", label: "Desert" },
  { id: "bedroom", label: "Bedroom" },
];
export const TIMES: TimeOfDay[] = ["morning", "day", "sunset", "night"];
export const MOVES: Move[] = ["idle", "walk", "run", "wave", "jump", "cheer", "dance", "sit", "point", "sad", "reach", "look", "talk", "sleep", "tumble"];
export const SHOTS: { id: Shot; label: string }[] = [
  { id: "wide", label: "Wide" },
  { id: "medium", label: "Medium" },
  { id: "close", label: "Close-up" },
  { id: "low", label: "Low hero" },
  { id: "high", label: "High" },
  { id: "follow", label: "Follow" },
  { id: "orbit", label: "Orbit" },
  { id: "push", label: "Push in" },
  { id: "overhead", label: "Overhead" },
];
export const PROPS: Prop[] = ["none", "kite", "balloon", "ball", "puppy", "star", "gift", "book", "robot", "rocket", "flower"];
export const EXPRESSIONS: Expression[] = ["smile", "wow", "focus", "sad", "delight", "sleepy"];
export const ROLES: BeatRole[] = ["hook", "problem", "journey", "rush", "silence", "payoff", "return"];
export const HAIR_STYLES: HairStyle[] = ["short", "curly", "long", "puffs", "ponytail", "spiky", "afro", "buzz", "bun"];
export const ACCESSORIES: Accessory[] = ["none", "cap", "glasses", "backpack", "scarf", "bow", "crown", "headphones", "cape"];
export const TOP_KINDS: TopKind[] = ["tee", "hoodie", "dress", "jacket"];
export const BOTTOM_KINDS: BottomKind[] = ["shorts", "pants", "skirt"];
export const PATTERNS: Pattern[] = ["plain", "stripes", "dots"];
export const BUILDS: Build[] = ["kid", "teen", "adult"];

export const LOOKS: { id: Look; label: string; blurb: string }[] = [
  { id: "toy", label: "Toy box", blurb: "Glossy toy figures, bright and soft-shadowed" },
  { id: "clay", label: "Clay", blurb: "Matte, chunky, handmade stop-motion feel" },
  { id: "storybook", label: "Storybook", blurb: "Pastel, misty, a bedtime picture book in 3D" },
  { id: "neon", label: "Neon night", blurb: "Glowing edges and deep colour, made for night scenes" },
];

/** The hero, as the engine builds him. Every field is something the rig draws. */
export interface Hero3D {
  name: string;
  build: Build;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  eyes: string;
  top: string;
  topKind: TopKind;
  pattern: Pattern;
  bottom: string;
  bottomKind: BottomKind;
  shoes: string;
  accessory: Accessory;
  /** The one colour that means him: his accessory and the strip's accent. */
  accent: string;
  /** What the picture showed, in words — for the PC skill and the owner. */
  notes: string;
  /** Optional rigged GLB (e.g. a Mixamo character) — PC renders only. */
  model?: string;
}

export interface Beat3D {
  id: string;
  start: number;
  end: number;
  role: BeatRole;
  world: World;
  time: TimeOfDay;
  move: Move;
  expression: Expression;
  shot: Shot;
  prop: Prop;
  /** ≤ 6 words on screen, or empty. */
  caption: string;
  /** Visible action, in words: what the owner reads on the strip. */
  action: string;
}

export interface Film3DDraft {
  title: string;
  story: string;
  length: Length;
  aspect: Aspect;
  look: Look;
  words: Words;
  moods: Mood[];
  hero: Hero3D;
  beats: Beat3D[];
  notes: string;
}

/** What the engine renders: the draft minus everything only the editor needs. */
export interface Film3D {
  title: string;
  aspect: Aspect;
  look: Look;
  captions: boolean;
  moods: Mood[];
  hero: Hero3D;
  beats: Beat3D[];
  seed: number;
  /** No title, fades or flash — for loops like the Character step's turntable. */
  bare?: boolean;
}

export const DEFAULT_STORY =
  "His kite blows away and he chases it through town, a forest and up a hill, and catches it at sunset";

export function defaultHero(name = "Milo"): Hero3D {
  return {
    name,
    build: "kid",
    skin: "#c98b5e",
    hair: "#2b1b14",
    hairStyle: "curly",
    eyes: "#3a2516",
    top: "#f2a93b",
    topKind: "tee",
    pattern: "stripes",
    bottom: "#3e5c9a",
    bottomKind: "shorts",
    shoes: "#e94f37",
    accessory: "cap",
    accent: "#e94f37",
    notes: "",
  };
}

export function blankDraft(): Film3DDraft {
  return {
    title: "",
    story: DEFAULT_STORY,
    length: 45,
    aspect: "16:9",
    look: "toy",
    words: "captions",
    moods: [],
    hero: defaultHero(),
    beats: [],
    notes: "",
  };
}

export function beatCount(length: Length): number {
  return length === 30 ? 7 : length === 60 ? 12 : 10;
}

function grid(t: number): number {
  return Math.round(t * 4) / 4;
}

function words(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

const WORLD_WORDS: [World, RegExp][] = [
  ["bedroom", /\b(bed ?room|room|bed|indoors|inside|nursery)\b/i],
  ["space", /\b(space|moon|planet|stars?|mars|galaxy|orbit)\b/i],
  ["snow", /\b(snow\w*|winter|ice|icy|igloo|north pole|frozen)\b/i],
  ["beach", /\b(beach|sea|ocean|shore|island|lake|harbou?r|pier|bay)\b/i],
  ["desert", /\b(desert|dunes?|cactus|sahara|canyon)\b/i],
  ["city", /\b(city|downtown|skyscrapers?|neon|subway|rooftops?)\b/i],
  ["forest", /\b(forest|woods?|jungle|trees|grove)\b/i],
  ["hill", /\b(hill|hills|mountain|cliff|summit|peak|top)\b/i],
  ["park", /\b(park|playground|pond|meadow|field|garden|zoo|farm)\b/i],
  ["town", /\b(town|street|bakery|shop|market|village|road|school|square|library)\b/i],
  ["home", /\b(home|house|yard|backyard|porch|front door)\b/i],
];

/** The world a place phrase most likely means: "a pine forest" → forest. */
export function worldFor(place: string, fallback: World = "park"): World {
  for (const [w, re] of WORLD_WORDS) if (re.test(place)) return w;
  return fallback;
}

const PROP_WORDS: [Prop, RegExp][] = [
  ["kite", /\bkites?\b/i],
  ["balloon", /\bballoons?\b/i],
  ["ball", /\b(ball|football|soccer ball|basketball)\b/i],
  ["puppy", /\b(pupp(?:y|ies)|dog|doggy|pup|kitten|cat)\b/i],
  ["robot", /\brobots?\b/i],
  ["rocket", /\brockets?\b/i],
  ["gift", /\b(gift|present|toy|teddy)\b/i],
  ["book", /\b(book|map|letter)\b/i],
  ["flower", /\b(flower|rose|daisy|seed)\b/i],
  ["star", /\b(star|treasure|wish|light|gem|crystal)\b/i],
];

/** Every world the story line names, in the order it names them ("beach … city" → beach, city). */
export function worldsIn(story: string): World[] {
  const hits: { at: number; w: World }[] = [];
  for (const [w, re] of WORLD_WORDS) {
    if (w === "home" || w === "bedroom") continue;
    const m = new RegExp(re.source, "gi").exec(story);
    if (m) hits.push({ at: m.index, w });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.w);
}

/** The thing he is after, as a prop the engine can draw. */
export function propFor(text: string): Prop {
  for (const [p, re] of PROP_WORDS) if (re.test(text)) return p;
  return "star";
}

/** Night when the story says so, sunset for the payoff when it says sunset. */
function timesIn(story: string): { base: TimeOfDay; end: TimeOfDay } {
  const night = /\b(night|bedtime|moon|stars|dark)\b/i.test(story);
  const sunset = /\b(sunset|dusk|evening|golden)\b/i.test(story);
  const morning = /\b(morning|sunrise|dawn|breakfast)\b/i.test(story);
  return {
    base: night ? "night" : morning ? "morning" : "day",
    end: night ? "night" : sunset ? "sunset" : morning ? "day" : "sunset",
  };
}

/**
 * A complete starting storyboard from the story line alone — what the planner
 * returns with no AI, and a sane base the AI is asked to beat. The arc is the
 * Kids flow's: hook, problem, places, rush, silence, payoff, return — with a
 * camera language on top: wide to set a world, follow while he travels, low
 * for his bravest moment, push in on the silence, close on the payoff.
 */
export function draftBeats(input: Pick<Film3DDraft, "story" | "length" | "hero" | "moods">): Beat3D[] {
  const n = beatCount(input.length);
  const name = input.hero.name.trim() || "He";
  const want = wantIn(input.story);
  const prop = propFor(`${want} ${input.story}`);
  const fallbacks: World[] = ["town", "park", "forest", "hill"];
  const found = placesIn(input.story);
  const named = worldsIn(input.story);
  let route = found.map((p, i) => ({ place: p, world: worldFor(p, fallbacks[i % fallbacks.length]) }));
  if (new Set(route.map((r) => r.world)).size < named.length) {
    route = named.map((w) => ({ place: `the ${WORLDS.find((x) => x.id === w)!.label.toLowerCase()}`, world: w }));
  }
  if (!route.length) route = fallbacks.map((w) => ({ place: `the ${w}`, world: w }));
  // More journey beats than places named: add new places before the last one
  // (the last is where the story ends up), so no world repeats back to back.
  for (const w of ["park", "town", "forest", "beach", "snow"] as World[]) {
    if (route.length >= Math.max(1, n - 6)) break;
    if (!route.some((r) => r.world === w)) route.splice(route.length - 1, 0, { place: `the ${w}`, world: w });
  }
  const journeyCount = Math.max(1, n - 6);
  const { base, end } = timesIn(input.story);
  const cozy = input.moods.includes("cozy");
  const home: World = /\b(bed ?room|bedtime)\b/i.test(input.story) ? "bedroom" : "home";

  const roles: BeatRole[] = ["hook", "problem", ...Array(journeyCount).fill("journey"), "rush", "silence", "payoff", "return"];
  const dur: Record<BeatRole, number> = { hook: 4, problem: 3.5, journey: 4.5, rush: 4, silence: 1.5, payoff: 3.5, return: 3.5 };
  const flex = roles.reduce((s, r) => s + (r === "silence" ? 0 : dur[r]), 0);
  const scale = (input.length - dur.silence) / flex;
  const far = route[route.length - 1];

  let t = 0;
  return roles.map((role, i) => {
    const d = role === "silence" ? dur.silence : dur[role] * scale;
    const start = grid(t);
    t += d;
    const stop = i === roles.length - 1 ? input.length : grid(t);
    const stop2 = role === "journey" ? route[(i - 2) % route.length] : far;
    const homeBeat = role === "hook" || role === "problem" || role === "return";
    const place = homeBeat ? "home" : stop2.place;
    const world: World = homeBeat ? home : stop2.world;
    const time: TimeOfDay = role === "payoff" || role === "return" || role === "silence" ? end : base;
    const journeyShots: Shot[] = ["follow", "wide", "low", "follow", "orbit", "wide"];
    const by: Record<BeatRole, Pick<Beat3D, "move" | "expression" | "shot" | "caption" | "action">> = {
      hook: { move: "wave", expression: "smile", shot: "wide", caption: cozy ? "A cozy, breezy day" : "Best day ever!", action: `${name} plays with the ${want} outside home, waving at us` },
      problem: { move: "reach", expression: "wow", shot: "medium", caption: `Oh no — my ${want}!`, action: `the ${want} slips away; ${name} gasps and reaches after it` },
      journey: { move: "run", expression: "focus", shot: journeyShots[(i - 2) % journeyShots.length], caption: i === 2 ? "Come back!" : "", action: `${name} runs through ${place}, eyes on the ${want} ahead` },
      rush: { move: "run", expression: "focus", shot: "follow", caption: "", action: `four quick cuts: ${name} runs, jumps, runs, jumps` },
      silence: { move: "reach", expression: "focus", shot: "push", caption: "", action: `${name} leaps, hand at full stretch — the frame holds` },
      payoff: { move: "cheer", expression: "delight", shot: "low", caption: "Got you!", action: `${name} catches the ${want} and cheers` },
      return: { move: "wave", expression: "smile", shot: "wide", caption: "Best day.", action: `back home at ${end === "night" ? "night" : "sunset"}, the ${want} safe` },
    };
    return { id: `b${i + 1}`, start, end: stop, role, world, time, prop, ...by[role] };
  });
}

export interface PlanProblem {
  at: string;
  message: string;
}

export function checkPlan(d: Film3DDraft): PlanProblem[] {
  const out: PlanProblem[] = [];
  if (!d.beats.length) out.push({ at: "plan", message: "No beats yet — write the storyboard first." });
  if (!d.hero.name.trim()) out.push({ at: "plan", message: "Give your character a name." });
  if (d.beats.length && !d.beats.some((b) => b.role === "payoff")) {
    out.push({ at: "plan", message: "No payoff beat — the story needs the moment he gets what he wants." });
  }
  if (d.beats.length && !d.beats.some((b) => b.role === "silence")) {
    out.push({ at: "plan", message: "Add a short silence just before the big moment — it is what makes the payoff land." });
  }
  d.beats.forEach((b, i) => {
    const len = b.end - b.start;
    if (len <= 0) out.push({ at: b.id, message: `Beat ${i + 1} ends before it starts.` });
    else if (b.role !== "silence" && b.role !== "rush" && len > 7) out.push({ at: b.id, message: `Beat ${i + 1} holds ${len.toFixed(1)} s — viewers drift after about 6.` });
    if (words(b.caption) > 6) out.push({ at: b.id, message: `Beat ${i + 1}'s caption is ${words(b.caption)} words — keep it to 6.` });
    const next = d.beats[i + 1];
    if (next && Math.abs(next.start - b.end) > 0.01) out.push({ at: next.id, message: `Beat ${i + 2} doesn't start where beat ${i + 1} ends.` });
  });
  const last = d.beats[d.beats.length - 1];
  if (last && Math.abs(last.end - d.length) > 3) {
    out.push({ at: "plan", message: `The beats run ${last.end.toFixed(0)} s but you asked for ${d.length} s.` });
  }
  return out;
}

/** Re-time beats end to end after one beat's length changed. */
export function relay(beats: Beat3D[]): Beat3D[] {
  let t = 0;
  return beats.map((b) => {
    const d = Math.max(0.5, b.end - b.start);
    const start = grid(t);
    t += d;
    return { ...b, start, end: grid(t) };
  });
}

export function runtimeOf(beats: Beat3D[]): number {
  return beats.length ? beats[beats.length - 1].end : 0;
}

// --- coercion: whatever a model sent, as something the engine can draw -----

function str(v: unknown, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function pick<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (list as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** "#AbC" / "abcdef" / "rgb-ish words" → a #rrggbb, or the fallback. */
export function hexOr(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(s) ?? /#([0-9a-f]{6})\b/i.exec(s);
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

export function coerceHero(raw: unknown, base: Hero3D): Hero3D {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    name: str(r.name, 40) || base.name,
    build: pick(r.build, BUILDS, base.build),
    skin: hexOr(r.skin, base.skin),
    hair: hexOr(r.hair, base.hair),
    hairStyle: pick(r.hairStyle, HAIR_STYLES, base.hairStyle),
    eyes: hexOr(r.eyes, base.eyes),
    top: hexOr(r.top, base.top),
    topKind: pick(r.topKind, TOP_KINDS, base.topKind),
    pattern: pick(r.pattern, PATTERNS, base.pattern),
    bottom: hexOr(r.bottom, base.bottom),
    bottomKind: pick(r.bottomKind, BOTTOM_KINDS, base.bottomKind),
    shoes: hexOr(r.shoes, base.shoes),
    accessory: pick(r.accessory, ACCESSORIES, base.accessory),
    accent: hexOr(r.accent, base.accent),
    notes: str(r.notes, 400) || base.notes,
    ...(typeof r.model === "string" && /^https?:\/\//.test(r.model) ? { model: r.model } : base.model ? { model: base.model } : {}),
  };
}

export function coerceBeats(raw: unknown, length: Length, fallbackProp: Prop = "star"): Beat3D[] {
  const list = Array.isArray(raw) ? raw.slice(0, 16) : [];
  let t = 0;
  const beats: Beat3D[] = list
    .map((b) => (b ?? {}) as Record<string, unknown>)
    .filter((b) => str(b.action) || str(b.world))
    .map((b, i) => {
      const want = Number(b.seconds ?? (Number(b.end) - Number(b.start)));
      const d = Number.isFinite(want) && want > 0 ? Math.min(8, Math.max(1, want)) : 4;
      const start = grid(t);
      t += d;
      const role = pick(b.role, ROLES, "journey");
      return {
        id: `b${i + 1}`,
        start,
        end: grid(t),
        role,
        world: pick(b.world, WORLDS.map((w) => w.id), worldFor(str(b.place) || str(b.action))),
        time: pick(b.time, TIMES, "day"),
        move: pick(b.move, MOVES, role === "journey" || role === "rush" ? "run" : "idle"),
        expression: pick(b.expression, EXPRESSIONS, "smile"),
        shot: pick(b.shot, SHOTS.map((s) => s.id), "medium"),
        prop: pick(b.prop, PROPS, fallbackProp),
        caption: str(b.caption, 60).split(/\s+/).filter(Boolean).slice(0, 6).join(" "),
        action: str(b.action, 240),
      };
    });
  if (!beats.length) return [];
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
  return beats;
}

// --- the film the engine renders, and the compact code the PC reads --------

/** A stable number from a string, so the same draft always draws the same film. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function filmOf(d: Film3DDraft): Film3D {
  const title = d.title.trim() || `${d.hero.name || "Our hero"}'s story`;
  return {
    title,
    aspect: d.aspect,
    look: d.look,
    captions: d.words === "captions",
    moods: d.moods,
    hero: d.hero,
    beats: d.beats,
    seed: hashSeed(`${title}|${d.story}|${d.hero.name}`),
  };
}

const BEAT_KEYS: [keyof Beat3D, string][] = [
  ["role", "r"], ["world", "w"], ["time", "tm"], ["move", "m"], ["expression", "e"],
  ["shot", "sh"], ["prop", "p"], ["caption", "c"], ["action", "a"],
];

/**
 * The film as compact JSON for an In Queue request (which caps text at 4000
 * characters): short keys, durations instead of start/end, actions trimmed.
 * The PC skill reads this and renders exactly what the owner previewed.
 */
export function filmCode(f: Film3D): string {
  const beats = f.beats.map((b) => {
    const o: Record<string, string | number> = { s: Math.round((b.end - b.start) * 100) / 100 };
    for (const [k, short] of BEAT_KEYS) {
      const v = b[k];
      if (k === "action") o[short] = String(v).slice(0, 80);
      else if (v !== "" && v !== undefined) o[short] = v as string;
    }
    return o;
  });
  return JSON.stringify({ v: 1, title: f.title, aspect: f.aspect, look: f.look, captions: f.captions, moods: f.moods, seed: f.seed, hero: f.hero, beats });
}

/** filmCode back into a Film3D (unknown values clamped, times re-laid). */
export function parseFilmCode(code: string): Film3D | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(code);
  } catch {
    return null;
  }
  if (!raw || !Array.isArray(raw.beats)) return null;
  let t = 0;
  const beats: Beat3D[] = (raw.beats as Record<string, unknown>[]).map((o, i) => {
    // Compact code carries durations (s); a full Film3D carries start/end.
    const d = Math.max(0.25, Number(o.s) || Number(o.end) - Number(o.start) || 4);
    const start = Math.round(t * 100) / 100;
    t += d;
    const long: Record<string, unknown> = {};
    for (const [k, short] of BEAT_KEYS) long[k] = o[short] ?? o[k];
    const role = pick(long.role, ROLES, "journey");
    return {
      id: `b${i + 1}`,
      start,
      end: Math.round(t * 100) / 100,
      role,
      world: pick(long.world, WORLDS.map((w) => w.id), "park"),
      time: pick(long.time, TIMES, "day"),
      move: pick(long.move, MOVES, "idle"),
      expression: pick(long.expression, EXPRESSIONS, "smile"),
      shot: pick(long.shot, SHOTS.map((s) => s.id), "medium"),
      prop: pick(long.prop, PROPS, "none"),
      caption: str(long.caption, 60),
      action: str(long.action, 240),
    };
  });
  if (!beats.length) return null;
  return {
    title: str(raw.title, 120) || "Untitled",
    aspect: pick(raw.aspect, ["16:9", "9:16", "1:1"] as const, "16:9"),
    look: pick(raw.look, LOOKS.map((l) => l.id), "toy"),
    captions: raw.captions !== false,
    moods: (Array.isArray(raw.moods) ? raw.moods : []).filter((m): m is Mood => ["cozy", "funny", "adventurous", "gentle"].includes(m as string)),
    seed: Number.isFinite(Number(raw.seed)) ? Number(raw.seed) >>> 0 : 1,
    hero: coerceHero(raw.hero, defaultHero()),
    beats,
  };
}

/** The request the PC reads: a short human summary, then the exact film. */
export function briefText(d: Film3DDraft): string {
  const f = filmOf(d);
  const h = d.hero;
  return [
    `TITLE: ${f.title}`,
    `SKILL: threejs-film-story · LOOK: ${d.look} · SHAPE: ${d.aspect} · LENGTH: ~${d.length} s · WORDS: ${d.words === "captions" ? "music + captions" : "music only"}`,
    `STORY: ${d.story.trim().slice(0, 400)}`,
    `HERO: ${h.name} — ${h.build}, ${h.hairStyle} ${h.hair} hair, ${h.topKind} ${h.top}${h.pattern !== "plain" ? ` (${h.pattern})` : ""}, ${h.bottomKind} ${h.bottom}, ${h.accessory !== "none" ? h.accessory + " " : ""}accent ${h.accent}.${h.notes ? ` ${h.notes.slice(0, 200)}` : ""}`,
    d.notes.trim() ? `NOTES: ${d.notes.trim().slice(0, 300)}` : "",
    "FILM (render exactly this with tools/film3d-render):",
    filmCode(f),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Pull the FILM JSON back out of a request's text (the skill does the same). */
export function filmFromBrief(text: string): Film3D | null {
  const i = text.indexOf('{"v":1');
  return i < 0 ? null : parseFilmCode(text.slice(i).trim());
}

// --- the Studio composer's prompt ------------------------------------------

export interface PromptSeed3D {
  story: string;
  name?: string;
  moods: Mood[];
  length?: Length;
  aspect?: Aspect;
  look?: Look;
  words?: Words;
}

/** "@film-3d Zoe, 30 seconds, vertical, clay — she loses her balloon at the beach" → settings + story. */
export function fromPrompt(text: string, keywords: string[] = []): PromptSeed3D {
  const kids = kidsFromPrompt(text.replace(/\b(?:clay|claymation|toy box|storybook|neon|1:1|square)\b/gi, " "), keywords);
  const all = `${text} ${keywords.join(" ")}`.toLowerCase();
  const seed: PromptSeed3D = {
    story: kids.story.replace(/\b(?:3d|three\.?js)\b/gi, " ").replace(/\s{2,}/g, " ").trim().replace(/^[,;:—–-]+\s*/, ""),
    moods: kids.moods,
    ...(kids.name ? { name: kids.name } : {}),
    ...(kids.length ? { length: kids.length } : {}),
  };
  if (/\b(1:1|square)\b/.test(all)) seed.aspect = "1:1";
  else if (kids.aspect === "9:16" || kids.aspect === "both") seed.aspect = "9:16";
  else if (kids.aspect === "16:9") seed.aspect = "16:9";
  if (/\bclay(?:mation)?\b/.test(all)) seed.look = "clay";
  else if (/\bstorybook|pastel\b/.test(all)) seed.look = "storybook";
  else if (/\bneon\b/.test(all)) seed.look = "neon";
  else if (/\btoy\b/.test(all)) seed.look = "toy";
  if (kids.words === "music") seed.words = "music";
  return seed;
}

// --- no AI: dress the hero from the picture's measured colours -------------

function hsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** Looks like skin: a warm hue, not too grey, not too saturated. */
export function skinLike(hex: string): boolean {
  const { h, s, l } = hsl(hex);
  return h >= 8 && h <= 45 && s > 0.15 && s < 0.75 && l > 0.2 && l < 0.85;
}

/**
 * The palette measured from the picture (most common first) → the hero's
 * colours, when no AI can read the picture: the skin-like colour is the skin,
 * the most common other colour is the top, the next the accent. Near-white and
 * near-black are skipped for clothes (they're usually outlines and paper).
 */
export function heroFromPalette(palette: string[], base: Hero3D): Hero3D {
  const hexes = palette.map((p) => hexOr(p, "")).filter(Boolean);
  if (!hexes.length) return base;
  const skin = hexes.find(skinLike);
  const clothes = hexes.filter((h) => h !== skin && hsl(h).l > 0.12 && hsl(h).l < 0.92);
  return {
    ...base,
    ...(skin ? { skin } : {}),
    ...(clothes[0] ? { top: clothes[0], pattern: "plain" as Pattern } : {}),
    ...(clothes[1] ? { accent: clothes[1] } : {}),
  };
}

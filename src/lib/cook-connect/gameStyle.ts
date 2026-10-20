// ---------------------------------------------------------------------------
// Game Play Design Styling — the one place every cinematic moment in the
// spades table gets its look, words and intensity from.
//
// The table never hard-codes a colour, a banner or an attack name. It asks
// `activeTheme(doc, today)` and draws whatever comes back, so a holiday or a
// special event is a theme swap, not a code change. The owner edits all of
// this from Projects Timeline › Folders › "Game Play Design Styling".
//
// Pure: no browser, no storage. `useGameStyle` adds the storage.
// ---------------------------------------------------------------------------

export type SuitKey = "S" | "H" | "D" | "C";

/** How an attack looks when a card of this suit wins a trick. */
export type AttackKind = "slash" | "fire" | "shards" | "quake";

export interface SuitStyle {
  /** The attack's name, shown as the winning card strikes. */
  attack: string;
  kind: AttackKind;
  /** Main colour of the strike, glow and particles. */
  color: string;
}

export interface Moment {
  on: boolean;
  /** The words that slam onto the screen. */
  text: string;
}

export interface GameTheme {
  id: string;
  name: string;
  /** One emoji that stands for the theme in lists. */
  icon: string;
  /** Table felt: centre and edge of the radial gradient. */
  felt: [string, string];
  /** Extra particles thrown on big moments (emoji). Empty for none. */
  confetti: string[];
  suits: Record<SuitKey, SuitStyle>;
  /** Every trick is a fight: the winning card strikes, the rest are defeated. */
  clash: { on: boolean; intensity: 1 | 2 | 3 };
  spadesBroken: Moment & { thunder: boolean };
  trumpSteal: Moment;
  nilShield: Moment & { color: string };
  set: Moment;
  /**
   * A "Call renig" settling — it ends the game. `text` slams down when the
   * call was right (the renig team loses), `wrong` when it was not (the
   * caller's team loses).
   */
  renege: Moment & { wrong: string };
  boston: Moment;
}

/** Dates are "MM-DD", inclusive, and may wrap past New Year. */
export interface ScheduleEntry {
  themeId: string;
  from: string;
  to: string;
}

export interface GameStyleDoc {
  version: 1;
  /** The theme used when no scheduled theme covers today. */
  activeId: string;
  /** Holiday and event themes that switch themselves on by date. */
  scheduleOn: boolean;
  schedule: ScheduleEntry[];
  themes: GameTheme[];
}

const CLASSIC_SUITS: Record<SuitKey, SuitStyle> = {
  S: { attack: "Shadow Blade", kind: "slash", color: "#a78bfa" },
  H: { attack: "Heartfire", kind: "fire", color: "#fb7185" },
  D: { attack: "Crystal Storm", kind: "shards", color: "#38bdf8" },
  C: { attack: "Ground Pound", kind: "quake", color: "#4ade80" },
};

const CLASSIC_MOMENTS = {
  clash: { on: true, intensity: 2 as const },
  spadesBroken: { on: true, text: "SPADES HAVE BEEN BROKEN", thunder: true },
  trumpSteal: { on: true, text: "UPSET!" },
  nilShield: { on: true, text: "NIL SHIELD", color: "#e8c26a" },
  set: { on: true, text: "SET!" },
  renege: { on: true, text: "RENEGE!", wrong: "WRONG CALL!" },
  boston: { on: true, text: "BOSTON!" },
};

export const CLASSIC: GameTheme = {
  id: "classic",
  name: "Classic",
  icon: "♠",
  felt: ["#16261f", "#101720"],
  confetti: [],
  suits: CLASSIC_SUITS,
  ...CLASSIC_MOMENTS,
};

/** Start a theme from Classic and change only what makes it different. */
function themed(
  id: string, name: string, icon: string, felt: [string, string], confetti: string[],
  suits: Partial<Record<SuitKey, Partial<SuitStyle>>>,
  words: Partial<Record<"spadesBroken" | "trumpSteal" | "nilShield" | "set" | "renege" | "renegeWrong" | "boston", string>>,
  nilColor?: string,
): GameTheme {
  const s = (k: SuitKey) => ({ ...CLASSIC_SUITS[k], ...suits[k] });
  return {
    id, name, icon, felt, confetti,
    suits: { S: s("S"), H: s("H"), D: s("D"), C: s("C") },
    clash: { ...CLASSIC_MOMENTS.clash },
    spadesBroken: { ...CLASSIC_MOMENTS.spadesBroken, text: words.spadesBroken ?? CLASSIC_MOMENTS.spadesBroken.text },
    trumpSteal: { ...CLASSIC_MOMENTS.trumpSteal, text: words.trumpSteal ?? CLASSIC_MOMENTS.trumpSteal.text },
    nilShield: {
      ...CLASSIC_MOMENTS.nilShield,
      text: words.nilShield ?? CLASSIC_MOMENTS.nilShield.text,
      color: nilColor ?? CLASSIC_MOMENTS.nilShield.color,
    },
    set: { ...CLASSIC_MOMENTS.set, text: words.set ?? CLASSIC_MOMENTS.set.text },
    renege: {
      ...CLASSIC_MOMENTS.renege,
      text: words.renege ?? CLASSIC_MOMENTS.renege.text,
      wrong: words.renegeWrong ?? CLASSIC_MOMENTS.renege.wrong,
    },
    boston: { ...CLASSIC_MOMENTS.boston, text: words.boston ?? CLASSIC_MOMENTS.boston.text },
  };
}

export const PRESETS: GameTheme[] = [
  CLASSIC,
  themed("halloween", "Halloween", "🎃", ["#2a1606", "#0d0a12"], ["🎃", "🦇", "👻"],
    {
      S: { attack: "Reaper's Scythe", color: "#c084fc" },
      H: { attack: "Witchfire", color: "#fb923c" },
      D: { attack: "Bone Shatter", color: "#e5e7eb" },
      C: { attack: "Grave Rise", color: "#84cc16" },
    },
    { spadesBroken: "THE SPADES HAVE RISEN", trumpSteal: "SPOOKED!", set: "BURIED!", renege: "CURSED! RENEGE!", renegeWrong: "BOO! WRONG CALL!" },
    "#fb923c"),
  themed("christmas", "Christmas", "🎄", ["#0f2a1a", "#0a1414"], ["❄️", "🎁", "⭐"],
    {
      S: { attack: "Frostbite Slash", color: "#bae6fd" },
      H: { attack: "Yule Flame", color: "#ef4444" },
      D: { attack: "Icicle Storm", color: "#7dd3fc" },
      C: { attack: "Sleigh Stomp", color: "#22c55e" },
    },
    { spadesBroken: "SPADES CAME DOWN THE CHIMNEY", trumpSteal: "STOLE CHRISTMAS!", set: "COAL!", renege: "NAUGHTY LIST! RENEGE!", renegeWrong: "HUMBUG! WRONG CALL!" },
    "#fde68a"),
  themed("valentines", "Valentine's", "💘", ["#2a0d1a", "#14070e"], ["💘", "🌹", "💋"],
    {
      S: { attack: "Heartbreaker", color: "#f472b6" },
      H: { attack: "Cupid's Arrow", color: "#fb7185" },
      D: { attack: "Diamond Ring", color: "#f0abfc" },
      C: { attack: "Love Tap", color: "#fda4af" },
    },
    { spadesBroken: "SPADES BROKE MY HEART", trumpSteal: "HEARTBREAKER!", set: "DUMPED!", renege: "CHEATER! RENEGE!", renegeWrong: "HEARTLESS! WRONG CALL!" },
    "#f9a8d4"),
  themed("fourth-of-july", "Fourth of July", "🎆", ["#0c1a33", "#070b16"], ["🎆", "🇺🇸", "🎇"],
    {
      S: { attack: "Rocket's Red Glare", color: "#f87171" },
      H: { attack: "Liberty Flame", color: "#ef4444" },
      D: { attack: "Star Burst", color: "#60a5fa" },
      C: { attack: "Cannon Blast", color: "#e5e7eb" },
    },
    { spadesBroken: "SPADES ARE FREE", trumpSteal: "INDEPENDENCE!", set: "FIZZLED!" },
    "#93c5fd"),
  themed("new-year", "New Year", "🥂", ["#1a1606", "#0b0a07"], ["🥂", "🎉", "✨"],
    {
      S: { attack: "Midnight Strike", color: "#fcd34d" },
      H: { attack: "Toast of Fire", color: "#fbbf24" },
      D: { attack: "Glitter Bomb", color: "#fde68a" },
      C: { attack: "Ball Drop", color: "#d6d3d1" },
    },
    { spadesBroken: "SPADES RANG IN", trumpSteal: "COUNTDOWN UPSET!", set: "HANGOVER!" },
    "#fcd34d"),
];

export const DEFAULT_SCHEDULE: ScheduleEntry[] = [
  { themeId: "halloween", from: "10-15", to: "10-31" },
  { themeId: "christmas", from: "12-01", to: "12-26" },
  { themeId: "new-year", from: "12-30", to: "01-02" },
  { themeId: "valentines", from: "02-10", to: "02-14" },
  { themeId: "fourth-of-july", from: "07-01", to: "07-05" },
];

export function defaultStyleDoc(): GameStyleDoc {
  return {
    version: 1,
    activeId: "classic",
    scheduleOn: true,
    schedule: DEFAULT_SCHEDULE.map((e) => ({ ...e })),
    themes: PRESETS.map((t) => structuredCloneTheme(t)),
  };
}

function structuredCloneTheme(t: GameTheme): GameTheme {
  return JSON.parse(JSON.stringify(t)) as GameTheme;
}

// --- dates -------------------------------------------------------------------

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isMonthDay = (s: string): boolean => MMDD.test(s);

export function monthDay(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whether today's "MM-DD" falls inside a range, which may wrap past New Year. */
export function inRange(today: string, from: string, to: string): boolean {
  if (!isMonthDay(today) || !isMonthDay(from) || !isMonthDay(to)) return false;
  return from <= to ? today >= from && today <= to : today >= from || today <= to;
}

/** The scheduled entry covering today, if the schedule is on. */
export function scheduledFor(doc: GameStyleDoc, today: Date): ScheduleEntry | null {
  if (!doc.scheduleOn) return null;
  const md = monthDay(today);
  return doc.schedule.find((e) => inRange(md, e.from, e.to) && doc.themes.some((t) => t.id === e.themeId)) ?? null;
}

/** The theme the table should wear today. */
export function activeTheme(doc: GameStyleDoc, today: Date = new Date()): GameTheme {
  const scheduled = scheduledFor(doc, today);
  const id = scheduled?.themeId ?? doc.activeId;
  return doc.themes.find((t) => t.id === id) ?? doc.themes[0] ?? CLASSIC;
}

// --- keeping a stored doc safe -----------------------------------------------

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const KINDS: AttackKind[] = ["slash", "fire", "shards", "quake"];

const str = (v: unknown, fallback: string, max = 60) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

function cleanMoment<M extends Moment>(v: unknown, base: M): M {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { ...base, on: bool(o.on, base.on), text: str(o.text, base.text, 40) };
}

/** Repair a theme read from storage: anything missing or malformed falls back to Classic. */
export function cleanTheme(v: unknown): GameTheme | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, "", 40).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!id) return null;
  const suitsIn = (o.suits && typeof o.suits === "object" ? o.suits : {}) as Record<string, unknown>;
  const suits = {} as Record<SuitKey, SuitStyle>;
  for (const k of ["S", "H", "D", "C"] as SuitKey[]) {
    const s = (suitsIn[k] && typeof suitsIn[k] === "object" ? suitsIn[k] : {}) as Record<string, unknown>;
    suits[k] = {
      attack: str(s.attack, CLASSIC_SUITS[k].attack, 32),
      kind: KINDS.includes(s.kind as AttackKind) ? (s.kind as AttackKind) : CLASSIC_SUITS[k].kind,
      color: color(s.color, CLASSIC_SUITS[k].color),
    };
  }
  const felt = Array.isArray(o.felt) ? o.felt : [];
  const clash = (o.clash && typeof o.clash === "object" ? o.clash : {}) as Record<string, unknown>;
  const intensity = [1, 2, 3].includes(clash.intensity as number) ? (clash.intensity as 1 | 2 | 3) : 2;
  const nil = (o.nilShield && typeof o.nilShield === "object" ? o.nilShield : {}) as Record<string, unknown>;
  const broken = (o.spadesBroken && typeof o.spadesBroken === "object" ? o.spadesBroken : {}) as Record<string, unknown>;
  return {
    id,
    name: str(o.name, id, 40),
    icon: str(o.icon, "♠", 8),
    felt: [color(felt[0], CLASSIC.felt[0]), color(felt[1], CLASSIC.felt[1])],
    confetti: Array.isArray(o.confetti)
      ? o.confetti.filter((c): c is string => typeof c === "string" && c.trim().length > 0).map((c) => c.trim().slice(0, 8)).slice(0, 6)
      : [],
    suits,
    clash: { on: bool(clash.on, true), intensity },
    spadesBroken: { ...cleanMoment(broken, CLASSIC.spadesBroken), thunder: bool(broken.thunder, true) },
    trumpSteal: cleanMoment(o.trumpSteal, CLASSIC.trumpSteal),
    nilShield: { ...cleanMoment(nil, CLASSIC.nilShield), color: color(nil.color, CLASSIC.nilShield.color) },
    set: cleanMoment(o.set, CLASSIC.set),
    renege: {
      ...cleanMoment(o.renege, CLASSIC.renege),
      wrong: str((o.renege && typeof o.renege === "object" ? (o.renege as Record<string, unknown>) : {}).wrong, CLASSIC.renege.wrong, 40),
    },
    boston: cleanMoment(o.boston, CLASSIC.boston),
  };
}

/** Repair a whole stored doc. Never throws; worst case is the defaults. */
export function cleanStyleDoc(v: unknown): GameStyleDoc {
  if (!v || typeof v !== "object") return defaultStyleDoc();
  const o = v as Record<string, unknown>;
  const seen = new Set<string>();
  const themes = (Array.isArray(o.themes) ? o.themes : [])
    .map(cleanTheme)
    .filter((t): t is GameTheme => !!t && !seen.has(t.id) && (seen.add(t.id), true));
  if (!themes.length) return defaultStyleDoc();
  const schedule = (Array.isArray(o.schedule) ? o.schedule : [])
    .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : {}))
    .filter((e) => typeof e.themeId === "string" && isMonthDay(String(e.from)) && isMonthDay(String(e.to)))
    .map((e) => ({ themeId: String(e.themeId), from: String(e.from), to: String(e.to) }));
  const activeId = typeof o.activeId === "string" && seen.has(o.activeId) ? o.activeId : themes[0].id;
  return { version: 1, activeId, scheduleOn: bool(o.scheduleOn, true), schedule, themes };
}

/** A fresh copy of a theme under a new id, for "Duplicate" in the editor. */
export function duplicateTheme(doc: GameStyleDoc, id: string, name?: string): GameStyleDoc {
  const src = doc.themes.find((t) => t.id === id) ?? CLASSIC;
  let n = 2;
  let newId = `${src.id}-${n}`;
  while (doc.themes.some((t) => t.id === newId)) newId = `${src.id}-${++n}`;
  const copy = { ...structuredCloneTheme(src), id: newId, name: name ?? `${src.name} ${n}` };
  return { ...doc, themes: [...doc.themes, copy] };
}

/** Put a preset theme back the way it shipped. Custom themes are left alone. */
export function resetTheme(doc: GameStyleDoc, id: string): GameStyleDoc {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return doc;
  return { ...doc, themes: doc.themes.map((t) => (t.id === id ? structuredCloneTheme(preset) : t)) };
}

/** Per-player: how much of the show to play. Local to each device. */
export type FxLevel = "full" | "quick" | "off";

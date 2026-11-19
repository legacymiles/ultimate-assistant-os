// ---------------------------------------------------------------------------
// AI Rankings — what each category is actually judged on.
//
// A single 0–100 answers "which is best" and hides the only question anyone
// really asks: best at WHAT. The cheapest text-to-speech that still sounds
// human and the most expressive one are different models, and one number
// cannot say so.
//
// So every category carries its own dimensions — text-to-speech is judged on
// naturalness, emotion, clarity, pronunciation accuracy, speed, cost and age;
// text-to-video on motion, prompt adherence, consistency, native audio, clip
// length and cost — each with a weight, and the overall score is their
// weighted blend.
//
// Four places a dimension's 0–100 can come from, in this order:
//
//   metric   a real measured number in the dimension's own unit (120 ms,
//            $0.015 an image, 3.1% word error), mapped onto 0–100 by its scale
//   rated    the owner's 1–10 for that dimension, ×10
//   auto     derived from facts the record already holds — age from the
//            release date, cost from free/freemium/paid, openness from the
//            weights and whether it runs on your own GPU
//   bench    the category's public leaderboard score, which is computed in
//            leaderboard.ts (Elo is relative, so it needs the whole board)
//
// A measured number beats a rating, a rating beats a derivation, and a
// dimension with none of the three is simply absent: the weights renormalise
// over what is known, and the row shows an empty cell rather than a guess.
// Nothing here invents a number.
//
// Pure, and deliberately decoupled from Model: everything arrives through
// DimInput, so this file imports nothing and can be tested on plain objects.
// ---------------------------------------------------------------------------

/** Where a dimension's number came from. */
export type DimSource = "bench" | "metric" | "rated" | "auto";

/**
 * What a measurement the owner typed names as its source.
 *
 * The daily refresh rewrites only the measurements it wrote itself, so this
 * string is what protects a number the owner checked by hand.
 */
export const OWNER_SOURCE = "owner";

/** Facts already on the record that a dimension can be derived from. */
export type AutoKind = "recency" | "openness" | "accessCost";

/** Turns a measured number in a real unit into 0–100. */
export interface MetricScale {
  /** Shown beside the field and in the tooltip: "$/M tokens", "ms", "× realtime". */
  unit: string;
  /** The value that scores 100. */
  good: number;
  /** The value that scores 0. */
  bad: number;
  /**
   * Spread the scale by orders of magnitude rather than evenly. Prices,
   * latencies and context windows are log-shaped: $0.01 → $0.10 an image is
   * the same size of step as $0.10 → $1.00, and a linear scale would call
   * both of the cheap ones free.
   *
   * A log scale needs good and bad above zero; a value at or below zero is
   * read as the best end of the scale.
   */
  log?: boolean;
  /** Only for the wording — the maths reads the direction off good vs bad. */
  lowerIsBetter?: boolean;
}

export interface Dimension {
  id: string;
  /** Full name, in the sheet and the column tooltip. */
  label: string;
  /** 3–4 characters for the board's column header. */
  code: string;
  /** What a high score means here. One line, plain English. */
  hint: string;
  /** Share of the category's score, as a number out of 100. */
  weight: number;
  /** What this dimension mainly is — it decides the editor's affordance. */
  source: DimSource;
  /** Present when a measured number can be typed in. */
  metric?: MetricScale;
  /** Present when it can be derived from the record. */
  auto?: AutoKind;
}

/** One dimension's number for one model. */
export interface DimValue {
  dim: Dimension;
  /** 0–100, or null when nothing is known. */
  value: number | null;
  from: DimSource | null;
  /** The measured number, when `from` is "metric". */
  raw?: number;
}

// ----- the shared library ---------------------------------------------------
//
// Defined once and referenced by every category, so "Cost" means the same
// thing everywhere and a number typed under one category survives a move to
// another. Only the weight, and sometimes the unit or the wording, change.

type DimDef = Omit<Dimension, "id" | "weight">;

const LIB: Record<string, DimDef> = {
  bench: {
    label: "Public score",
    code: "BNCH",
    hint: "The category's own leaderboard, measured from its leader",
    source: "bench",
  },
  curator: {
    label: "Curator",
    code: "CUR",
    hint: "The owner's own rating, out of 10",
    source: "rated",
  },
  recency: {
    label: "Age",
    code: "AGE",
    hint: "How new it is — full marks today, nothing left after 18 months",
    source: "auto",
    auto: "recency",
  },
  openness: {
    label: "Openness",
    code: "OPEN",
    hint: "Open weights you can download, and run on your own GPU",
    source: "auto",
    auto: "openness",
  },
  cost: {
    label: "Cost",
    code: "COST",
    hint: "What it costs you to use — cheaper scores higher",
    source: "metric",
    auto: "accessCost",
    metric: { unit: "$ per use", good: 0.01, bad: 1, log: true, lowerIsBetter: true },
  },
  speed: {
    label: "Speed",
    code: "SPD",
    hint: "How fast it answers",
    source: "metric",
    metric: { unit: "× realtime", good: 40, bad: 0.5, log: true },
  },

  // language
  reasoning: { label: "Reasoning", code: "REAS", hint: "Hard multi-step problems it gets right", source: "rated" },
  coding: { label: "Coding", code: "CODE", hint: "Code that compiles, runs, and does the thing", source: "rated" },
  context: {
    label: "Context",
    code: "CTX",
    hint: "How much it holds at once and still uses",
    source: "metric",
    metric: { unit: "tokens", good: 1_000_000, bad: 8_192, log: true },
  },
  autonomy: {
    label: "Autonomy",
    code: "AUTO",
    hint: "How far it gets on a real task with no hand on the wheel",
    source: "rated",
  },
  codebase: {
    label: "Big repos",
    code: "REPO",
    hint: "Keeps its bearings in a codebase that doesn't fit in context",
    source: "rated",
  },
  tooling: { label: "Tooling", code: "TOOL", hint: "Editors, terminals, CI and MCP it plugs into", source: "rated" },

  // voice
  naturalness: { label: "Naturalness", code: "NAT", hint: "Sounds like a person, not a reader", source: "rated" },
  emotion: { label: "Emotion", code: "EMO", hint: "Carries feeling, and takes direction on it", source: "rated" },
  clarity: {
    label: "Clarity",
    code: "CLR",
    hint: "Clean, artefact-free audio you can put in front of someone",
    source: "rated",
  },
  accuracy: {
    label: "Accuracy",
    code: "ACC",
    hint: "Says the words that were written, names and numbers included",
    source: "metric",
    metric: { unit: "% word error", good: 1, bad: 12, lowerIsBetter: true },
  },
  latency: {
    label: "Latency",
    code: "LAT",
    hint: "How long before it starts answering",
    source: "metric",
    metric: { unit: "ms to first audio", good: 200, bad: 1500, log: true, lowerIsBetter: true },
  },
  interruption: {
    label: "Barge-in",
    code: "INT",
    hint: "Can be cut off mid-sentence and picks the thread back up",
    source: "rated",
  },
  langs: { label: "Languages", code: "LNG", hint: "How many languages it genuinely handles", source: "rated" },
  noise: { label: "Noise", code: "NSE", hint: "Holds up on phone audio, a crowded room, a bad mic", source: "rated" },

  // image
  adherence: { label: "Adherence", code: "ADH", hint: "Does what the prompt actually asked for", source: "rated" },
  detail: { label: "Detail", code: "DET", hint: "Skin, hands, fabric, light — the parts that give it away", source: "rated" },
  text: { label: "Text in image", code: "TXT", hint: "Renders words you can read and spell-check", source: "rated" },
  control: {
    label: "Control",
    code: "CTL",
    hint: "References, LoRAs, masks, poses — steering beyond the prompt",
    source: "rated",
  },
  preservation: {
    label: "Preservation",
    code: "PRS",
    hint: "Changes what you asked and leaves the rest of the picture alone",
    source: "rated",
  },

  // video
  motion: { label: "Motion", code: "MOT", hint: "Movement that obeys physics instead of sliding", source: "rated" },
  consistency: { label: "Consistency", code: "CON", hint: "Faces, clothes and sets survive the whole shot", source: "rated" },
  audio: { label: "Native audio", code: "AUD", hint: "Brings its own sound, speech and effects", source: "rated" },
  duration: {
    label: "Length",
    code: "DUR",
    hint: "How long a usable take it gives you",
    source: "metric",
    metric: { unit: "seconds", good: 60, bad: 4 },
  },
  sync: { label: "Lip sync", code: "SYN", hint: "Mouth matches the words, frame by frame", source: "rated" },
  identity: { label: "Identity", code: "IDY", hint: "Still looks like the same person afterwards", source: "rated" },
  expression: {
    label: "Expression",
    code: "EXP",
    hint: "Face and head move like someone talking, not a puppet",
    source: "rated",
  },

  // music
  vocals: { label: "Vocals", code: "VOC", hint: "Singing you would leave in the mix", source: "rated" },
  structure: { label: "Structure", code: "STR", hint: "Verses, choruses, and an ending that lands", source: "rated" },
  fidelity: { label: "Fidelity", code: "FID", hint: "Clean, full-band audio with no mush", source: "rated" },

  // 3D and worlds
  geometry: { label: "Geometry", code: "GEO", hint: "Shape that holds up from every angle", source: "rated" },
  texture: { label: "Texture", code: "TEX", hint: "Materials and maps you can light", source: "rated" },
  topology: { label: "Topology", code: "TOP", hint: "Clean mesh you can rig and edit, not a scan blob", source: "rated" },
  interactivity: { label: "Interactivity", code: "ITR", hint: "Responds to input now, not after a render", source: "rated" },

  // platforms
  models: { label: "Model range", code: "MDL", hint: "How much of this board you can actually run on it", source: "rated" },
  reliability: { label: "Reliability", code: "REL", hint: "Up, queued sensibly, and not changing under you", source: "rated" },
  ux: { label: "Ease of use", code: "UX", hint: "How quickly you get a result without reading docs", source: "rated" },
  freedom: { label: "Freedom", code: "FRE", hint: "How little it refuses, and how clearly it says the rules", source: "rated" },
};

/** [dimension id, weight, what this category changes about it]. */
type Spec = [string, number] | [string, number, Partial<DimDef>];

const money = (unit: string, good: number, bad: number): Partial<DimDef> => ({
  metric: { unit, good, bad, log: true, lowerIsBetter: true },
});

/**
 * Every category's own dimensions, heaviest-counting first, weights out of 100.
 *
 * The weights are judgements, not measurements, and they are meant to be
 * argued with: they say what this board thinks matters in each field. The
 * public leaderboard carries the most in categories that have a real arena,
 * and least where the only numbers are self-reported.
 */
const CATEGORY_DIMS: Record<string, Spec[]> = {
  llm: [
    ["bench", 28, { label: "Arena Elo", code: "ELO", hint: "LMArena text Elo, measured from the category leader" }],
    ["reasoning", 14],
    ["coding", 13],
    ["cost", 12, money("$/M tokens", 0.2, 40)],
    ["speed", 9, { metric: { unit: "output tokens/s", good: 250, bad: 15 } }],
    ["context", 8],
    ["recency", 6],
    ["curator", 10],
  ],
  "coding-agents": [
    ["bench", 22, { label: "SWE-bench", code: "SWE", hint: "SWE-bench Verified — real GitHub issues closed" }],
    ["autonomy", 17],
    ["codebase", 12],
    ["tooling", 9],
    ["cost", 12, money("$/task", 0.05, 10)],
    ["speed", 8, { metric: { unit: "minutes per task", good: 2, bad: 60, log: true, lowerIsBetter: true } }],
    ["recency", 6],
    ["curator", 14],
  ],
  tts: [
    ["bench", 20, { label: "Speech arena", code: "ARN", hint: "The speech arena for this category, measured from its leader" }],
    ["naturalness", 15],
    ["emotion", 12],
    ["clarity", 10],
    ["accuracy", 10],
    ["speed", 9],
    ["cost", 10, money("$/M characters", 1, 300)],
    ["recency", 6],
    ["curator", 8],
  ],
  "realtime-voice": [
    ["bench", 17, { label: "Audio bench", hint: "Spoken reasoning as a percent — Big Bench Audio and its like" }],
    ["latency", 17],
    ["naturalness", 13],
    ["interruption", 12],
    ["emotion", 8],
    ["cost", 10, money("$/minute", 0.02, 0.5)],
    ["langs", 7],
    ["recency", 6],
    ["curator", 10],
  ],
  stt: [
    ["bench", 16, { label: "ASR board", code: "ASR", hint: "The open ASR leaderboard for this category" }],
    ["accuracy", 22, { metric: { unit: "% word error", good: 2, bad: 20, lowerIsBetter: true } }],
    ["speed", 12, { metric: { unit: "× realtime", good: 150, bad: 1, log: true } }],
    ["langs", 10],
    ["noise", 9],
    ["cost", 10, money("$/hour of audio", 0.01, 2)],
    ["recency", 6],
    ["openness", 5],
    ["curator", 10],
  ],
  image: [
    ["bench", 22, { label: "Image arena", code: "ARN", hint: "Text-to-image arena Elo, measured from the leader" }],
    ["adherence", 16],
    ["detail", 12],
    ["text", 10],
    ["control", 8],
    ["speed", 7, { metric: { unit: "seconds per image", good: 1.5, bad: 60, log: true, lowerIsBetter: true } }],
    ["cost", 10, money("$/image", 0.003, 0.25)],
    ["recency", 6],
    ["curator", 9],
  ],
  "image-edit": [
    ["bench", 20, { label: "Editing arena", code: "ARN", hint: "Image-editing arena Elo, measured from the leader" }],
    ["adherence", 17],
    ["preservation", 16],
    ["detail", 10],
    ["speed", 7, { metric: { unit: "seconds per edit", good: 2, bad: 60, log: true, lowerIsBetter: true } }],
    ["cost", 10, money("$/edit", 0.004, 0.3)],
    ["recency", 6],
    ["curator", 14],
  ],
  "text-to-video": [
    ["bench", 20, { label: "Video arena", code: "ARN", hint: "Text-to-video arena Elo, measured from the leader" }],
    ["motion", 16],
    ["adherence", 12],
    ["consistency", 10],
    ["audio", 8],
    ["duration", 6],
    ["cost", 11, money("$/5s clip", 0.05, 2.5)],
    ["recency", 7],
    ["curator", 10],
  ],
  "image-to-video": [
    ["bench", 20, { label: "Video arena", code: "ARN", hint: "Image-to-video arena Elo, measured from the leader" }],
    ["motion", 16],
    ["adherence", 11],
    ["consistency", 11],
    ["audio", 7],
    ["duration", 6],
    ["cost", 11, money("$/5s clip", 0.05, 2.5)],
    ["recency", 7],
    ["curator", 11],
  ],
  lipsync: [
    ["bench", 14],
    ["sync", 20],
    ["identity", 15],
    ["expression", 11],
    ["langs", 8],
    ["speed", 7, { metric: { unit: "× realtime", good: 4, bad: 0.1, log: true } }],
    ["cost", 10, money("$/minute of output", 0.05, 3)],
    ["recency", 6],
    ["curator", 9],
  ],
  music: [
    ["bench", 18, { label: "Music arena", code: "ARN", hint: "The music arena for this category, measured from its leader" }],
    ["vocals", 14],
    ["structure", 12],
    ["fidelity", 12],
    ["adherence", 11],
    ["duration", 6, { label: "Song length", metric: { unit: "seconds", good: 300, bad: 30 } }],
    ["cost", 10, money("$/song", 0.05, 2)],
    ["recency", 7],
    ["curator", 10],
  ],
  "3d": [
    ["bench", 16, { label: "3D arena", code: "ARN", hint: "3D Arena Elo, measured from the leader" }],
    ["geometry", 16],
    ["texture", 13],
    ["topology", 12],
    ["speed", 8, { metric: { unit: "seconds per mesh", good: 10, bad: 300, log: true, lowerIsBetter: true } }],
    ["cost", 10, money("$/mesh", 0.02, 2)],
    ["recency", 6],
    ["openness", 7],
    ["curator", 12],
  ],
  "world-models": [
    ["bench", 14],
    ["consistency", 18, { hint: "The world stays put when you look away and come back" }],
    ["interactivity", 15],
    ["fidelity", 12, { hint: "How good it looks while you are moving through it" }],
    [
      "duration",
      10,
      {
        label: "Session length",
        hint: "How long it holds together before it drifts",
        metric: { unit: "seconds", good: 300, bad: 20 },
      },
    ],
    ["speed", 8, { metric: { unit: "frames/s", good: 30, bad: 5 } }],
    ["cost", 9, money("$/minute", 0.05, 3)],
    ["recency", 6],
    ["curator", 8],
  ],
  platforms: [
    ["bench", 10],
    ["models", 17],
    ["cost", 16, money("$/month", 5, 100)],
    ["reliability", 12],
    ["speed", 10, { metric: { unit: "× realtime", good: 10, bad: 0.2, log: true } }],
    ["ux", 10],
    ["freedom", 8],
    ["recency", 6],
    ["curator", 11],
  ],
};

const built = new Map<string, Dimension[]>();

/** The dimensions this category is judged on, heaviest-counting first. */
export function dimsOf(category: string): Dimension[] {
  const cached = built.get(category);
  if (cached) return cached;
  const specs = CATEGORY_DIMS[category];
  if (!specs) {
    built.set(category, []);
    return [];
  }
  const dims = specs.map(([id, weight, over]) => {
    const base = LIB[id];
    if (!base) throw new Error(`ai-rankings: category "${category}" asks for unknown dimension "${id}"`);
    return { ...base, ...(over ?? {}), id, weight } as Dimension;
  });
  built.set(category, dims);
  return dims;
}

/** One dimension by id within a category. */
export function dimOf(category: string, id: string): Dimension | undefined {
  return dimsOf(category).find((d) => d.id === id);
}

/** Every dimension id any category uses, for cleaning stored input. */
export const ALL_DIM_IDS: string[] = Object.keys(LIB);

// ----- the maths ------------------------------------------------------------

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Full marks the day it ships, nothing left this long after. */
export const RECENCY_ZERO_DAYS = 540;

/**
 * A measured number on the 0–100 scale.
 *
 * good scores 100, bad scores 0, and the direction comes from which of the two
 * is larger — so one formula serves "lower is better" (a price, a latency, a
 * word-error rate) and "higher is better" (tokens a second, seconds of video)
 * with no branch to get wrong.
 */
export function scoreMetric(value: number, s: MetricScale): number | null {
  if (!Number.isFinite(value)) return null;
  if (s.log) {
    // Free, or instant: the best end of a scale that cannot take log(0).
    if (value <= 0) return s.good < s.bad ? 100 : 0;
    if (!(s.good > 0) || !(s.bad > 0)) return null;
    const t = (Math.log10(value) - Math.log10(s.good)) / (Math.log10(s.bad) - Math.log10(s.good));
    return clamp(100 - t * 100);
  }
  const t = (value - s.good) / (s.bad - s.good);
  return clamp(100 - t * 100);
}

/** Everything a model's dimensions are worked out from. */
export interface DimInput {
  category: string;
  /** Days since release, or null when the date is unknown. */
  ageDays: number | null;
  openSource: boolean;
  runsLocally: boolean;
  access: "free" | "freemium" | "paid";
  /** The owner's overall 1–10. */
  myRating?: number;
  /** The owner's 1–10 per dimension id. */
  ratings?: Record<string, number>;
  /** Measured numbers per dimension id, in that dimension's unit. */
  metrics?: Record<string, number>;
  /** The public leaderboard score on the 0–100 scale, from leaderboard.ts. */
  bench: number | null;
}

function autoValue(kind: AutoKind, m: DimInput): number | null {
  switch (kind) {
    case "recency":
      return m.ageDays === null || !Number.isFinite(m.ageDays)
        ? null
        : clamp(100 - (Math.max(0, m.ageDays) / RECENCY_ZERO_DAYS) * 100);
    case "openness":
      // Open weights you can run yourself is the whole point; open weights too
      // big for any consumer GPU are still most of the value.
      return m.openSource && m.runsLocally ? 100 : m.openSource ? 85 : m.runsLocally ? 50 : 10;
    case "accessCost":
      // Only a stand-in until a real price is typed in, so it stays coarse.
      return m.access === "free" ? 90 : m.access === "freemium" ? 60 : 30;
  }
}

/**
 * Every dimension of this model's category, with the best number available.
 *
 * Measured beats rated beats derived. The curator dimension reads the overall
 * 1–10 unless a per-dimension rating overrides it, so the rating the owner has
 * always given keeps counting without being typed again.
 */
export function dimValues(m: DimInput): DimValue[] {
  return dimsOf(m.category).map((dim) => {
    const metric = m.metrics?.[dim.id];
    if (dim.metric && typeof metric === "number") {
      const value = scoreMetric(metric, dim.metric);
      if (value !== null) return { dim, value, from: "metric" as const, raw: metric };
    }
    const rated = m.ratings?.[dim.id];
    if (typeof rated === "number" && Number.isFinite(rated)) {
      return { dim, value: clamp(rated * 10), from: "rated" as const };
    }
    if (dim.id === "curator" && typeof m.myRating === "number" && Number.isFinite(m.myRating)) {
      return { dim, value: clamp(m.myRating * 10), from: "rated" as const };
    }
    if (dim.source === "bench") {
      return m.bench === null
        ? { dim, value: null, from: null }
        : { dim, value: clamp(m.bench), from: "bench" as const };
    }
    if (dim.auto) {
      const value = autoValue(dim.auto, m);
      if (value !== null) return { dim, value, from: "auto" as const };
    }
    return { dim, value: null, from: null };
  });
}

/** A number somebody actually established, rather than one derived from the record. */
export function isEvidence(from: DimSource | null): boolean {
  return from === "bench" || from === "rated" || from === "metric";
}

/**
 * What a derived value counts for, against a number somebody established.
 *
 * A cost of 30 because a model is "paid" is a guess standing in for a price
 * nobody has looked up, and at full weight that guess was enough to decide a
 * category: a free model took first place over a measured frontier one on the
 * strength of the word "free". Half weight keeps the difference real — free
 * IS better than paid — without letting a stand-in outvote a measurement.
 *
 * It is a discount on influence, not on honesty: `coverage` still counts the
 * dimension as known, because it is. And the discount ends the moment the
 * number stops being a guess — a price typed into the sheet, or one the daily
 * refresh reads from Artificial Analysis, counts in full.
 */
export const DERIVED_WEIGHT = 0.5;

export interface Blend {
  /**
   * 0–100 to one decimal, or null when nothing has been established about it.
   *
   * Derivations alone are never a score: age, openness and a price guessed
   * from "free" would hand a brand-new open repo nobody has tried a seat
   * above a measured frontier model. One real number — an arena score, a
   * rating, a measurement — is what makes a model rankable.
   */
  total: number | null;
  /** Whether any dimension came from a benchmark, a rating or a measurement. */
  judged: boolean;
  /** Share of the category's weight that is actually known, 0–1. */
  coverage: number;
  /** Dimensions with a number, out of all of them. */
  known: number;
  of: number;
}

/**
 * The weighted blend, renormalised over the dimensions that have a number.
 *
 * A model nobody has measured for speed is not punished for it — its score is
 * made of what is known — so coverage comes back alongside the total, and the
 * board shows an empty cell per missing dimension instead of pretending.
 *
 * A derived value counts for DERIVED_WEIGHT of its dimension's weight, so a
 * guess can shade a ranking but never decide one. Coverage is deliberately
 * measured on the full weights: the dimension IS known, it is only known less
 * well, and conflating the two would make a well-covered board look thin.
 */
export function blend(values: DimValue[]): Blend {
  let sum = 0;
  /** Weight that actually votes — derived values discounted. */
  let weight = 0;
  /** Weight that has a number at all, discount or not. That is coverage. */
  let filled = 0;
  let all = 0;
  let known = 0;
  let judged = false;
  for (const v of values) {
    all += v.dim.weight;
    if (v.value === null) continue;
    const counts = isEvidence(v.from) ? v.dim.weight : v.dim.weight * DERIVED_WEIGHT;
    sum += v.value * counts;
    weight += counts;
    filled += v.dim.weight;
    known += 1;
    if (isEvidence(v.from)) judged = true;
  }
  return {
    total: weight === 0 || !judged ? null : Math.round((sum / weight) * 10) / 10,
    judged,
    coverage: all === 0 ? 0 : filled / all,
    known,
    of: values.length,
  };
}

/** "3.1% word error", "$0.015 per image", "128,000 tokens" — a measurement, said. */
export function formatMetric(raw: number, s: MetricScale): string {
  const n =
    Math.abs(raw) >= 1000
      ? Math.round(raw).toLocaleString("en-US")
      : Math.abs(raw) >= 10
        ? String(Math.round(raw * 10) / 10)
        : String(Math.round(raw * 1000) / 1000);
  const unit = s.unit;
  if (unit.startsWith("$")) return `$${n} ${unit.slice(1).replace(/^\//, "per ")}`;
  if (unit.startsWith("%")) return `${n}${unit}`;
  return `${n} ${unit}`;
}

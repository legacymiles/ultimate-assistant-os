// ---------------------------------------------------------------------------
// Self-improving confidence scores — shared by iPhone Notes and Camera
// Autopilot.
//
// A model's "I'm 90% sure" is a guess about itself. What makes a score worth
// reading is how often the owner actually said yes to guesses like this one.
// So every score is three things blended:
//
//   model     what the AI said about this one item (0-1)
//   bucket    how often guesses the model rated about this high were accepted
//   kind      how often this KIND of guess (a to-do, "Folders › Receipts") was
//             accepted
//
// The model's word counts for most while there is no history; as the owner
// approves and declines, the track record takes over. That is the "it gets
// better on its own" part, and it is honest: a kind of guess the owner keeps
// changing drops, even when the model stays sure of itself.
//
// The score never acts. Every guess still waits for the owner's yes (owner's
// rule, Oct 2026: "everything has to be approved no matter the confidence") —
// it only orders the list and tells the owner where to look first.
//
// Pure: the notes server, the photo pipeline and the tests all import it.
// ---------------------------------------------------------------------------

export interface Outcome {
  /** What kind of guess it was — an action ("todo") or a destination label. */
  kind: string;
  /** What the model said about it, 0-1. */
  raw: number;
  /** The owner took the guess as it was (approved without changing it). */
  ok: boolean;
  at: string;
}

export interface Confidence {
  /** 0-100, what the page shows. */
  score: number;
  band: Band;
  /** One plain sentence on where the number comes from. */
  why: string;
  /** How many past decisions the score leans on. */
  basis: number;
}

export type Band = "high" | "medium" | "low";

/** Decisions remembered. Recent ones only — habits drift. */
export const MAX_OUTCOMES = 300;
/** How much the model's own word weighs, against up to 3 for each kind of history. */
const MODEL_WEIGHT = 2;
const HISTORY_WEIGHT = 3;
/** Decisions it takes for a track record to count for half its weight. */
const HALF_TRUST = 4;
/** How close a past raw guess must be to count as "rated about this high". */
const BUCKET_WIDTH = 0.15;

export function clamp01(n: unknown, fallback = 0.6): number {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(v)) return fallback;
  // A model that answers 87 meant 0.87.
  const scaled = v > 1 && v <= 100 ? v / 100 : v;
  return Math.max(0, Math.min(1, scaled));
}

export function bandOf(score: number): Band {
  return score >= 80 ? "high" : score >= 50 ? "medium" : "low";
}

/** Accepted share with a one-yes-one-no prior, so 1 of 1 reads as 67%, not 100%. */
function rate(list: Outcome[]): number {
  const yes = list.filter((o) => o.ok).length;
  return (yes + 1) / (list.length + 2);
}

/** The score for one guess, given what the owner did with past ones. */
export function calibrate(rawIn: number, kind: string, outcomes: Outcome[], label = kind): Confidence {
  const raw = clamp01(rawIn);
  const recent = outcomes.slice(-MAX_OUTCOMES);
  const sameKind = recent.filter((o) => o.kind === kind);
  const nearby = recent.filter((o) => Math.abs(o.raw - raw) <= BUCKET_WIDTH);

  const wKind = sameKind.length ? (HISTORY_WEIGHT * sameKind.length) / (sameKind.length + HALF_TRUST) : 0;
  const wNear = nearby.length ? (HISTORY_WEIGHT * nearby.length) / (nearby.length + HALF_TRUST) : 0;
  const blended =
    (MODEL_WEIGHT * raw + wKind * (sameKind.length ? rate(sameKind) : 0) + wNear * (nearby.length ? rate(nearby) : 0)) /
    (MODEL_WEIGHT + wKind + wNear);
  const score = Math.round(Math.max(0, Math.min(1, blended)) * 100);

  let why: string;
  if (sameKind.length >= 2) {
    const yes = sameKind.filter((o) => o.ok).length;
    why = `You took ${yes} of the last ${sameKind.length} "${label}" guesses as they were.`;
  } else if (nearby.length >= 3) {
    const yes = nearby.filter((o) => o.ok).length;
    why = `New kind of guess — guesses this sure were right ${yes} of ${nearby.length} times.`;
  } else {
    why = "No history yet — this is Jarvis's own read. It sharpens as you approve and decline.";
  }
  return { score, band: bandOf(score), why, basis: sameKind.length + nearby.length };
}

/** Remember one decision; keeps the newest MAX_OUTCOMES. */
export function recordOutcome(outcomes: Outcome[], o: Omit<Outcome, "at"> & { at?: string }): Outcome[] {
  const next: Outcome = {
    kind: String(o.kind).slice(0, 80),
    raw: clamp01(o.raw),
    ok: Boolean(o.ok),
    at: o.at ?? new Date().toISOString(),
  };
  return [...outcomes, next].slice(-MAX_OUTCOMES);
}

/** Tolerant read of a stored list (older docs, hand edits). */
export function normalizeOutcomes(raw: unknown): Outcome[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === "object")
    .map((o) => ({
      kind: typeof o.kind === "string" ? o.kind.slice(0, 80) : "other",
      raw: clamp01(o.raw),
      ok: o.ok === true,
      at: typeof o.at === "string" ? o.at : new Date(0).toISOString(),
    }))
    .slice(-MAX_OUTCOMES);
}

/** How well the scores have matched what the owner did — for the "learning" line. */
export function trackRecord(outcomes: Outcome[]): { decisions: number; accepted: number } {
  return { decisions: outcomes.length, accepted: outcomes.filter((o) => o.ok).length };
}

export type ConfidenceSort = "newest" | "most" | "least";

/** Sort by score, ties newest first. `when` gives each item's time in ms. */
export function sortByConfidence<T>(
  items: T[],
  mode: ConfidenceSort,
  scoreOf: (t: T) => number | null,
  when: (t: T) => number,
): T[] {
  const byNew = (a: T, b: T) => when(b) - when(a);
  if (mode === "newest") return [...items].sort(byNew);
  // Items still being read (no score) go to the end either way.
  const s = (t: T) => scoreOf(t);
  return [...items].sort((a, b) => {
    const sa = s(a);
    const sb = s(b);
    if (sa === null && sb === null) return byNew(a, b);
    if (sa === null) return 1;
    if (sb === null) return -1;
    return (mode === "most" ? sb - sa : sa - sb) || byNew(a, b);
  });
}

export type ConfidenceFilter = "all" | "high" | "medium" | "low";

export function passesFilter(score: number | null, filter: ConfidenceFilter): boolean {
  if (filter === "all") return true;
  if (score === null) return false;
  return bandOf(score) === filter;
}

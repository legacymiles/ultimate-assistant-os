// ---------------------------------------------------------------------------
// AI Rankings — refreshing public scores from Artificial Analysis.
//
// The sweep next door finds new RELEASES. This finds new NUMBERS: the seeded
// board was read by hand on one day, and an arena score that never moves is
// worse than no score, because it looks current.
//
// Artificial Analysis's free tier (100 requests per 24h, key in an x-api-key
// header, attribution required and already in the page footer) serves one
// "/free" board per modality, each entry carrying `name`, `slug`,
// `model_creator` and an `elo`. Six of those boards are the exact sources the
// seed used, one per category — so a refresh writes the same label back and
// the one-score-source-per-category rule holds by construction. Categories
// scored from somewhere else (LMArena for LLMs, 3D Arena for 3D) are not
// touched, and neither is realtime-voice: its Big Bench Audio percent is a
// Pro-tier evaluation that the free endpoints do not carry.
//
// Matching is the whole risk. A wrong match silently moves a model to another
// model's rank, which is worse than a stale number and much harder to notice,
// so this never guesses: a model is updated only when exactly ONE AA entry
// claims it, by name and by maker. Two candidates, none, or a score the owner
// sourced elsewhere all mean the model keeps what it has, and says so in the
// result so the run can be read by hand.
// ---------------------------------------------------------------------------

import type { Model, PublicBoard, PublicScore } from "./leaderboard";

export const AA_BASE = "https://artificialanalysis.ai/api/v2";
/** What a refreshed score names as its source — and what the seed already uses. */
export const AA_SOURCE = "Artificial Analysis";

export interface AaBoard {
  /** The board category this leaderboard scores. */
  category: string;
  /** Free-tier path under AA_BASE. */
  path: string;
  /** PublicScore.label, identical to the seed's, so a category keeps one source. */
  label: string;
  /** The human page the number can be checked on. */
  url: string;
  /** For the note: "couldn't read music". */
  short: string;
}

/**
 * The free boards worth a call. Video uses the *-audio arenas, which are the
 * ones the seed numbers came from.
 */
export const AA_BOARDS: AaBoard[] = [
  {
    category: "tts",
    path: "/media/text-to-speech/models/free",
    label: "AA Speech Arena Elo",
    url: "https://artificialanalysis.ai/text-to-speech/leaderboard",
    short: "speech",
  },
  {
    category: "image",
    path: "/media/text-to-image/models/free",
    label: "AA Text-to-Image Arena Elo",
    url: "https://artificialanalysis.ai/image/leaderboard/text-to-image",
    short: "text-to-image",
  },
  {
    category: "image-edit",
    path: "/media/image-editing/models/free",
    label: "AA Image Editing Arena Elo",
    url: "https://artificialanalysis.ai/image/leaderboard/editing",
    short: "image editing",
  },
  {
    category: "text-to-video",
    path: "/media/text-to-video-audio/models/free",
    label: "AA Text-to-Video Arena Elo",
    url: "https://artificialanalysis.ai/video/leaderboard/text-to-video",
    short: "text-to-video",
  },
  {
    category: "image-to-video",
    path: "/media/image-to-video-audio/models/free",
    label: "AA Image-to-Video Arena Elo",
    url: "https://artificialanalysis.ai/video/leaderboard/image-to-video",
    short: "image-to-video",
  },
  {
    category: "music",
    path: "/media/music/with-vocals/models/free",
    label: "AA Music Arena Elo (vocals)",
    url: "https://artificialanalysis.ai/music/leaderboard/vocals",
    short: "music",
  },
];

/**
 * Hours a board's number is treated as current.
 *
 * Under 24 on purpose: the job runs daily at a fixed hour and a cron that
 * drifts a few minutes late must not skip its own slot and go two days
 * without a refresh. Six boards a day is 6 of the 100 free calls.
 */
export const REFRESH_EVERY_HOURS = 20;

// ----- the AA response ------------------------------------------------------

/** The fields of a free "/models/free" entry this uses. */
export interface AaEntry {
  id?: string;
  name?: string;
  slug?: string;
  model_creator?: { id?: string; name?: string } | null;
  elo?: number | null;
  ci_95?: number | null;
}

/** `{ tier, data: [...] }`, or a bare array if AA ever flattens it. */
export function entriesOf(json: unknown): AaEntry[] {
  const raw = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)
      ? ((json as { data: unknown[] }).data)
      : [];
  return raw.filter((e): e is AaEntry => Boolean(e) && typeof e === "object");
}

/**
 * An entry only counts when it names a model and carries a usable Elo.
 *
 * The Elo has to be an actual number: a stringified one would mean the
 * response is not the shape this was written against, and coercing it would
 * hide that.
 */
export function usableEntries(entries: AaEntry[]): AaEntry[] {
  return entries.filter((e) => {
    const n = (e.name ?? e.slug ?? "").trim();
    return Boolean(n) && typeof e.elo === "number" && Number.isFinite(e.elo) && e.elo > 0;
  });
}

const entryName = (e: AaEntry) => (e.name ?? e.slug ?? "").trim();
const entryMaker = (e: AaEntry) => (e.model_creator?.name ?? "").trim();

// ----- matching -------------------------------------------------------------

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Words, with version numbers left whole.
 *
 * Splitting on every dot would turn "Veo 4.1" into "veo 4 1", which contains
 * "veo 4" — so a board entry for Veo 4 would quietly take Veo 4.1's score.
 * Keeping "4.1" as one word is what makes the containment pass below safe.
 */
export function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .split(" ")
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
}

/** Whether `needle`'s words appear as a run inside `hay`'s. */
export function hasRun(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

/**
 * Whether two maker names can be the same lab.
 *
 * AA writes "ByteDance Seed" where the board writes "ByteDance", and "Google"
 * where the board writes "Google DeepMind", so equality alone would reject
 * real matches. One containing the other, or sharing a first word, is as far
 * as this goes — two unrelated labs with the same model name stay unmatched.
 * An empty maker on either side can't disqualify anything, so it doesn't.
 */
export function makersAgree(a: string, b: string): boolean {
  const x = squash(a);
  const y = squash(b);
  if (!x || !y) return true;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const [fx] = words(a);
  const [fy] = words(b);
  return Boolean(fx && fy && fx === fy);
}

export type MatchMiss =
  /** No AA entry named this model. */
  | "none"
  /** More than one could be it; picking would be a guess. */
  | "ambiguous"
  /** The owner's score for it comes from somewhere else. */
  | "other-source";

export interface MatchResult {
  entry?: AaEntry;
  miss?: MatchMiss;
}

/**
 * The one AA entry that is this model, or why there isn't one.
 *
 * Pass 1 is an exact name match (case and punctuation ignored, slug allowed),
 * which covers most of the board. Pass 2 exists because AA prefixes some
 * media entries with the product that serves them and suffixes them with a
 * resolution — "Dreamina Seedance 2.0 720p" is the board's "Seedance 2.0".
 * It only accepts a single surviving candidate, so "Kling 2.1" facing both
 * "Kling 2.1 Master" and "Kling 2.1 Pro" stays unmatched rather than picking.
 */
export function matchEntry(model: Pick<Model, "name" | "maker">, entries: AaEntry[]): MatchResult {
  const usable = usableEntries(entries);
  const want = squash(model.name);
  if (!want) return { miss: "none" };

  const byMaker = (e: AaEntry) => makersAgree(model.maker, entryMaker(e));
  const exact = usable.filter(
    (e) => byMaker(e) && (squash(entryName(e)) === want || squash(e.slug ?? "") === want),
  );
  if (exact.length === 1) return { entry: exact[0] };
  if (exact.length > 1) return { miss: "ambiguous" };

  const needle = words(model.name);
  const loose = usable.filter((e) => byMaker(e) && hasRun(words(entryName(e)), needle));
  if (loose.length === 1) return { entry: loose[0] };
  return { miss: loose.length ? "ambiguous" : "none" };
}

// ----- planning a refresh ---------------------------------------------------

export interface ScoreChange {
  modelId: string;
  name: string;
  maker: string;
  category: string;
  /** What the board said before, for the re-read check and for reading the diff. */
  from: number | null;
  to: number;
  /** The AA entry's own name, so a wrong match is visible in the log. */
  aaName: string;
  score: PublicScore;
}

export interface ScoreSkip {
  modelId: string;
  name: string;
  category: string;
  why: MatchMiss;
}

export interface BoardPlan {
  changes: ScoreChange[];
  skipped: ScoreSkip[];
  /** Matched, and AA says the same number it already had. */
  unchanged: number;
}

/** A score this refresh owns: none yet, or one it wrote itself. */
function oursToWrite(ps: PublicScore | undefined, board: AaBoard): boolean {
  if (!ps) return true;
  return ps.source === AA_SOURCE && ps.label === board.label;
}

/**
 * What one board's entries would change, without changing anything.
 *
 * `today` is yyyy-mm-dd and becomes the new score's asOf — only on the scores
 * that actually move, so an untouched number keeps the date it was true on.
 */
export function planBoardScores(
  models: Model[],
  board: AaBoard,
  entries: AaEntry[],
  today: string,
): BoardPlan {
  const plan: BoardPlan = { changes: [], skipped: [], unchanged: 0 };
  for (const m of models) {
    if (m.category !== board.category) continue;
    if (!oursToWrite(m.publicScore, board)) {
      plan.skipped.push({ modelId: m.id, name: m.name, category: m.category, why: "other-source" });
      continue;
    }
    const { entry, miss } = matchEntry(m, entries);
    if (!entry) {
      plan.skipped.push({ modelId: m.id, name: m.name, category: m.category, why: miss ?? "none" });
      continue;
    }
    const to = Number(entry.elo);
    const from = m.publicScore ? m.publicScore.value : null;
    if (from !== null && from === to) {
      plan.unchanged++;
      continue;
    }
    plan.changes.push({
      modelId: m.id,
      name: m.name,
      maker: m.maker,
      category: m.category,
      from,
      to,
      aaName: entryName(entry),
      score: {
        value: to,
        kind: "elo",
        label: board.label,
        source: AA_SOURCE,
        url: board.url,
        asOf: today,
      },
    });
  }
  return plan;
}

// ----- running it -----------------------------------------------------------

export interface ScoreRefreshResult {
  changes: ScoreChange[];
  skipped: ScoreSkip[];
  unchanged: number;
  /** Boards read this run, as category → when, to be merged into the board. */
  refreshedAt: Record<string, string>;
  /** Boards left alone because they were read within REFRESH_EVERY_HOURS. */
  fresh: string[];
  /** Boards whose call failed, by short name, so the note can say so. */
  failed: string[];
  /** Set when there is no key: nothing was called at all. */
  noKey?: boolean;
}

/** A fresh result — a factory, so no two runs share an array. */
function emptyResult(): ScoreRefreshResult {
  return { changes: [], skipped: [], unchanged: 0, refreshedAt: {}, fresh: [], failed: [] };
}

/** Boards whose last read is older than the window (or never happened). */
export function boardsDue(board: PublicBoard, now: number): { due: AaBoard[]; fresh: AaBoard[] } {
  const seen = board.scoreRefreshedAt ?? {};
  const due: AaBoard[] = [];
  const fresh: AaBoard[] = [];
  for (const b of AA_BOARDS) {
    const at = Date.parse(seen[b.category] ?? "");
    if (Number.isFinite(at) && now - at < REFRESH_EVERY_HOURS * 3600_000) fresh.push(b);
    else due.push(b);
  }
  return { due, fresh };
}

export function aaUrl(board: AaBoard): string {
  return `${AA_BASE}${board.path}`;
}

/**
 * Read every board that is due and work out what would change.
 *
 * Nothing is saved here: the caller re-reads storage and applies the plan with
 * applyScoreRefresh, so an edit made while AA was loading survives.
 */
export async function refreshScores(
  board: PublicBoard,
  opts: { apiKey?: string; fetcher?: typeof fetch; now?: number } = {},
): Promise<ScoreRefreshResult> {
  const key = (opts.apiKey ?? "").trim();
  if (!key) return { ...emptyResult(), noKey: true };

  const fetcher = opts.fetcher ?? fetch;
  const now = opts.now ?? Date.now();
  const { due, fresh } = boardsDue(board, now);
  const result: ScoreRefreshResult = { ...emptyResult(), fresh: fresh.map((b) => b.short) };
  if (!due.length) return result;

  const today = new Date(now).toISOString().slice(0, 10);
  const at = new Date(now).toISOString();

  const reads = await Promise.all(
    due.map(async (b) => {
      try {
        const res = await fetcher(aaUrl(b), {
          headers: { Accept: "application/json", "x-api-key": key },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(String(res.status));
        return { b, entries: entriesOf(await res.json()) };
      } catch {
        return { b, entries: null };
      }
    }),
  );

  for (const { b, entries } of reads) {
    // A board that answered with nothing is a failure, not an empty arena:
    // treating it as empty would mark it refreshed and skip it for a day.
    if (!entries || !entries.length) {
      result.failed.push(b.short);
      continue;
    }
    const plan = planBoardScores(board.models, b, entries, today);
    result.changes.push(...plan.changes);
    result.skipped.push(...plan.skipped);
    result.unchanged += plan.unchanged;
    result.refreshedAt[b.category] = at;
  }
  return result;
}

/**
 * Write a plan onto the board that was just re-read.
 *
 * A change is applied only while the model's score is still the one the plan
 * saw. If the owner edited that score while AA was loading, theirs stands and
 * the next run picks the model up again.
 */
export function applyScoreRefresh(latest: PublicBoard, r: ScoreRefreshResult, nowIso?: string): PublicBoard {
  const byId = new Map(r.changes.map((c) => [c.modelId, c]));
  if (!byId.size && !Object.keys(r.refreshedAt).length) return latest;
  const at = nowIso ?? new Date().toISOString();
  const models = latest.models.map((m) => {
    const c = byId.get(m.id);
    if (!c) return m;
    const current = m.publicScore ? m.publicScore.value : null;
    if (current !== c.from) return m;
    return { ...m, publicScore: { ...c.score }, updatedAt: at };
  });
  return {
    ...latest,
    models,
    scoreRefreshedAt: { ...(latest.scoreRefreshedAt ?? {}), ...r.refreshedAt },
  };
}

/** How many changes actually landed, for an honest note after the re-read. */
export function countApplied(before: PublicBoard, after: PublicBoard, r: ScoreRefreshResult): number {
  const was = new Map(before.models.map((m) => [m.id, m.publicScore?.value ?? null]));
  let n = 0;
  for (const c of r.changes) {
    const now = after.models.find((m) => m.id === c.modelId)?.publicScore?.value ?? null;
    if (now === c.to && was.get(c.modelId) !== c.to) n++;
  }
  return n;
}

/** The score half of the sweep's note — plain words, no jargon. */
export function scoreNote(r: ScoreRefreshResult, applied = r.changes.length): string {
  if (r.noKey) return "scores not refreshed (no Artificial Analysis key set)";
  const parts: string[] = [];
  if (applied > 0) parts.push(`${applied} score${applied === 1 ? "" : "s"} refreshed`);
  else if (Object.keys(r.refreshedAt).length) parts.push("scores already current");
  else if (r.fresh.length && !r.failed.length) parts.push("scores checked earlier today");
  if (r.failed.length) parts.push(`couldn't read ${r.failed.join(", ")} scores`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// AI Rankings — the measured half of the daily refresh.
//
// scores.ts re-reads the arena NUMBER each category ranks on. This re-reads
// the MEASUREMENTS the new score dimensions are made of: what a model costs,
// how fast it answers, how much it can hold. Those move more often than an
// arena score does — a price cut is the most common thing that changes about
// a model — and a dimension nobody re-reads is exactly the kind of stale
// number that makes a board quietly wrong.
//
// Artificial Analysis's free tier serves one LLM data endpoint carrying
// pricing and measured throughput per model, which is where the language
// categories' cost, speed and context come from. The media boards are read
// next door for their Elo; the free media payload does not carry a price in a
// unit this board could trust (a per-image price and a per-second video price
// are not the same number), so no price is taken from them — a wrong price is
// worse than no price, because it sorts the board.
//
// Two rules keep it honest:
//
//   • A number the owner typed is never overwritten. Each measurement records
//     where it came from in `metricsFrom`, and a refresh only rewrites the
//     ones it wrote itself.
//   • A model is matched only when exactly ONE entry claims it, by the same
//     name-and-maker rules the score refresh uses (matchNamed in scores.ts).
// ---------------------------------------------------------------------------

import { OWNER_SOURCE } from "./dimensions";
import { AA_BASE, AA_SOURCE, matchNamed } from "./scores";
import type { MatchMiss } from "./scores";
import type { Model, PublicBoard } from "./leaderboard";

/** The free LLM data endpoint: pricing and measured throughput per model. */
export const AA_LLM_PATH = "/data/llms/models";

/** What a refreshed measurement names as its source. */
export const METRIC_SOURCE = AA_SOURCE;

export { OWNER_SOURCE };

/** Categories whose measurements come from the LLM endpoint. */
export const LLM_METRIC_CATEGORIES = ["llm", "coding-agents"];

export function aaLlmUrl(): string {
  return `${AA_BASE}${AA_LLM_PATH}`;
}

// ----- the response ---------------------------------------------------------

/** The fields of a free LLM entry this reads. Everything is optional. */
export interface AaLlmEntry {
  id?: string;
  name?: string;
  slug?: string;
  model_creator?: { id?: string; name?: string } | null;
  pricing?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export function llmEntriesOf(json: unknown): AaLlmEntry[] {
  const raw = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)
      ? (json as { data: unknown[] }).data
      : [];
  return raw.filter((e): e is AaLlmEntry => Boolean(e) && typeof e === "object" && !Array.isArray(e));
}

const entryName = (e: AaLlmEntry) => (e.name ?? e.slug ?? "").trim();
const entryMaker = (e: AaLlmEntry) => (e.model_creator?.name ?? "").trim();

/**
 * A non-negative number, or nothing.
 *
 * A stringified number is accepted here (unlike the Elo next door) because
 * AA serves prices as strings in some payloads, and refusing those would
 * silently mean no prices at all.
 */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/** The first of these keys that carries a number, looking in `pricing` too. */
export function pick(e: AaLlmEntry, keys: string[]): number | null {
  for (const k of keys) {
    const direct = num(e[k]);
    if (direct !== null) return direct;
    const nested = e.pricing ? num(e.pricing[k]) : null;
    if (nested !== null) return nested;
  }
  return null;
}

// AA has renamed these fields before, so each is a list of what it has been
// called, newest name first. A field that is missing simply yields no
// measurement rather than a zero.
export const PRICE_KEYS = [
  "price_1m_blended_3_to_1",
  "price_1m_blended",
  "blended_price_1m_3_to_1",
  "price_1m_output_tokens",
];
export const SPEED_KEYS = ["median_output_tokens_per_second", "output_tokens_per_second", "tokens_per_second"];
export const CONTEXT_KEYS = ["context_window", "context_window_tokens", "max_context_tokens", "context_length"];

/** The measurements one entry carries, in this board's units. */
export function metricsOf(e: AaLlmEntry): Record<string, number> {
  const out: Record<string, number> = {};
  const cost = pick(e, PRICE_KEYS);
  // AA quotes dollars per million tokens, which is the unit the cost
  // dimension already uses, so it goes across unchanged.
  if (cost !== null) out.cost = cost;
  const speed = pick(e, SPEED_KEYS);
  if (speed !== null && speed > 0) out.speed = speed;
  const context = pick(e, CONTEXT_KEYS);
  if (context !== null && context >= 1000) out.context = context;
  return out;
}

// ----- planning -------------------------------------------------------------

export interface MetricChange {
  modelId: string;
  name: string;
  category: string;
  dim: string;
  /** What the board held before, for the re-read check and for the log. */
  from: number | null;
  to: number;
  /** The entry's own name, so a wrong match is visible in the response. */
  aaName: string;
}

export interface MetricSkip {
  modelId: string;
  name: string;
  why: MatchMiss | "owner-typed";
}

export interface MetricPlan {
  changes: MetricChange[];
  skipped: MetricSkip[];
  /** Matched, and every measurement already said the same thing. */
  unchanged: number;
}

/** Whether this refresh owns that measurement: none yet, or one it wrote. */
export function oursToWrite(m: Model, dim: string): boolean {
  if (m.metrics?.[dim] === undefined) return true;
  return m.metricsFrom?.[dim] === METRIC_SOURCE;
}

/** What one endpoint's entries would change, without changing anything. */
export function planMetrics(models: Model[], entries: AaLlmEntry[], categories = LLM_METRIC_CATEGORIES): MetricPlan {
  const plan: MetricPlan = { changes: [], skipped: [], unchanged: 0 };
  const wanted = new Set(categories);
  for (const m of models) {
    if (!wanted.has(m.category)) continue;
    const { entry, miss } = matchNamed(m, entries, entryName, entryMaker, (e) => e.slug ?? "");
    if (!entry) {
      plan.skipped.push({ modelId: m.id, name: m.name, why: miss ?? "none" });
      continue;
    }
    const found = metricsOf(entry);
    let moved = false;
    let held = false;
    for (const [dim, to] of Object.entries(found)) {
      if (!oursToWrite(m, dim)) {
        held = true;
        continue;
      }
      const from = m.metrics?.[dim] ?? null;
      if (from === to) continue;
      moved = true;
      plan.changes.push({ modelId: m.id, name: m.name, category: m.category, dim, from, to, aaName: entryName(entry) });
    }
    if (!moved) {
      if (held) plan.skipped.push({ modelId: m.id, name: m.name, why: "owner-typed" });
      else if (Object.keys(found).length) plan.unchanged += 1;
    }
  }
  return plan;
}

// ----- running it -----------------------------------------------------------

export interface MetricRefreshResult extends MetricPlan {
  /** Set when there is no key: nothing was called at all. */
  noKey?: boolean;
  /** Set when the call failed, so the note can say so. */
  failed?: boolean;
  /** The entries the endpoint answered with, so discovery can read them too. */
  entries?: AaLlmEntry[];
}

/**
 * Read the LLM endpoint and work out what would change.
 *
 * Nothing is saved here: the caller re-reads storage and applies the plan, so
 * an edit made while the endpoint was loading survives.
 */
export async function refreshMetrics(
  board: PublicBoard,
  opts: { apiKey?: string; fetcher?: typeof fetch } = {},
): Promise<MetricRefreshResult> {
  const key = (opts.apiKey ?? "").trim();
  const empty: MetricRefreshResult = { changes: [], skipped: [], unchanged: 0 };
  if (!key) return { ...empty, noKey: true };
  const fetcher = opts.fetcher ?? fetch;
  try {
    const res = await fetcher(aaLlmUrl(), {
      headers: { Accept: "application/json", "x-api-key": key },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const entries = llmEntriesOf(await res.json());
    if (!entries.length) throw new Error("empty");
    return { ...planMetrics(board.models, entries), entries };
  } catch {
    return { ...empty, failed: true };
  }
}

/**
 * Write a plan onto the board that was just re-read.
 *
 * A change lands only while the measurement is still the one the plan saw, so
 * a number the owner typed in the meantime stands and the next run picks the
 * model up again.
 */
export function applyMetricRefresh(latest: PublicBoard, r: MetricRefreshResult, nowIso?: string): PublicBoard {
  if (!r.changes.length) return latest;
  const at = nowIso ?? new Date().toISOString();
  const today = at.slice(0, 10);
  const byId = new Map<string, MetricChange[]>();
  for (const c of r.changes) byId.set(c.modelId, [...(byId.get(c.modelId) ?? []), c]);

  const models = latest.models.map((m) => {
    const changes = byId.get(m.id);
    if (!changes) return m;
    const metrics = { ...(m.metrics ?? {}) };
    const metricsFrom = { ...(m.metricsFrom ?? {}) };
    let touched = false;
    for (const c of changes) {
      if ((metrics[c.dim] ?? null) !== c.from) continue;
      if (!oursToWrite(m, c.dim)) continue;
      metrics[c.dim] = c.to;
      metricsFrom[c.dim] = METRIC_SOURCE;
      touched = true;
    }
    return touched ? { ...m, metrics, metricsFrom, measuredAt: today, updatedAt: at } : m;
  });
  return { ...latest, models };
}

/** How many changes actually landed, for an honest note after the re-read. */
export function countApplied(before: PublicBoard, after: PublicBoard, r: MetricRefreshResult): number {
  let n = 0;
  for (const c of r.changes) {
    const was = before.models.find((m) => m.id === c.modelId)?.metrics?.[c.dim] ?? null;
    const now = after.models.find((m) => m.id === c.modelId)?.metrics?.[c.dim] ?? null;
    if (now === c.to && was !== c.to) n++;
  }
  return n;
}

/** The measurement half of the sweep's note — plain words, no jargon. */
export function metricNote(r: MetricRefreshResult, applied = r.changes.length): string {
  if (r.noKey) return "";
  if (r.failed) return "couldn't read prices and speeds";
  if (applied > 0) return `${applied} price${applied === 1 ? "" : "s"} and speed${applied === 1 ? "" : "s"} updated`;
  return "prices and speeds already current";
}

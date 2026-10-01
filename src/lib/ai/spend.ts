import "server-only";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import path from "node:path";
import { listModels } from "./models";
import { isPremiumClaude, routerModel, type RoutePlan } from "./router";
import type { ProviderId } from "./settings";

// ---------------------------------------------------------------------------
// What the AI actually cost, call by call.
//
// OpenRouter will not tell us. `/api/v1/activity` — the per-day spend endpoint —
// answers 403 "Only management keys can fetch activity for an account" to a
// normal inference key, and the owner's key is an inference key. `/credits`
// gives two lifetime numbers and nothing else. So a daily figure has to be
// counted here, as the calls happen.
//
// Two decisions worth knowing:
//
// 1. RECENT CALLS ARE KEPT, DAILY TOTALS ARE DERIVED. The obvious shape is a
//    map of date to total, and it is wrong: this server runs in UTC and the
//    owner does not. A day bucketed here would put his 8pm calls on tomorrow.
//    So the ledger keeps the last few hundred calls with their timestamps and
//    the browser buckets them into ITS OWN local day — the same
//    derived-never-stored rule the Updates feed already runs on. Older history
//    is rolled into UTC days, where being a few hours out does not matter.
//
// 2. THE COST IS ASKED FOR, NOT ESTIMATED, WHENEVER POSSIBLE. OpenRouter
//    returns the real charge in `usage.cost` when a request sets
//    `usage: { include: true }`, which provider.ts now does on every call. Only
//    when a provider does not report one (the Vercel gateway does not) is the
//    charge priced from the model catalogue, and such a row is marked
//    `estimated` so the panel never presents a guess as a measurement.
// ---------------------------------------------------------------------------

/** One AI call, as the ledger remembers it. */
export interface CallRecord {
  /** ISO. The browser buckets on this, in its own timezone. */
  at: string;
  model: string;
  provider: ProviderId;
  /** Dollars. */
  cost: number;
  /** True when `cost` was priced from the catalogue rather than reported by the provider. */
  estimated?: boolean;
  promptTokens: number;
  completionTokens: number;
  /** Which rung of the router sent it, when the router chose. */
  tier?: string;
  /** Which app asked, when it said. */
  app?: string;
  /** Anthropic's expensive tier. The dashboard notification reads this flag. */
  premium?: boolean;
  /** Set when the call failed, so a wall of errors is visible without costing anything. */
  failed?: boolean;
  /**
   * Models that refused before this one answered.
   *
   * Recorded here rather than read out of the cooldown map because that map is
   * per module instance — Next bundles each route separately, so a map written
   * by the chat route is invisible to the panel route. The ledger is a document,
   * so a rung that is refusing shows up wherever the ledger is read.
   */
  skipped?: { model: string; status?: number; why: string }[];
}

/** A rolled-up past day. UTC, and only used for the history strip. */
export interface DayTotal {
  /** YYYY-MM-DD, UTC. */
  date: string;
  cost: number;
  calls: number;
}

export interface SpendLedger {
  /** Newest last. Capped, because this is one document. */
  recent: CallRecord[];
  /** Older than `recent`, rolled into UTC days. Newest first, capped at 30. */
  days: DayTotal[];
  /** Lifetime dollars this ledger has counted, never trimmed. */
  countedEver: number;
}

const DOC = "ai-spend";
/** Enough for a heavy day and a bit, which is all the browser needs to bucket "today". */
const KEEP_RECENT = 300;
const KEEP_DAYS = 30;

export const EMPTY_LEDGER: SpendLedger = { recent: [], days: [], countedEver: 0 };

function dataDir(): string {
  return process.env.AI_SETTINGS_DATA_DIR || path.resolve(".data");
}

// --- reading a provider's usage block --------------------------------------

export interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
}

/**
 * The usage block out of a chat-completions payload, from either provider.
 *
 * OpenRouter puts the charge on `usage.cost`; the gateway sends token counts
 * only. A missing block is not an error — some responses genuinely carry none —
 * so this returns null and the caller records nothing rather than a zero that
 * would read as a free call.
 */
export function usageOf(payload: unknown): RawUsage | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  const out: RawUsage = {
    prompt_tokens: num(u.prompt_tokens),
    completion_tokens: num(u.completion_tokens),
    cost: num(u.cost),
  };
  if (out.prompt_tokens === undefined && out.completion_tokens === undefined && out.cost === undefined) return null;
  return out;
}

/**
 * What this call cost, and whether that is a measurement or an estimate.
 *
 * A reported cost of exactly 0 is kept as measured: the free models really are
 * free, and rounding that up to a catalogue estimate would invent spending.
 */
export async function priceOf(
  model: string,
  usage: RawUsage,
): Promise<{ cost: number; estimated: boolean }> {
  if (usage.cost !== undefined) return { cost: Math.max(0, usage.cost), estimated: false };

  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  // The router's own table first: it needs no network and covers the models the
  // router actually reaches for. The full catalogue is the fallback, for a model
  // the owner picked by hand.
  const known = routerModel(model);
  if (known) {
    if (!known.price) return { cost: 0, estimated: true }; // Jev bills as whatever it routed to.
    const [inPrice, outPrice] = known.price;
    return { cost: (prompt * inPrice + completion * outPrice) / 1e6, estimated: true };
  }
  const info = (await listModels().catch(() => [])).find((m) => m.id === model);
  if (!info) return { cost: 0, estimated: true };
  return { cost: (prompt * info.promptPrice + completion * info.completionPrice) / 1e6, estimated: true };
}

// --- writing ---------------------------------------------------------------

let chain: Promise<unknown> = Promise.resolve();
/** Calls counted but not yet written, so a burst costs one document write. */
let pending: CallRecord[] = [];
let flushAt = 0;
/** How long a cheap call may wait to be written. */
const FLUSH_MS = 20_000;

export interface RecordInput {
  model: string;
  provider: ProviderId;
  usage: RawUsage | null;
  plan?: RoutePlan | null;
  app?: string;
  failed?: boolean;
  /** What refused on the way here. */
  skipped?: { model: string; status?: number; why: string }[];
}

/**
 * Count one call.
 *
 * Never throws and never blocks the response: the caller does not await it.
 * A premium Claude call flushes immediately, because the whole point of
 * noticing it is that the owner hears about it now rather than in twenty
 * seconds' time.
 */
export function recordCall(input: RecordInput): void {
  void (async () => {
    try {
      const usage = input.usage ?? {};
      // No usage block means nothing was charged — a call that failed, or a
      // reply that carried none. Pricing it would reach for the model catalogue
      // over the network to compute a zero.
      const { cost, estimated } = input.usage
        ? await priceOf(input.model, input.usage)
        : { cost: 0, estimated: false };
      const premium = isPremiumClaude(input.model);
      const record: CallRecord = {
        at: new Date().toISOString(),
        model: input.model,
        provider: input.provider,
        cost,
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
      };
      if (estimated && cost > 0) record.estimated = true;
      if (input.plan) record.tier = input.plan.tier;
      if (input.app) record.app = input.app.slice(0, 60);
      if (premium) record.premium = true;
      if (input.failed) record.failed = true;
      if (input.skipped?.length) record.skipped = input.skipped.slice(0, 4);

      pending.push(record);
      const urgent = premium || cost >= 0.25;
      if (urgent || Date.now() - flushAt > FLUSH_MS) await flush();
    } catch {
      // A ledger that breaks a working AI call is worse than a missing row.
    }
  })();
}

/** Write everything counted so far. Safe to call at any time. */
export async function flush(): Promise<void> {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  flushAt = Date.now();
  const run = chain.then(async () => {
    const stored = (await readDoc<SpendLedger>(DOC, dataDir()).catch(() => null)) ?? EMPTY_LEDGER;
    const next = addCalls(stored, batch);
    const ok = await writeDoc(DOC, dataDir(), next);
    // A failed write must not lose the rows: put them back for the next flush.
    if (!ok) pending = [...batch, ...pending];
  });
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Fold new calls into a ledger: append, trim, and roll whatever fell off the
 * end of `recent` into its UTC day.
 *
 * Pure, so the trimming and rolling are testable without a document store.
 */
export function addCalls(ledger: SpendLedger, calls: CallRecord[]): SpendLedger {
  const recent = [...(ledger.recent ?? []), ...calls].sort((a, b) => a.at.localeCompare(b.at));
  const overflow = recent.length > KEEP_RECENT ? recent.splice(0, recent.length - KEEP_RECENT) : [];

  const days = new Map((ledger.days ?? []).map((d) => [d.date, { ...d }]));
  for (const call of overflow) {
    const date = call.at.slice(0, 10);
    const day = days.get(date) ?? { date, cost: 0, calls: 0 };
    day.cost += call.cost;
    day.calls += 1;
    days.set(date, day);
  }

  return {
    recent,
    days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, KEEP_DAYS),
    countedEver: (ledger.countedEver ?? 0) + calls.reduce((sum, c) => sum + c.cost, 0),
  };
}

// --- reading ---------------------------------------------------------------

export async function loadLedger(): Promise<SpendLedger> {
  const stored = await readDoc<SpendLedger>(DOC, dataDir()).catch(() => null);
  const base = stored ?? EMPTY_LEDGER;
  // Include anything counted but not yet written, so a reload right after a call
  // shows it instead of appearing to have lost it.
  return pending.length ? addCalls(base, pending) : base;
}

export interface SpendReport {
  /** Newest last. The browser buckets these into its own local day. */
  recent: CallRecord[];
  days: DayTotal[];
  countedEver: number;
  /** OpenRouter's own two lifetime numbers, when it answers. */
  account: { credits: number; used: number; remaining: number } | null;
  /**
   * Why a figure here may sit under the provider's own: this hub counts the
   * calls it makes, and a key used anywhere else is invisible to it.
   */
  note: string;
}

let accountCache: { at: number; value: SpendReport["account"] } | null = null;

async function account(): Promise<SpendReport["account"]> {
  if (accountCache && Date.now() - accountCache.at < 60_000) return accountCache.value;
  let value: SpendReport["account"] = null;
  const key = process.env.OPENROUTER_API_KEY;
  if (key) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const body = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } };
        const credits = Number(body.data?.total_credits ?? 0);
        const used = Number(body.data?.total_usage ?? 0);
        if (Number.isFinite(credits) && Number.isFinite(used)) value = { credits, used, remaining: credits - used };
      }
    } catch {}
  }
  accountCache = { at: Date.now(), value };
  return value;
}

export async function spendReport(): Promise<SpendReport> {
  const [ledger, acct] = await Promise.all([loadLedger(), account()]);
  return {
    recent: ledger.recent,
    days: ledger.days,
    countedEver: ledger.countedEver,
    account: acct,
    note: "Counted from the calls this hub makes. OpenRouter only reports per-day spend to a management key, so a lifetime total from your account can be higher if the key is used elsewhere.",
  };
}

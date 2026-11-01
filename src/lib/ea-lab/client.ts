// ---------------------------------------------------------------------------
// Talking to the EA Lab runner.
//
// The hub is on Vercel and cannot reach this PC or its MetaTrader installs;
// the owner's browser can. So every call here goes from the page straight to
// 127.0.0.1:42030, the same shape as the Studio bridge.
//
// The runner deliberately stores reports WITHOUT parsing them. Parsing happens
// here, with the same tested code the unit tests run against, so there is one
// parser rather than a second copy in the bridge quietly drifting out of sync.
// ---------------------------------------------------------------------------

import { parseMt4Report, decodeReport } from "./report";
import { analyzeExposure } from "./exposure";
import { classify, type Classification } from "./classify";
import { rate } from "./rating";
import type { TestRun, Rating, Sample, Platform } from "./types";

export const BRIDGE = "http://127.0.0.1:42030";

export interface Health {
  ok: boolean;
  rig: { exe: string; present: boolean; data: string };
  inbox: string;
  waiting: number;
  library: number;
  queue: number;
}

export interface LibraryEa {
  id: string;
  name: string;
  platform: Platform;
  file: string;
  testable: boolean;
  path: string;
  addedAt: number;
  seenAt: number;
  autoTest: boolean;
}

/** A run as the runner filed it — config only, no metrics. */
interface RawRun {
  id: string;
  eaId: string;
  symbol: string;
  timeframe: string;
  from: number;
  to: number;
  sample: Sample;
  model: string;
  spread: number;
  deposit: number;
  report: string;
  seconds: number;
  ranAt: number;
}

/** Everything the lab knows about one EA, ready to render. */
export interface EaView {
  ea: LibraryEa;
  runs: TestRun[];
  rating: Rating;
  classification: Classification | null;
  /** Seconds of tester time spent on this EA, for the "is it worth more" call. */
  testedSeconds: number;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BRIDGE}${path}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export const health = (signal?: AbortSignal) => get<Health>("/health", signal);
export const library = (signal?: AbortSignal) => get<LibraryEa[]>("/library", signal);

export async function scan(): Promise<{ found: string[]; adopted: number; queued: string[] }> {
  const res = await fetch(`${BRIDGE}/scan`, { method: "POST" });
  if (!res.ok) throw new Error(`scan returned ${res.status}`);
  return res.json();
}

export async function queueTest(body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await fetch(`${BRIDGE}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`test returned ${res.status}`);
  return res.json();
}

/** Fetch one report and turn it into a fully-analysed run. */
async function loadRun(raw: RawRun, signal?: AbortSignal): Promise<TestRun | null> {
  try {
    const res = await fetch(`${BRIDGE}/report/${encodeURIComponent(raw.report)}`, { signal });
    if (!res.ok) return null;
    const parsed = parseMt4Report(decodeReport(new Uint8Array(await res.arrayBuffer())));
    return {
      id: raw.id,
      eaId: raw.eaId,
      symbol: parsed.symbol || raw.symbol,
      timeframe: parsed.period || raw.timeframe,
      from: parsed.from ?? raw.from,
      to: parsed.to ?? raw.to,
      sample: raw.sample,
      modelQuality: parsed.model,
      deposit: parsed.deposit || raw.deposit,
      currency: "USD",
      leverage: 0,
      spreadPoints: parsed.spread,
      server: parsed.server,
      metrics: parsed.metrics,
      exposure: analyzeExposure(parsed.trades),
      trades: parsed.trades,
      ranAt: raw.ranAt,
    };
  } catch {
    // A report that will not load must not take the whole table down with it.
    return null;
  }
}

/** The whole lab, analysed. */
export async function loadAll(signal?: AbortSignal): Promise<EaView[]> {
  const [eas, rawRuns] = await Promise.all([
    library(signal),
    get<RawRun[]>("/runs", signal),
  ]);

  const loaded = await Promise.all(rawRuns.map((r) => loadRun(r, signal)));
  const runs = loaded.filter((r): r is TestRun => r !== null);
  const secondsBy = new Map<string, number>();
  for (const r of rawRuns) secondsBy.set(r.eaId, (secondsBy.get(r.eaId) ?? 0) + (r.seconds || 0));

  return eas.map((ea) => {
    const mine = runs.filter((r) => r.eaId === ea.id).sort((a, b) => b.ranAt - a.ranAt);
    const rating = rate(ea.id, mine);
    // Classify from the run with the most trades: the most behaviour observed.
    const richest = [...mine].sort((a, b) => b.trades.length - a.trades.length)[0];
    return {
      ea,
      runs: mine,
      rating,
      classification: richest ? classify(richest.trades, richest.exposure) : null,
      testedSeconds: secondsBy.get(ea.id) ?? 0,
    };
  });
}

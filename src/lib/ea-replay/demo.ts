// ---------------------------------------------------------------------------
// EA World › Replay — made-up ticks, for when there is no network at all.
//
// The app has to open and work with no data source reachable, so this makes a
// believable tape: a random walk with quiet stretches, a few fast bursts (the
// moves an HFT bot hunts) and spread that widens around them. It is ALWAYS
// labelled DEMO on screen. Never judge a bot on it.
// ---------------------------------------------------------------------------

import type { Instrument } from "./instruments";
import type { TickSeries } from "./types";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const START_PRICE: Record<string, number> = {
  EURUSD: 1.165, GBPUSD: 1.335, AUDUSD: 0.655, USDJPY: 150.2, XAUUSD: 4150, US30: 46500, NAS100: 25100, SPX500: 6650, BTCUSD: 108000,
};

export function demoTicks(inst: Instrument, fromMs: number, toMs: number, seed = 7): TickSeries {
  const r = rng(seed);
  const time: number[] = [];
  const bid: number[] = [];
  const ask: number[] = [];
  const pt = inst.point;
  // Typical spread and per-tick step in points, scaled for the instrument.
  const base = START_PRICE[inst.id] ?? (inst.range[0] + inst.range[1]) / 2;
  const spreadPts = inst.kind === "fx" ? 8 : inst.kind === "metal" ? 18 : inst.kind === "index" ? 15 : 1500;
  const stepPts = inst.kind === "fx" ? 6 : inst.kind === "metal" ? 15 : inst.kind === "index" ? 8 : 800;

  let px = base;
  let t = fromMs;
  let burst = 0;
  let burstDir = 1;
  while (t < toMs) {
    if (burst <= 0 && r() < 0.0015) {
      burst = 30 + Math.floor(r() * 90);
      burstDir = r() < 0.5 ? -1 : 1;
    }
    const inBurst = burst > 0;
    const drift = inBurst ? burstDir * stepPts * (0.15 + 0.35 * r()) : 0;
    const noise = (r() - 0.5) * 2 * stepPts;
    px += (drift + noise) * pt;
    const spread = (spreadPts + (inBurst ? spreadPts * r() : 0) + (r() < 0.002 ? spreadPts * 4 : 0)) * pt;
    time.push(t);
    const f = 10 ** inst.digits;
    const b = Math.round(px * f) / f;
    bid.push(b);
    ask.push(Math.round((b + spread) * f) / f);
    t += inBurst ? 20 + Math.floor(r() * 120) : 150 + Math.floor(r() * 900);
    if (inBurst) burst--;
  }
  return {
    symbol: inst.id,
    time: Float64Array.from(time),
    bid: Float64Array.from(bid),
    ask: Float64Array.from(ask),
    source: "demo",
    note: "DEMO — generated ticks, not real market data",
  };
}

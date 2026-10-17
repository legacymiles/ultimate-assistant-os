// ---------------------------------------------------------------------------
// EA World › Replay — shared shapes.
//
// Ticks are held COLUMNAR (three typed arrays) rather than as an array of
// objects. A three-hour NY session on EURUSD is 30–60k ticks; gold on a CPI
// morning is several times that. Columns keep that to a few hundred KB and let
// the engine walk them without allocating.
// ---------------------------------------------------------------------------

export interface TickSeries {
  symbol: string;
  /** Epoch ms (UTC) of each tick, ascending. */
  time: Float64Array;
  bid: Float64Array;
  ask: Float64Array;
  /** Where the ticks came from, said on screen so demo data is never mistaken for real. */
  source: "dukascopy" | "csv" | "demo";
  /** Free-text provenance, e.g. "Dukascopy · 3 hourly files". */
  note?: string;
}

/** What the tick API sends over the wire: prices as integer points from a base. */
export interface TickPayload {
  symbol: string;
  source: TickSeries["source"];
  note?: string;
  /** Epoch ms of the first tick; `dt` is ms offsets from it. */
  t0: number;
  dt: number[];
  /** Price = base + n * point. */
  base: number;
  point: number;
  bid: number[];
  ask: number[];
  /** Hour files that could not be fetched, if any — shown, never hidden. */
  missing?: string[];
}

export interface Candle {
  /** Bucket start, epoch SECONDS (lightweight-charts' UTCTimestamp). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  ticks: number;
}

export function seriesLength(s: TickSeries): number {
  return s.time.length;
}

export function encodeTicks(s: TickSeries, point: number, missing?: string[]): TickPayload {
  const n = s.time.length;
  const t0 = n ? s.time[0] : 0;
  let base = Infinity;
  for (let i = 0; i < n; i++) base = Math.min(base, s.bid[i]);
  if (!Number.isFinite(base)) base = 0;
  base = Math.floor(base / point) * point;
  const dt = new Array<number>(n);
  const bid = new Array<number>(n);
  const ask = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    dt[i] = Math.round(s.time[i] - t0);
    bid[i] = Math.round((s.bid[i] - base) / point);
    ask[i] = Math.round((s.ask[i] - base) / point);
  }
  return { symbol: s.symbol, source: s.source, note: s.note, t0, dt, base, point, bid, ask, missing };
}

export function decodeTicks(p: TickPayload): TickSeries {
  const n = p.dt.length;
  const time = new Float64Array(n);
  const bid = new Float64Array(n);
  const ask = new Float64Array(n);
  // Re-round after scaling so 1.08 + 3 * 0.00001 does not come back as 1.0800299999.
  const digits = Math.max(0, Math.round(-Math.log10(p.point)));
  const f = 10 ** digits;
  for (let i = 0; i < n; i++) {
    time[i] = p.t0 + p.dt[i];
    bid[i] = Math.round((p.base + p.bid[i] * p.point) * f) / f;
    ask[i] = Math.round((p.base + p.ask[i] * p.point) * f) / f;
  }
  return { symbol: p.symbol, time, bid, ask, source: p.source, note: p.note };
}

/** Builds candles of `tfSec` seconds from ticks [0, end) — bid prices, like MT4 charts. */
export function buildCandles(s: TickSeries, tfSec: number, end = s.time.length, start = 0): Candle[] {
  const out: Candle[] = [];
  const tfMs = tfSec * 1000;
  let cur: Candle | null = null;
  for (let i = start; i < end; i++) {
    const bucket = Math.floor(s.time[i] / tfMs) * tfSec;
    const px = s.bid[i];
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: px, high: px, low: px, close: px, ticks: 1 };
    } else {
      if (px > cur.high) cur.high = px;
      if (px < cur.low) cur.low = px;
      cur.close = px;
      cur.ticks++;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** First index with time >= t (binary search). */
export function indexAtOrAfter(s: TickSeries, t: number): number {
  let lo = 0;
  let hi = s.time.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (s.time[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

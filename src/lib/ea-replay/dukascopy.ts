// ---------------------------------------------------------------------------
// EA World › Replay — Dukascopy's free historical tick feed.
//
// Dukascopy publishes every tick (real bid AND ask, so the real spread) for FX,
// metals, indices and crypto as one LZMA-compressed file per hour, free and
// without a key. It is the same feed most "99% modelling quality" MT4
// backtests are built from, which is why Replay uses it.
//
//   https://datafeed.dukascopy.com/datafeed/EURUSD/2026/09/16/12h_ticks.bi5
//                                              month is ZERO-based ^^
//
// Each decompressed record is 20 bytes, big-endian:
//   uint32 ms since the hour · uint32 ask · uint32 bid · float32 askVol · float32 bidVol
//
// This module is pure (no network, no LZMA) so it can be tested with fixtures;
// the route does the fetching and decompressing.
// ---------------------------------------------------------------------------

import type { Instrument } from "./instruments";

export const DUKA_BASE = "https://datafeed.dukascopy.com/datafeed";

export function hourUrl(dukaSymbol: string, hourStartUtcMs: number): string {
  const d = new Date(hourStartUtcMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth()).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${DUKA_BASE}/${dukaSymbol}/${yyyy}/${mm}/${dd}/${hh}h_ticks.bi5`;
}

/** Every UTC hour start that overlaps [fromMs, toMs). */
export function hoursBetween(fromMs: number, toMs: number): number[] {
  const H = 3_600_000;
  const out: number[] = [];
  for (let h = Math.floor(fromMs / H) * H; h < toMs; h += H) out.push(h);
  return out;
}

export interface RawTick {
  t: number;
  bid: number;
  ask: number;
}

/** Decodes one hour's decompressed records into ticks with real prices. */
export function parseHour(bytes: Uint8Array, hourStartUtcMs: number, scale: number): RawTick[] {
  const n = Math.floor(bytes.byteLength / 20);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 20);
  const out: RawTick[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 20;
    const ms = view.getUint32(o);
    const ask = view.getUint32(o + 4) / scale;
    const bid = view.getUint32(o + 8) / scale;
    out[i] = { t: hourStartUtcMs + ms, bid, ask };
  }
  return out;
}

/**
 * The scale that puts this hour's first price inside the instrument's range.
 * Dukascopy has used different integer scales for some symbols over the years;
 * guessing wrong turns gold into $4.30, so the scale is checked, not trusted.
 */
export function detectScale(bytes: Uint8Array, inst: Instrument): number {
  if (bytes.byteLength < 20) return inst.dukaScale;
  const raw = new DataView(bytes.buffer, bytes.byteOffset, 20).getUint32(8);
  const candidates = [inst.dukaScale, 1e5, 1e3, 1e2, 10, 1, 1e4, 1e6];
  for (const s of candidates) {
    const px = raw / s;
    if (px >= inst.range[0] && px <= inst.range[1]) return s;
  }
  return inst.dukaScale;
}

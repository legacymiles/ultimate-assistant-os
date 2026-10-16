// ---------------------------------------------------------------------------
// EA World › Replay — the handful of indicators most EAs are built from.
//
// `shift` means what it means in MT4: 0 is the newest value (the forming
// candle), 1 the last closed one. Arrays are oldest-first, so shift counts back
// from the end. Not enough data returns NaN, never a made-up number, and every
// comparison with NaN is false — so a bot with no history simply does nothing.
// ---------------------------------------------------------------------------

import type { Candle } from "./types";
import type { Indicators } from "./strategy";

function window(values: number[], period: number, shift: number): number[] | null {
  const end = values.length - shift;
  const start = end - period;
  if (period <= 0 || start < 0 || end > values.length) return null;
  return values.slice(start, end);
}

export function sma(values: number[], period: number, shift = 0): number {
  const w = window(values, period, shift);
  if (!w) return NaN;
  let s = 0;
  for (const v of w) s += v;
  return s / period;
}

export function ema(values: number[], period: number, shift = 0): number {
  const end = values.length - shift;
  if (period <= 0 || end < period) return NaN;
  const k = 2 / (period + 1);
  let e = 0;
  for (let i = 0; i < period; i++) e += values[i];
  e /= period;
  for (let i = period; i < end; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function rsi(values: number[], period: number, shift = 0): number {
  const end = values.length - shift;
  if (period <= 0 || end < period + 1) return NaN;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < end; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

export function atr(candles: Candle[], period: number, shift = 0): number {
  const end = candles.length - shift;
  if (period <= 0 || end < period + 1) return NaN;
  let s = 0;
  for (let i = end - period; i < end; i++) {
    const c = candles[i];
    const prev = candles[i - 1].close;
    s += Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  }
  return s / period;
}

export function highest(values: number[], count: number, shift = 0): number {
  const w = window(values, count, shift);
  return w ? Math.max(...w) : NaN;
}

export function lowest(values: number[], count: number, shift = 0): number {
  const w = window(values, count, shift);
  return w ? Math.min(...w) : NaN;
}

export const INDICATORS: Indicators = { sma, ema, rsi, atr, highest, lowest };

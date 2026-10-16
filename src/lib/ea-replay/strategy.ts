// ---------------------------------------------------------------------------
// EA World › Replay — what a bot looks like to the replay.
//
// The context deliberately uses MT4's own names (Bid, Ask, Point, OrderSend,
// OrderModify …) so a port of an .mq4 file reads almost line for line like the
// original. That is what makes "paste an EA, get a replayable bot" a
// translation job rather than a rewrite, for a person or for the AI porter.
//
// Order types are strings rather than OP_* integers, but the OP_* names are
// provided too so ported code can keep them.
// ---------------------------------------------------------------------------

import type { Candle } from "./types";
import type { OrderType, SimOrder } from "./broker";
import type { NyClock } from "./session";

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

export interface ParamSpec {
  key: string;
  label: string;
  type: "int" | "number" | "bool" | "select";
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  group?: string;
  hint?: string;
}

/** A read-only view of an order, as a strategy sees it. */
export type OrderView = Readonly<
  Pick<SimOrder, "ticket" | "type" | "lots" | "openPrice" | "sl" | "tp" | "comment" | "status" | "openTime" | "profit" | "closeTime" | "closePrice">
>;

export interface Indicators {
  sma(values: number[], period: number, shift?: number): number;
  ema(values: number[], period: number, shift?: number): number;
  rsi(values: number[], period: number, shift?: number): number;
  atr(candles: Candle[], period: number, shift?: number): number;
  highest(values: number[], count: number, shift?: number): number;
  lowest(values: number[], count: number, shift?: number): number;
}

export interface StrategyContext {
  readonly Symbol: string;
  readonly Point: number;
  readonly Digits: number;
  readonly Bid: number;
  readonly Ask: number;
  /** Epoch ms (UTC) of the current tick. */
  readonly Time: number;
  readonly spreadPoints: number;
  readonly stopLevelPoints: number;
  /** New York wall clock for the current tick. */
  readonly ny: NyClock;
  inSession(startHHMM: number, endHHMM: number): boolean;

  AccountBalance(): number;
  AccountEquity(): number;
  AccountFreeMargin(): number;
  /** USD value of one point on 1.00 lot — MT4's MODE_TICKVALUE / MODE_TICKSIZE * Point. */
  pointValuePerLot(): number;

  /** Pending orders and open positions. */
  orders(): OrderView[];
  positions(): OrderView[];
  pendings(): OrderView[];
  history(): OrderView[];

  /** Queues a request; returns the ticket it will have, or -1 if refused before sending. */
  OrderSend(type: OrderType, lots: number, price: number, sl?: number, tp?: number, comment?: string): number;
  OrderModify(ticket: number, price: number, sl: number, tp: number): boolean;
  OrderDelete(ticket: number): boolean;
  OrderClose(ticket: number): boolean;
  NormalizeDouble(price: number): number;

  /** Candles of `tfSec` seconds built from the ticks so far, oldest first, last one still forming. */
  candles(tfSec: number, count?: number): Candle[];
  /** Close prices of those candles, oldest first. */
  closes(tfSec: number, count?: number): number[];
  readonly ind: Indicators;

  /** Survives between ticks. */
  readonly state: Record<string, unknown>;
  log(message: string): void;

  readonly OP_BUY: "buy";
  readonly OP_SELL: "sell";
  readonly OP_BUYSTOP: "buystop";
  readonly OP_SELLSTOP: "sellstop";
  readonly OP_BUYLIMIT: "buylimit";
  readonly OP_SELLLIMIT: "selllimit";
}

export interface StrategyInstance {
  onInit?(ctx: StrategyContext): void;
  onTick(ctx: StrategyContext): void;
}

export interface StrategyDef {
  id: string;
  name: string;
  summary: string;
  origin: "builtin" | "custom";
  /** Path of the matching .mq4 under /public, when there is one to download. */
  mq4?: string;
  params: ParamSpec[];
  /** Per-instrument starting values, because 60 points on gold is not 60 points on EURUSD. */
  presets?: Record<string, Params>;
  /** Which NY window this bot is meant for, to preselect the session. */
  suggestedSession?: string;
  create(params: Params): StrategyInstance;
}

export function defaultParams(def: StrategyDef, instrumentId?: string): Params {
  const p: Params = {};
  for (const s of def.params) p[s.key] = s.default;
  if (instrumentId && def.presets?.[instrumentId]) Object.assign(p, def.presets[instrumentId]);
  return p;
}

export const num = (p: Params, k: string, d = 0): number => {
  const v = p[k];
  return typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : d;
};
export const bool = (p: Params, k: string, d = false): boolean => {
  const v = p[k];
  return typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : d;
};
export const str = (p: Params, k: string, d = ""): string => {
  const v = p[k];
  return typeof v === "string" ? v : v === undefined ? d : String(v);
};

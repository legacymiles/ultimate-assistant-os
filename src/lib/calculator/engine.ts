// ---------------------------------------------------------------------------
// Multi-Order Basket Calculation Engine.
//
// Pure, deterministic math. No React, no DOM, no I/O. This is the layer that
// can later be ported to MT4/MT5/desktop/API without modification.
//
// Conventions:
//   Buy:  profit increases when price rises.   direction = +1
//   Sell: profit increases when price falls.   direction = -1
//
// Per-order P/L (in account currency, for a USD-quoted instrument like XAUUSD):
//   pnl = (exitPrice - entryPrice) * direction * contractSize * lots
//
// Basket costs (subtracted from total):
//   commission and swap are per-lot, applied across all orders.
//   spread (if provided) is interpreted as an extra cost on the EXIT in price
//   units; we approximate the impact as `spread * contractSize * |net lots|`.
// ---------------------------------------------------------------------------

import { getSymbol, type Symbol } from "./symbols";

export type Side = "buy" | "sell";

export interface Order {
  id: string;
  side: Side;
  lots: number;
  entryPrice: number;
}

export interface BasketSettings {
  symbol: string;
  targetPrice?: number;
  currentPrice?: number;
  /** Extra spread in price units charged on the exit (optional). */
  spread?: number;
  /** Commission per lot in account currency (round-turn unless your broker says otherwise). */
  commission?: number;
  /** Swap per lot in account currency (negative = cost). */
  swap?: number;
  accountCurrency: string;
}

export interface OrderResult {
  order: Order;
  /** P/L for this individual order at the supplied evaluation price. */
  pnl: number;
  /** Direction sign: +1 Buy, -1 Sell. */
  direction: number;
  /** Notional units (= lots * contractSize). */
  units: number;
}

export interface BasketResult {
  symbol: Symbol;
  evaluationPrice: number;
  orders: OrderResult[];

  totalLots: number;
  /** Sum of (lots * direction). Drives delta and break-even. */
  netLots: number;
  /** Sum of (lots * direction * contractSize). Price-sensitivity in $ per 1.0 price unit. */
  deltaUnits: number;

  /** Weighted average entry, weighted by lots only (sign-agnostic). */
  weightedAverageEntry: number;

  /** Gross P/L of all orders at the evaluation price. */
  grossPnl: number;
  totalCommission: number;
  totalSwap: number;
  spreadCost: number;
  /** Gross P/L minus commission/swap/spread. */
  netPnl: number;

  /** Break-even price (where netPnl == 0). null if basket is perfectly hedged. */
  breakEvenPrice: number | null;

  /** $ moved by a 1-point price change at the evaluation point. */
  dollarPerPoint: number;
  /** $ moved by a 1-pip price change. */
  dollarPerPip: number;

  /** Signed price distance from currentPrice (or evaluationPrice) to target. */
  distanceToTarget: number | null;
}

const isPos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function dirOf(side: Side): number {
  return side === "buy" ? 1 : -1;
}

/** Per-order P/L at a given exit price. */
export function orderPnl(order: Order, exitPrice: number, symbol: Symbol): number {
  if (!isPos(order.lots) || !isPos(order.entryPrice) || !isPos(exitPrice)) return 0;
  const dir = dirOf(order.side);
  return (exitPrice - order.entryPrice) * dir * symbol.contractSize * order.lots;
}

/** Sum of per-lot fees for an order list. */
function lotsSum(orders: Order[]): number {
  return orders.reduce((s, o) => s + (isPos(o.lots) ? o.lots : 0), 0);
}

/** Net delta units (positive = long-biased basket). */
function deltaUnits(orders: Order[], symbol: Symbol): number {
  return orders.reduce(
    (s, o) => s + (isPos(o.lots) ? o.lots * dirOf(o.side) * symbol.contractSize : 0),
    0,
  );
}

/**
 * Solve for the exit price at which the basket reaches a given NET P/L target.
 * Returns null if the basket is perfectly hedged (no price sensitivity).
 *
 * Math: netPnl(p) = sum((p - entry_i) * dir_i * cs * lots_i) - fees - spreadCost
 *                 = deltaUnits * p  -  sum(entry_i * dir_i * cs * lots_i) - fees - spreadCost
 *       Set netPnl(p) = target  →  p = (target + sumEntryDelta + fees + spreadCost) / deltaUnits
 */
export function solveExitPriceForPnl(
  orders: Order[],
  settings: BasketSettings,
  targetNetPnl: number,
): number | null {
  const symbol = getSymbol(settings.symbol);
  const du = deltaUnits(orders, symbol);
  if (Math.abs(du) < 1e-9) return null;

  const sumEntryDelta = orders.reduce((s, o) => {
    if (!isPos(o.lots) || !isPos(o.entryPrice)) return s;
    return s + o.entryPrice * dirOf(o.side) * symbol.contractSize * o.lots;
  }, 0);

  const totalLots = lotsSum(orders);
  const fees =
    (isPos(settings.commission) ? settings.commission * totalLots : 0) +
    (isPos(settings.swap) ? -settings.swap * totalLots : 0); // swap negative = cost, so subtract
  // spreadCost adds to required exit move; approximate as spread * |du|
  const spreadCost = isPos(settings.spread) ? settings.spread * Math.abs(du) : 0;

  return (targetNetPnl + sumEntryDelta + fees + spreadCost) / du;
}

/** Full basket evaluation at a single price point. */
export function evaluateBasket(
  orders: Order[],
  settings: BasketSettings,
  /** Override evaluation price; defaults to targetPrice ?? currentPrice ?? avg entry. */
  evaluationPrice?: number,
): BasketResult {
  const symbol = getSymbol(settings.symbol);
  const totalLots = lotsSum(orders);

  const weightedAverageEntry =
    totalLots > 0
      ? orders.reduce(
          (s, o) => s + (isPos(o.entryPrice) && isPos(o.lots) ? o.entryPrice * o.lots : 0),
          0,
        ) / totalLots
      : 0;

  const evalPrice =
    isPos(evaluationPrice)
      ? evaluationPrice
      : isPos(settings.targetPrice)
        ? settings.targetPrice
        : isPos(settings.currentPrice)
          ? settings.currentPrice
          : weightedAverageEntry;

  const du = deltaUnits(orders, symbol);
  const netLots = orders.reduce(
    (s, o) => s + (isPos(o.lots) ? o.lots * dirOf(o.side) : 0),
    0,
  );

  const orderResults: OrderResult[] = orders.map((o) => ({
    order: o,
    pnl: orderPnl(o, evalPrice, symbol),
    direction: dirOf(o.side),
    units: (isPos(o.lots) ? o.lots : 0) * symbol.contractSize,
  }));

  const grossPnl = orderResults.reduce((s, r) => s + r.pnl, 0);
  const totalCommission = isPos(settings.commission) ? settings.commission * totalLots : 0;
  // Swap can be positive (credit) or negative (cost). We treat the input as
  // the credit-per-lot value, so subtracting nothing positive is a credit, etc.
  const totalSwap = isPos(settings.swap) ? settings.swap * totalLots : 0;
  const spreadCost = isPos(settings.spread) ? settings.spread * Math.abs(du) : 0;

  const netPnl = grossPnl - totalCommission + totalSwap - spreadCost;

  const breakEvenPrice = solveExitPriceForPnl(orders, settings, 0);

  const dollarPerPoint = Math.abs(du) * symbol.pointSize;
  const dollarPerPip = dollarPerPoint * symbol.pointsPerPip;

  const refPrice = isPos(settings.currentPrice) ? settings.currentPrice : evalPrice;
  const distanceToTarget = isPos(settings.targetPrice)
    ? settings.targetPrice - refPrice
    : null;

  return {
    symbol,
    evaluationPrice: evalPrice,
    orders: orderResults,
    totalLots,
    netLots,
    deltaUnits: du,
    weightedAverageEntry,
    grossPnl,
    totalCommission,
    totalSwap,
    spreadCost,
    netPnl,
    breakEvenPrice,
    dollarPerPoint,
    dollarPerPip,
    distanceToTarget,
  };
}

/** Sample basket P/L across a range of prices, for the profit chart. */
export interface ChartPoint {
  price: number;
  pnl: number;
}

export function sampleProfitCurve(
  orders: Order[],
  settings: BasketSettings,
  opts: { from: number; to: number; samples?: number },
): ChartPoint[] {
  const symbol = getSymbol(settings.symbol);
  const samples = Math.max(2, Math.min(opts.samples ?? 200, 1000));
  const step = (opts.to - opts.from) / (samples - 1);
  const totalLots = lotsSum(orders);
  const totalCommission = isPos(settings.commission) ? settings.commission * totalLots : 0;
  const totalSwap = isPos(settings.swap) ? settings.swap * totalLots : 0;
  const du = deltaUnits(orders, symbol);
  const spreadCost = isPos(settings.spread) ? settings.spread * Math.abs(du) : 0;

  const out: ChartPoint[] = [];
  for (let i = 0; i < samples; i++) {
    const price = opts.from + step * i;
    let gross = 0;
    for (const o of orders) {
      if (!isPos(o.lots) || !isPos(o.entryPrice)) continue;
      gross +=
        (price - o.entryPrice) * dirOf(o.side) * symbol.contractSize * o.lots;
    }
    out.push({ price, pnl: gross - totalCommission + totalSwap - spreadCost });
  }
  return out;
}

/** Suggest a sensible price window for the chart based on the basket. */
export function suggestPriceWindow(
  orders: Order[],
  settings: BasketSettings,
): { from: number; to: number } | null {
  const prices: number[] = [];
  for (const o of orders) if (isPos(o.entryPrice)) prices.push(o.entryPrice);
  if (isPos(settings.targetPrice)) prices.push(settings.targetPrice);
  if (isPos(settings.currentPrice)) prices.push(settings.currentPrice);
  if (!prices.length) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // Pad ±2% (or at least ±5 price units for XAUUSD) so the chart shows context.
  const center = (min + max) / 2;
  const half = Math.max((max - min) * 0.75, center * 0.02, 5);
  return { from: center - half, to: center + half };
}

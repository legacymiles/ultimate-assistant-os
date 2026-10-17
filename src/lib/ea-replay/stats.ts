// ---------------------------------------------------------------------------
// EA World › Replay — the numbers a session is judged by.
//
// Two that a normal tester report hides and an HFT EA is judged by:
//  - COMMISSION as a share of gross profit. If commission eats most of what
//    the bot wins, the bot only works on a commission-free account.
//  - AVERAGE WIN in points next to the average SPREAD. A scalper whose
//    average win is barely bigger than the spread is living on luck.
// ---------------------------------------------------------------------------

import type { SimOrder } from "./broker";
import type { EquityPoint } from "./engine";

export interface ReplayStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  net: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  commission: number;
  /** Commission ÷ gross profit before commission. */
  commissionShare: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  avgWinPts: number;
  avgLossPts: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  longestLosingStreak: number;
  avgHoldSec: number;
  byReason: Record<string, number>;
}

export function computeStats(history: SimOrder[], equity: EquityPoint[], startBalance: number, point: number): ReplayStats {
  const closed = history.filter((o) => o.status === "closed");
  let grossProfit = 0;
  let grossLoss = 0;
  let commission = 0;
  let wins = 0;
  let losses = 0;
  let winPts = 0;
  let lossPts = 0;
  let streak = 0;
  let longest = 0;
  let hold = 0;
  const byReason: Record<string, number> = {};

  for (const o of closed) {
    const p = o.profit ?? 0;
    commission += o.commission;
    const pts = ((o.closePrice! - o.openPrice) / point) * (o.type === "buy" ? 1 : -1);
    if (p > 0) {
      wins++;
      grossProfit += p;
      winPts += pts;
      streak = 0;
    } else {
      losses++;
      grossLoss += -p;
      lossPts += pts;
      streak++;
      longest = Math.max(longest, streak);
    }
    if (o.openTime != null && o.closeTime != null) hold += (o.closeTime - o.openTime) / 1000;
    const r = o.closeReason ?? "close";
    byReason[r] = (byReason[r] ?? 0) + 1;
  }

  let peak = startBalance;
  let maxDd = 0;
  let maxDdPct = 0;
  for (const e of equity) {
    if (e.equity > peak) peak = e.equity;
    const dd = peak - e.equity;
    if (dd > maxDd) {
      maxDd = dd;
      maxDdPct = peak > 0 ? (dd / peak) * 100 : 0;
    }
  }

  const trades = closed.length;
  const net = grossProfit - grossLoss;
  const grossBeforeCommission = grossProfit + commission;
  return {
    trades,
    wins,
    losses,
    winRate: trades ? (wins / trades) * 100 : 0,
    net: round2(net),
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    commission: round2(commission),
    commissionShare: grossBeforeCommission > 0 ? commission / grossBeforeCommission : 0,
    avgWin: wins ? round2(grossProfit / wins) : 0,
    avgLoss: losses ? round2(grossLoss / losses) : 0,
    expectancy: trades ? round2(net / trades) : 0,
    avgWinPts: wins ? winPts / wins : 0,
    avgLossPts: losses ? lossPts / losses : 0,
    maxDrawdown: round2(maxDd),
    maxDrawdownPct: maxDdPct,
    longestLosingStreak: longest,
    avgHoldSec: trades ? hold / trades : 0,
    byReason,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

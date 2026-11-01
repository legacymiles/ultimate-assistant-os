// ---------------------------------------------------------------------------
// What kind of EA is this?
//
// Classified by HOW IT FAILS, not by what indicator it reads. Grouping on
// indicators would file a martingale grid and a fixed-stop breakout together
// for both using an RSI, which tells the owner nothing about what happens to
// the account on a bad week.
//
// Every rule here reads the trades the tester actually produced, so an EA is
// filed by its measured behaviour rather than by whatever its seller called
// it. It needs no AI key, which is the repo rule: a missing key degrades a
// feature visibly, it never removes one.
// ---------------------------------------------------------------------------

import type { Trade, ExposureProfile, StrategyClass } from "./types";

export interface Classification {
  strategy: StrategyClass;
  /** 0-1. Below ~0.5 the owner should treat this as a guess worth correcting. */
  confidence: number;
  /** The measured reason, in one sentence. */
  why: string;
}

const MINUTE = 60_000;

export function classify(trades: Trade[], exposure: ExposureProfile): Classification {
  if (trades.length === 0) {
    // Panels, position sizers and trade assistants load fine and never trade.
    return {
      strategy: "manual-tool",
      confidence: 0.6,
      why: "Placed no trades over the whole test, so it is a panel or assistant rather than an autonomous strategy.",
    };
  }

  // Martingale outranks everything: it is the behaviour that decides the
  // account's fate regardless of what signal opened the first trade.
  if (exposure.progression === "martingale") {
    return {
      strategy: "martingale",
      confidence: 0.9,
      why: `Size escalates for ${exposure.maxLadderDepth} consecutive losses to ${exposure.maxLotMultiple}x base.`,
    };
  }

  const holds = trades
    .filter((t) => typeof t.openTime === "number")
    .map((t) => t.time - (t.openTime as number))
    .sort((a, b) => a - b);
  const medianHold = holds.length ? holds[Math.floor(holds.length / 2)] : NaN;

  const hedged = exposure.maxGrossLots > exposure.maxNakedLots * 1.5;
  const concurrent = exposure.baseLot > 0 ? exposure.maxGrossLots / exposure.baseLot : 0;

  // A hedge book carries both sides at once; a grid carries many of one side.
  if (hedged && concurrent >= 3) {
    return {
      strategy: "hedge-recovery",
      confidence: 0.8,
      why: `Holds both sides at once — ${exposure.maxGrossLots} lots gross against ${exposure.maxNakedLots} naked.`,
    };
  }
  if (concurrent >= 5 && exposure.maxLotMultiple <= 1.5) {
    return {
      strategy: "grid",
      confidence: 0.7,
      why: `Runs up to ${Math.round(concurrent)} same-size positions at once with no escalation — a ladder, not a recovery.`,
    };
  }

  const wins = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit < 0);
  const winRate = wins.length / trades.length;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.profit, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.profit, 0) / losses.length) : 0;

  if (Number.isFinite(medianHold) && medianHold < 15 * MINUTE && trades.length > 100) {
    return {
      strategy: "scalper",
      confidence: 0.75,
      why: `${trades.length} trades with a median hold of ${Math.round(medianHold / MINUTE)} min — its edge has to clear the spread every time.`,
    };
  }

  // The two honest shapes, told apart by which tail they carry.
  if (winRate >= 0.6 && avgLoss > avgWin) {
    return {
      strategy: "mean-reversion",
      confidence: 0.65,
      why: `Wins ${(winRate * 100).toFixed(0)}% of trades but loses more per loss than it makes per win — the left tail is where its risk lives.`,
    };
  }
  if (winRate < 0.5 && avgWin > avgLoss * 1.3) {
    return {
      strategy: "trend",
      confidence: 0.65,
      why: `Wins only ${(winRate * 100).toFixed(0)}% but each win is ${(avgWin / (avgLoss || 1)).toFixed(1)}x the average loss — it pays for many small losses with few large wins.`,
    };
  }

  return {
    strategy: "unknown",
    confidence: 0.3,
    why: `${trades.length} trades, ${(winRate * 100).toFixed(0)}% win rate, no clear signature. Worth filing by hand.`,
  };
}

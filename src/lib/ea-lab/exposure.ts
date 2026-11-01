// ---------------------------------------------------------------------------
// The exposure detector.
//
// Standard EA metrics cannot see the thing that actually ends accounts. A
// martingale grid posts a high win rate, a smooth equity curve and a modest
// reported drawdown for months, because every metric is computed from CLOSED
// trades and the danger lives in what is OPEN.
//
// Measured directly on the owner's own ZoneRecoveryPro: the EA panel reported
// a per-cycle drawdown of -105.00, and that figure was correct. The real risk
// was that at `Max Hedge Trade` the ladder stops hedging and leaves the
// account holding 0.22 lots NAKED — eleven times the starting size, with no
// protection. A 100-point move against that is -$2,200 on a $3,477 balance,
// and not one standard metric reports it.
//
// So this file reconstructs the open book over time and reports peak naked
// exposure, which is the number that was missing.
// ---------------------------------------------------------------------------

import type { Trade, ExposureProfile } from "./types";

/** A position opening or closing, for the sweep. */
interface Event {
  t: number;
  /** Signed lots entering (+) or leaving (-) the book. */
  delta: number;
  /** Unsigned lots, for gross exposure. */
  gross: number;
}

export function analyzeExposure(trades: Trade[]): ExposureProfile {
  const findings: string[] = [];
  const usable = trades.filter((t) => t.lots > 0);
  if (usable.length === 0) {
    return {
      baseLot: 0, maxLotMultiple: 0, maxGrossLots: 0, maxNakedLots: 0,
      progression: "constant", upsizeAfterLossRate: 0, maxLadderDepth: 0, riskScore: 0,
      findings: ["No trades to analyse."],
    };
  }

  const lots = usable.map((t) => t.lots);
  const baseLot = Math.min(...lots);
  const maxLot = Math.max(...lots);
  const maxLotMultiple = baseLot > 0 ? maxLot / baseLot : 0;

  // --- Concurrent exposure -------------------------------------------------
  // Needs open AND close times. Without openTime a report only tells us trades
  // happened, not what was held at once, so we say so rather than guessing.
  const haveOpen = usable.every((t) => typeof t.openTime === "number");
  let maxGrossLots = 0;
  let maxNakedLots = 0;
  if (haveOpen) {
    const ev: Event[] = [];
    for (const t of usable) {
      const s = t.side === "buy" ? 1 : -1;
      ev.push({ t: t.openTime as number, delta: s * t.lots, gross: t.lots });
      ev.push({ t: t.time, delta: -s * t.lots, gross: -t.lots });
    }
    // Exposure is what the account HOLDS at an instant, so every event sharing
    // a timestamp is applied before anything is measured. Stepping through them
    // one at a time invents exposure that never existed: the five legs of a
    // hedge ladder closing together would swing the running net to -0.24 and
    // then -0.32 purely from tie-ordering, and report a naked peak 45% higher
    // than the 0.22 the account actually carried.
    ev.sort((a, b) => a.t - b.t);
    let net = 0, gross = 0;
    for (let i = 0; i < ev.length; ) {
      const at = ev[i].t;
      while (i < ev.length && ev[i].t === at) {
        net += ev[i].delta;
        gross += ev[i].gross;
        i++;
      }
      maxNakedLots = Math.max(maxNakedLots, Math.abs(net));
      maxGrossLots = Math.max(maxGrossLots, gross);
    }
    maxNakedLots = round2(maxNakedLots);
    maxGrossLots = round2(maxGrossLots);
  } else {
    findings.push("Report has no open times, so concurrent exposure could not be reconstructed.");
    maxGrossLots = maxLot;
    maxNakedLots = maxLot;
  }

  // --- Does size respond to losses? ---------------------------------------
  const byOpen = [...usable].sort((a, b) => (a.openTime ?? a.time) - (b.openTime ?? b.time));
  let afterLoss = 0, upsized = 0, ladder = 0, maxLadderDepth = 0;
  for (let i = 1; i < byOpen.length; i++) {
    const escalated = byOpen[i - 1].profit < 0 && byOpen[i].lots > byOpen[i - 1].lots * 1.01;
    if (byOpen[i - 1].profit < 0) {
      afterLoss++;
      if (escalated) upsized++;
    }
    // A LADDER is consecutive escalation: each loss answered by a bigger trade
    // than the one before it. That is what separates a martingale from a
    // strategy that simply trades two sizes -- alternating 0.03/0.01 upsizes
    // after every loss and never escalates, so a rate alone convicts it wrongly.
    ladder = escalated ? ladder + 1 : 0;
    maxLadderDepth = Math.max(maxLadderDepth, ladder);
  }
  const upsizeAfterLossRate = afterLoss > 0 ? upsized / afterLoss : 0;

  let progression: ExposureProfile["progression"] = "constant";
  if (maxLotMultiple > 1.01) {
    progression = maxLadderDepth >= 3 ? "martingale" : "scaling";
  }

  // --- Score ---------------------------------------------------------------
  // Weighted toward naked exposure, because that is the term that actually
  // produces a blown account rather than an ugly month.
  const nakedMult = baseLot > 0 ? maxNakedLots / baseLot : 0;
  const score = clamp(
    Math.round(
      Math.min(40, Math.max(0, nakedMult - 1) * 8) +       // naked size above base
      Math.min(35, Math.max(0, maxLotMultiple - 1) * 10) +  // ladder steepness
      Math.min(25, maxLadderDepth * 8)                      // how deep the ladder runs
    ), 0, 100);

  if (progression === "martingale") {
    findings.push(
      `Size escalates for ${maxLadderDepth} consecutive losses, reaching ${maxLotMultiple.toFixed(1)}x `
      + `the base lot. This is a martingale: it converts many small wins into one unbounded loss.`);
  } else if (progression === "scaling") {
    findings.push(
      `Size varies up to ${maxLotMultiple.toFixed(1)}x base and grows after ${pct(upsizeAfterLossRate)} `
      + `of losses, but never escalates for more than ${maxLadderDepth} in a row, so this reads as `
      + `deliberate sizing rather than a recovery ladder.`);
  } else {
    findings.push("Position size is constant. No recovery ladder.");
  }

  if (haveOpen && nakedMult > 2) {
    findings.push(
      `Peak UNHEDGED exposure reached ${maxNakedLots} lots — ${nakedMult.toFixed(1)}x the base lot. `
      + `This is the figure standard drawdown metrics cannot see, because it is measured on the open `
      + `book rather than on closed trades.`);
  }
  if (haveOpen && maxGrossLots > maxNakedLots * 1.5) {
    findings.push(
      `Gross exposure peaked at ${maxGrossLots} lots against ${maxNakedLots} naked, so most of the `
      + `book was hedged. The hedge is only protection while it is still on.`);
  }

  return { baseLot, maxLotMultiple: round2(maxLotMultiple), maxGrossLots, maxNakedLots,
           progression, upsizeAfterLossRate, maxLadderDepth, riskScore: score, findings };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const pct = (n: number) => `${Math.round(n * 100)}%`;

// ---------------------------------------------------------------------------
// The lab's verdict on an EA.
//
// Two rules decide everything here, and both exist to stop the leaderboard
// filling up with the wrong EAs.
//
// RULE 1 -- never rank across modelling qualities. A profit factor from a 90%
// MT4 run and one from a real-tick MT5 run are not the same kind of fact. The
// runs are bucketed into tiers and only compared inside a tier; an EA whose
// only evidence is an open-prices run is not "unrated because it is bad", it
// is unrated because nothing has actually been measured about it yet.
//
// RULE 2 -- score out-of-sample, never in-sample. Ranking on in-sample profit
// factor builds a leaderboard of the most overfit EAs in the folder, sorted by
// how thoroughly they memorised the past. An EA with no out-of-sample run is
// blocked from scoring rather than flattered by its backtest.
//
// The exposure penalty is what stops a martingale topping a drawdown-sorted
// table. Measured on a real EA from the owner's own folder: 71.6% win rate,
// which is what sells it, and 231x base-lot naked exposure, which is what
// happens afterwards.
// ---------------------------------------------------------------------------

import type { TestRun, Rating, ModelQuality } from "./types";

/** Higher is more trustworthy. Runs are only ever compared within a tier. */
export function qualityTier(m: ModelQuality): number {
  if (m.kind === "real-ticks") return 3;
  if (m.kind === "every-tick") return m.percent >= 99 ? 3 : m.percent >= 90 ? 2 : 1;
  if (m.kind === "control-points") return 1;
  return 0; // open-prices, unknown
}

export const TIER_LABEL = ["untrusted", "indicative", "good", "high fidelity"];

/** Enough closed trades that the result is not one lucky streak. */
const MIN_TRADES = 30;

export function rate(eaId: string, runs: TestRun[]): Rating {
  const usable = runs.filter((r) => !r.error && qualityTier(r.modelQuality) >= 1);
  if (usable.length === 0) {
    return {
      eaId, score: null, reasons: [],
      blocked: runs.length
        ? "Every run so far used a model too coarse to trust. Re-test on every-tick or real ticks."
        : "Not tested yet.",
    };
  }

  // Only the best tier available is used, so a good run is never averaged with
  // a poor one into a number that describes neither.
  const best = Math.max(...usable.map((r) => qualityTier(r.modelQuality)));
  const inTier = usable.filter((r) => qualityTier(r.modelQuality) === best);

  const oos = inTier.filter((r) => r.sample === "out-of-sample");
  const is = inTier.filter((r) => r.sample === "in-sample");

  if (oos.length === 0) {
    return {
      eaId, score: null,
      reasons: [`${inTier.length} run(s) at ${TIER_LABEL[best]} quality, but all in-sample.`],
      blocked: "No out-of-sample run. An in-sample backtest measures memory, not skill.",
    };
  }

  // The out-of-sample run with the most trades is the most informative one.
  const run = [...oos].sort((a, b) => b.metrics.trades - a.metrics.trades)[0];
  const m = run.metrics;
  const reasons: string[] = [];

  // --- Return per unit of pain (40) ---------------------------------------
  // Recovery factor, not net profit: a strategy that made $10k through a $9k
  // drawdown is not the same product as one that made $10k through $1k.
  const rf = m.recoveryFactor;
  const rfPts = rf <= 0 ? 0 : Math.min(40, rf * 13);
  reasons.push(
    rf <= 0
      ? `Lost money out-of-sample (recovery factor ${rf.toFixed(2)}).`
      : `Recovery factor ${rf.toFixed(2)} out-of-sample — ${rf.toFixed(1)}x its worst drawdown.`,
  );

  // --- Drawdown (25) -------------------------------------------------------
  const dd = m.maxDrawdownPct;
  const ddPts = !Number.isFinite(dd) ? 0 : Math.max(0, Math.min(25, 25 * (1 - (dd - 5) / 35)));
  reasons.push(`Max drawdown ${Number.isFinite(dd) ? dd.toFixed(1) + "%" : "unknown"}`
    + (m.maxDrawdownDays ? `, ${m.maxDrawdownDays} days below the previous peak.` : "."));

  // --- Did it survive unseen data? (20) ------------------------------------
  let consPts = 10;
  if (is.length) {
    const isPf = is[0].metrics.profitFactor;
    const ratio = isPf > 0 ? m.profitFactor / isPf : 0;
    consPts = Math.max(0, Math.min(20, ratio * 20));
    reasons.push(
      ratio >= 0.8
        ? `Holds up out-of-sample (${(ratio * 100).toFixed(0)}% of its in-sample profit factor).`
        : `Degrades out-of-sample — keeps only ${(ratio * 100).toFixed(0)}% of its in-sample profit `
          + `factor, which is the signature of curve fitting.`,
    );
  } else {
    reasons.push("No in-sample run to compare against, so over-fitting could not be measured.");
  }

  // --- Enough evidence? (15) ----------------------------------------------
  const tradePts = Math.min(15, (m.trades / MIN_TRADES) * 15);
  if (m.trades < MIN_TRADES) {
    reasons.push(`Only ${m.trades} out-of-sample trades — too few to separate skill from luck.`);
  }

  // --- Exposure penalty (up to -50) ---------------------------------------
  const e = run.exposure;
  const penalty = e.riskScore * 0.5;
  if (e.progression === "martingale") {
    reasons.push(
      `Martingale: size escalates for ${e.maxLadderDepth} consecutive losses to `
      + `${e.maxLotMultiple}x base, peaking at ${e.maxNakedLots} lots unhedged. `
      + `Drawdown figures do not price this in.`,
    );
  } else if (e.maxNakedLots > e.baseLot * 3) {
    reasons.push(
      `Peak unhedged exposure ${e.maxNakedLots} lots against a ${e.baseLot} base.`,
    );
  }

  const score = Math.round(
    Math.max(0, Math.min(100, rfPts + ddPts + consPts + tradePts - penalty)),
  );

  return { eaId, score, reasons, bestRun: run.id };
}

/** Sort for the table: scored EAs first by score, then blocked ones. */
export function byRating(a: Rating, b: Rating): number {
  if (a.score === null && b.score === null) return 0;
  if (a.score === null) return 1;
  if (b.score === null) return -1;
  return b.score - a.score;
}

import { describe, it, expect } from "vitest";
import { rate, qualityTier } from "./rating";
import { classify } from "./classify";
import type { TestRun, RunMetrics, ExposureProfile, Sample, ModelQuality, Trade } from "./types";

const metrics = (o: Partial<RunMetrics> = {}): RunMetrics => ({
  netProfit: 5000, grossProfit: 9000, grossLoss: -4000, profitFactor: 2.25,
  expectedPayoff: 25, maxDrawdown: 1000, maxDrawdownPct: 10, maxDrawdownDays: 4,
  recoveryFactor: 5, trades: 200, winRate: 0.55, largestLoss: -300,
  maxConsecutiveLosses: 5, ...o,
});

const exposure = (o: Partial<ExposureProfile> = {}): ExposureProfile => ({
  baseLot: 0.01, maxLotMultiple: 1, maxGrossLots: 0.01, maxNakedLots: 0.01,
  progression: "constant", upsizeAfterLossRate: 0, maxLadderDepth: 0,
  riskScore: 0, findings: [], ...o,
});

const run = (o: Partial<TestRun> = {}): TestRun => ({
  id: "r1", eaId: "ea", symbol: "XAUUSD", timeframe: "H1",
  from: 0, to: 1, sample: "out-of-sample" as Sample,
  modelQuality: { kind: "every-tick", percent: 99 } as ModelQuality,
  deposit: 10000, currency: "USD", leverage: 200, spreadPoints: 20,
  server: "Coinexx-Demo", metrics: metrics(), exposure: exposure(),
  trades: [], ranAt: 0, ...o,
});

describe("qualityTier", () => {
  it("separates fidelities that must never be compared", () => {
    expect(qualityTier({ kind: "real-ticks" })).toBe(3);
    expect(qualityTier({ kind: "every-tick", percent: 99 })).toBe(3);
    expect(qualityTier({ kind: "every-tick", percent: 90 })).toBe(2);
    expect(qualityTier({ kind: "every-tick", percent: 25 })).toBe(1);
    expect(qualityTier({ kind: "open-prices", percent: 0 })).toBe(0);
    expect(qualityTier({ kind: "unknown" })).toBe(0);
  });
});

describe("rate", () => {
  it("says untested rather than unrated when nothing has run", () => {
    const r = rate("ea", []);
    expect(r.score).toBeNull();
    expect(r.blocked).toContain("Not tested");
  });

  it("refuses to score an EA whose only evidence is an open-prices run", () => {
    const r = rate("ea", [run({ modelQuality: { kind: "open-prices", percent: 0 } })]);
    expect(r.score).toBeNull();
    expect(r.blocked).toContain("too coarse");
  });

  it("refuses to score on in-sample results alone", () => {
    // The whole point: an in-sample backtest measures memory, not skill.
    const r = rate("ea", [run({ sample: "in-sample" })]);
    expect(r.score).toBeNull();
    expect(r.blocked).toContain("in-sample");
  });

  it("scores a clean out-of-sample performer well", () => {
    const r = rate("ea", [run()]);
    expect(r.score).toBeGreaterThan(70);
    expect(r.reasons.join(" ")).toContain("Recovery factor");
  });

  it("penalises a martingale below an otherwise identical clean EA", () => {
    // Same metrics on both -- only the exposure profile differs. This is the
    // case standard metrics get wrong, so it must come out unambiguous here.
    const clean = rate("clean", [run()]);
    const bomb = rate("bomb", [run({
      exposure: exposure({
        maxLotMultiple: 10, maxGrossLots: 4.6, maxNakedLots: 2.31,
        progression: "martingale", maxLadderDepth: 3, riskScore: 99,
      }),
    })]);
    expect(clean.score).not.toBeNull();
    expect(bomb.score).not.toBeNull();
    expect(bomb.score!).toBeLessThan(clean.score! - 40);
    expect(bomb.reasons.join(" ")).toContain("Martingale");
  });

  it("names curve fitting when out-of-sample keeps little of in-sample", () => {
    const r = rate("ea", [
      run({ id: "is", sample: "in-sample", metrics: metrics({ profitFactor: 3.0 }) }),
      run({ id: "oos", sample: "out-of-sample", metrics: metrics({ profitFactor: 0.6 }) }),
    ]);
    expect(r.reasons.join(" ")).toContain("curve fitting");
  });

  it("uses only the best available tier rather than averaging fidelities", () => {
    // A good run plus a poor one must score like the good one alone, not like
    // a blend that describes neither.
    const good = run({ id: "good", modelQuality: { kind: "real-ticks" } });
    const poor = run({
      id: "poor", modelQuality: { kind: "every-tick", percent: 25 },
      metrics: metrics({ recoveryFactor: -2, maxDrawdownPct: 80 }),
    });
    expect(rate("ea", [good, poor]).score).toBe(rate("ea", [good]).score);
  });

  it("marks down a result built on too few trades", () => {
    const many = rate("a", [run({ metrics: metrics({ trades: 200 }) })]);
    const few = rate("b", [run({ metrics: metrics({ trades: 6 }) })]);
    expect(few.score!).toBeLessThan(many.score!);
    expect(few.reasons.join(" ")).toContain("too few");
  });
});

describe("classify", () => {
  const t = (openTime: number, time: number, side: Trade["side"], lots: number, profit: number): Trade =>
    ({ openTime, time, side, lots, profit, price: 4000 });

  it("files a non-trading panel as a tool, not a failed strategy", () => {
    expect(classify([], exposure()).strategy).toBe("manual-tool");
  });

  it("files a martingale by the behaviour that decides the account", () => {
    const c = classify([t(0, 1, "buy", 0.01, -5)], exposure({
      progression: "martingale", maxLadderDepth: 4, maxLotMultiple: 16,
    }));
    expect(c.strategy).toBe("martingale");
    expect(c.confidence).toBeGreaterThan(0.8);
  });

  it("tells a hedge book from a grid by whether both sides are held", () => {
    const trades = [t(0, 10, "buy", 0.1, 5)];
    expect(classify(trades, exposure({
      baseLot: 0.1, maxGrossLots: 0.6, maxNakedLots: 0.2,
    })).strategy).toBe("hedge-recovery");
    expect(classify(trades, exposure({
      baseLot: 0.1, maxGrossLots: 0.8, maxNakedLots: 0.8, maxLotMultiple: 1,
    })).strategy).toBe("grid");
  });

  it("spots a scalper by hold time, not trade count alone", () => {
    const trades = Array.from({ length: 150 }, (_, i) =>
      t(i * 60_000, i * 60_000 + 120_000, "buy", 0.01, i % 2 ? 1 : -0.8));
    expect(classify(trades, exposure()).strategy).toBe("scalper");
  });

  it("separates trend from mean-reversion by which tail it carries", () => {
    const H = 3_600_000;
    const trend = Array.from({ length: 100 }, (_, i) =>
      t(i * H, i * H + 5 * H, "buy", 0.01, i % 5 === 0 ? 100 : -15));
    expect(classify(trend, exposure()).strategy).toBe("trend");

    const revert = Array.from({ length: 100 }, (_, i) =>
      t(i * H, i * H + 5 * H, "buy", 0.01, i % 5 === 0 ? -200 : 20));
    expect(classify(revert, exposure()).strategy).toBe("mean-reversion");
  });
});

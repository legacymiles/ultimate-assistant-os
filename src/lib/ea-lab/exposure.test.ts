import { describe, it, expect } from "vitest";
import { analyzeExposure } from "./exposure";
import type { Trade } from "./types";

const H = 3_600_000;
const t = (openTime: number, time: number, side: Trade["side"], lots: number, profit: number): Trade =>
  ({ openTime, time, side, lots, profit, price: 4000 });

describe("analyzeExposure", () => {
  it("calls constant sizing what it is, and scores it benign", () => {
    const trades = Array.from({ length: 20 }, (_, i) =>
      t(i * H, i * H + H / 2, i % 2 ? "buy" : "sell", 0.01, i % 3 ? 5 : -7));
    const r = analyzeExposure(trades);
    expect(r.progression).toBe("constant");
    expect(r.maxLotMultiple).toBe(1);
    expect(r.riskScore).toBeLessThan(10);
    expect(r.findings.join(" ")).toContain("No recovery ladder");
  });

  it("detects a martingale that doubles after every loss", () => {
    // Each trade loses, and the next doubles -- the textbook ladder.
    const trades: Trade[] = [];
    let lots = 0.01;
    for (let i = 0; i < 8; i++) {
      trades.push(t(i * H, i * H + H / 2, "buy", lots, -10 * lots * 100));
      lots *= 2;
    }
    const r = analyzeExposure(trades);
    expect(r.progression).toBe("martingale");
    expect(r.upsizeAfterLossRate).toBeGreaterThan(0.9);
    expect(r.maxLotMultiple).toBeCloseTo(128, 0);
    expect(r.riskScore).toBeGreaterThan(70);
    expect(r.findings.join(" ")).toContain("martingale");
  });

  it("does not cry martingale at sizing that ignores losses", () => {
    // Size varies, but it is the WINNERS that get scaled up.
    const trades: Trade[] = [];
    for (let i = 0; i < 20; i++) {
      const won = i % 2 === 0;
      trades.push(t(i * H, i * H + H / 2, "buy", won ? 0.03 : 0.01, won ? 20 : -5));
    }
    const r = analyzeExposure(trades);
    expect(r.progression).toBe("scaling");
    expect(r.upsizeAfterLossRate).toBeGreaterThan(0.9); // loss -> bigger happens...
    expect(r.maxLotMultiple).toBe(3);
  });

  it("reproduces the ZoneRecoveryPro ladder and finds the naked 0.22 lots", () => {
    // The exact ladder measured on the owner's account (spec Part 1):
    // sell 0.02 -> buy 0.04 -> sell 0.08 -> buy 0.16 -> sell 0.32, all held
    // open together, hedged at every step. Net runs -0.02, +0.02, -0.06,
    // +0.10, -0.22. The EA panel reported -105.00 and was right; what it never
    // showed was that the account ends the cycle holding 0.22 lots NAKED.
    const CLOSE = 10 * H;
    const trades: Trade[] = [
      t(0 * H, CLOSE, "sell", 0.02, -10),
      t(1 * H, CLOSE, "buy",  0.04, -20),
      t(2 * H, CLOSE, "sell", 0.08, -30),
      t(3 * H, CLOSE, "buy",  0.16, -40),
      t(4 * H, CLOSE, "sell", 0.32, -5),
    ];
    const r = analyzeExposure(trades);
    expect(r.maxNakedLots).toBe(0.22);   // the number the EA never reports
    expect(r.maxGrossLots).toBe(0.62);   // total book, mostly hedged
    expect(r.baseLot).toBe(0.02);
    expect(r.maxLotMultiple).toBe(16);
    expect(r.progression).toBe("martingale");
    expect(r.riskScore).toBeGreaterThan(60);
    const said = r.findings.join(" ");
    expect(said).toContain("UNHEDGED");
    expect(said).toContain("hedged");
  });

  it("separates gross from naked when the book is genuinely flat", () => {
    // Perfectly hedged pair: big gross, zero naked. A metric that only saw
    // gross would call this dangerous when the account carries no direction.
    const trades: Trade[] = [
      t(0, 5 * H, "buy", 1.0, -50),
      t(0, 5 * H, "sell", 1.0, 50),
    ];
    const r = analyzeExposure(trades);
    expect(r.maxGrossLots).toBe(2);
    expect(r.maxNakedLots).toBe(0);
  });

  it("says so rather than guessing when the report has no open times", () => {
    const trades: Trade[] = [
      { time: H, side: "buy", lots: 0.05, profit: 3, price: 4000 },
      { time: 2 * H, side: "sell", lots: 0.05, profit: -4, price: 4000 },
    ];
    const r = analyzeExposure(trades);
    expect(r.findings.join(" ")).toContain("no open times");
  });

  it("returns an empty profile instead of NaN for no trades", () => {
    const r = analyzeExposure([]);
    expect(r.riskScore).toBe(0);
    expect(r.baseLot).toBe(0);
  });
});

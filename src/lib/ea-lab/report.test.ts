import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMt4Report, decodeReport } from "./report";
import { analyzeExposure } from "./exposure";

// A real report off the rig, not a hand-written one. Every expectation below
// was read out of the file, so if MetaTrader changes its output these fail.
const html = decodeReport(
  new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "mt4-report.htm"))),
);

describe("parseMt4Report on a real rig report", () => {
  const r = parseMt4Report(html);

  it("reads the run's identity", () => {
    expect(r.ea).toBe("Moving Average");
    expect(r.server).toBe("Coinexx-Demo");
    expect(r.symbol).toBe("XAUUSD");
    expect(r.deposit).toBe(10000);
    expect(r.spread).toBe(20);
  });

  it("reads the headline metrics exactly", () => {
    expect(r.metrics.netProfit).toBe(-223);
    expect(r.metrics.grossProfit).toBe(30696.9);
    expect(r.metrics.grossLoss).toBe(-30919.9);
    expect(r.metrics.profitFactor).toBe(0.99);
    expect(r.metrics.expectedPayoff).toBe(-2.06);
    expect(r.metrics.largestLoss).toBe(-3020.4);
    expect(r.metrics.maxConsecutiveLosses).toBe(16);
  });

  it("splits the drawdown pair into money and percent", () => {
    expect(r.metrics.maxDrawdown).toBe(19390.8);
    expect(r.metrics.maxDrawdownPct).toBe(82.64);
  });

  it("refuses to launder an open-prices run into a trustworthy number", () => {
    // The report says "n/a" for modelling quality because the model was open
    // prices. That must survive as a warning, not be defaulted into silence.
    expect(r.model.kind).toBe("open-prices");
    expect(r.warnings.join(" ")).toContain("intrabar");
  });

  it("pairs entry and exit rows so every trade has an open time", () => {
    expect(r.trades.length).toBeGreaterThan(50);
    expect(r.trades.every((t) => typeof t.openTime === "number")).toBe(true);
    expect(r.trades.every((t) => Number.isFinite(t.openTime as number))).toBe(true);
    // An exit cannot precede its own entry.
    expect(r.trades.every((t) => (t.openTime as number) <= t.time)).toBe(true);
    expect(r.trades.every((t) => t.lots > 0)).toBe(true);
  });

  it("recovers a balance curve that ends where net profit says it should", () => {
    const withBal = r.trades.filter((t) => typeof t.balance === "number");
    expect(withBal.length).toBeGreaterThan(50);
    const last = withBal[withBal.length - 1].balance as number;
    expect(last).toBeCloseTo(r.deposit + r.metrics.netProfit, 1);
  });

  it("feeds the exposure detector, which finds constant sizing here", () => {
    // Stock Moving Average sizes off free margin, not off losses. Whatever it
    // does, it must not be reported as a recovery ladder.
    const e = analyzeExposure(r.trades);
    expect(e.baseLot).toBeGreaterThan(0);
    expect(e.progression).not.toBe("martingale");
    expect(e.maxNakedLots).toBeGreaterThan(0);
  });
});

describe("decodeReport", () => {
  it("honours a UTF-16LE BOM", () => {
    const text = "<title>Strategy Tester: X</title>";
    const buf = new Uint8Array(2 + text.length * 2);
    buf[0] = 0xff;
    buf[1] = 0xfe;
    for (let i = 0; i < text.length; i++) buf[2 + i * 2] = text.charCodeAt(i);
    expect(decodeReport(buf)).toContain("Strategy Tester: X");
  });

  it("falls back to windows-1252 rather than throwing on invalid UTF-8", () => {
    // 0x93/0x94 are smart quotes in cp1252 and invalid as UTF-8. A terminal on
    // a non-UTF-8 codepage emits these, and throwing would lose the whole run.
    const buf = new Uint8Array([0x3c, 0x62, 0x3e, 0x93, 0x94, 0x3c, 0x2f, 0x62, 0x3e]);
    expect(() => decodeReport(buf)).not.toThrow();
    expect(decodeReport(buf)).toContain("<b>");
  });
});

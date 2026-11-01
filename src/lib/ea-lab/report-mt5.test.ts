import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMt5Report, parseReport, isMt5Report, decodeReport } from "./report";
import { analyzeExposure } from "./exposure";

// HAND-WRITTEN in the MT5 report layout (UTF-16LE, like the real thing), not
// taken off a rig: no MT5 test had been run when this was written. It is built
// to hit the cases that break a naive parser -- thousands spaces, partial
// closes, a hedge leg, commission on an entry, an Orders table above Deals, and
// a position left open. Swap in a real report when the MT5 rig has made one.
const raw = new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "mt5-report.htm")));
const html = decodeReport(raw);

describe("parseMt5Report", () => {
  const r = parseMt5Report(html, { model: "every-tick" });

  it("is recognised as MT5 and routed there by parseReport", () => {
    expect(raw[0]).toBe(0xff);
    expect(isMt5Report(html)).toBe(true);
    expect(parseReport(html).ea).toBe("Gold Grid 5");
    const mt4 = decodeReport(new Uint8Array(readFileSync(join(__dirname, "__fixtures__", "mt4-report.htm"))));
    expect(isMt5Report(mt4)).toBe(false);
  });

  it("reads the run's identity", () => {
    expect(r.ea).toBe("Gold Grid 5");
    expect(r.server).toBe("Coinexx-Demo");
    expect(r.symbol).toBe("XAUUSD");
    expect(r.period).toBe("H1");
    expect(r.from).toBe(Date.UTC(2025, 0, 1));
    expect(r.to).toBe(Date.UTC(2025, 0, 31));
    expect(r.parameters).toBe("GridStep=150");
    expect(r.spread).toBe("current");
  });

  it("does not split numbers at the thousands space", () => {
    expect(r.deposit).toBe(10000);
    expect(r.barsInTest).toBe(2985);
    expect(r.ticksModelled).toBe(1234567);
    expect(r.metrics.netProfit).toBe(-1041);
    expect(r.metrics.grossLoss).toBe(-1250);
    expect(r.metrics.maxDrawdown).toBe(1650);
    expect(r.metrics.maxDrawdownPct).toBe(16.04);
  });

  it("reads the headline metrics", () => {
    expect(r.metrics.grossProfit).toBe(209);
    expect(r.metrics.profitFactor).toBe(0.17);
    expect(r.metrics.expectedPayoff).toBe(-173.5);
    expect(r.metrics.recoveryFactor).toBe(-0.63);
    expect(r.metrics.sharpe).toBe(-2.1);
    expect(r.metrics.trades).toBe(6);
    expect(r.metrics.largestLoss).toBe(-800);
    expect(r.metrics.maxConsecutiveLosses).toBe(2);
  });

  it("knows a real-ticks run when the report says so", () => {
    expect(r.model.kind).toBe("real-ticks");
  });

  it("falls back to the requested mode when the report names none", () => {
    const ohlc = parseMt5Report(html.replace("99% real ticks", "100%"), { model: "control-points" });
    expect(ohlc.model).toEqual({ kind: "control-points", percent: 100 });
    expect(ohlc.warnings.join(" ")).toContain("indicative");
    const open = parseMt5Report(html.replace("99% real ticks", "100%"), { model: "open-prices" });
    expect(open.model.kind).toBe("open-prices");
  });

  it("matches in and out deals into trades, FIFO, splitting partial closes", () => {
    expect(r.trades.map((t) => [t.side, t.lots, t.profit])).toEqual([
      ["buy", 0.1, 100],
      ["sell", 0.1, -50],     // first half of a 0.20 sell
      ["sell", 0.1, 30],      // second half
      ["buy", 0.1, -400],     // one 0.30 close spread over two buys, by volume
      ["buy", 0.2, -800],
      ["sell", 0.1, 79],      // the hedge leg, carrying its entry commission
    ]);
    expect(r.trades[1].openTime).toBe(Date.UTC(2025, 0, 3, 9));
    expect(r.trades[3].openTime).toBe(Date.UTC(2025, 0, 5, 9));
    expect(r.trades[4].openTime).toBe(Date.UTC(2025, 0, 5, 10));
    expect(r.trades.every((t) => (t.openTime as number) <= t.time)).toBe(true);
  });

  it("ignores the Orders table and the totals row", () => {
    expect(r.trades).toHaveLength(6);
  });

  it("ends the balance curve where net profit says it should", () => {
    const sum = r.trades.reduce((s, t) => s + t.profit, 0);
    expect(sum).toBeCloseTo(r.metrics.netProfit, 2);
    const withBal = r.trades.filter((t) => typeof t.balance === "number");
    expect(withBal[withBal.length - 1].balance).toBe(r.deposit + r.metrics.netProfit);
  });

  it("says a position was still open at the end", () => {
    expect(r.warnings.join(" ")).toContain("1 position(s) still open");
  });

  it("feeds the exposure detector the hedge and the doubled leg", () => {
    const e = analyzeExposure(r.trades);
    expect(e.baseLot).toBe(0.1);
    expect(e.maxGrossLots).toBeGreaterThanOrEqual(0.4);
    expect(e.maxNakedLots).toBeGreaterThanOrEqual(0.2);
  });
});

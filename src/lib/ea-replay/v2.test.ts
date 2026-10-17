import { describe, expect, it } from "vitest";
import { ReplayEngine } from "./engine";
import { instrumentById } from "./instruments";
import { applySuggestions, fingerprint, guessInstrument, parseMt4Report, suggestV2 } from "./statement";
import { defaultParams } from "./strategy";
import { HFT_SECRET_V2 } from "./strategies/hftSecretV2";
import { demoTicks } from "./demo";
import type { TickSeries } from "./types";

const US30 = instrumentById("US30")!;

// --- fixtures in MT4's own HTML shapes -------------------------------------

const STATEMENT = `<html><body><table>
<tr align=center><td>Ticket</td><td>Open Time</td><td>Type</td><td>Size</td><td>Item</td><td>Price</td><td>S / L</td><td>T / P</td><td>Close Time</td><td>Price</td><td>Commission</td><td>Taxes</td><td>Swap</td><td>Profit</td></tr>
<tr align=right><td title="HFT">1001</td><td class=msdate>2023.03.16 16:35:10</td><td>buy</td><td class=mspt>1.00</td><td>us30</td><td>32010.0</td><td>32015.5</td><td>0.0</td><td class=msdate>2023.03.16 16:36:02</td><td>32015.5</td><td>0.00</td><td>0.00</td><td>0.00</td><td>5.50</td></tr>
<tr align=right><td>1002</td><td class=msdate>2023.03.16 16:50:00</td><td>sell</td><td class=mspt>1.00</td><td>us30</td><td>32040.0</td><td>32065.0</td><td>0.0</td><td class=msdate>2023.03.16 16:52:30</td><td>32065.0</td><td>0.00</td><td>0.00</td><td>0.00</td><td>-25.00</td></tr>
<tr align=right><td>1003</td><td class=msdate>2023.03.16 17:20:00</td><td>buy</td><td class=mspt>1.00</td><td>us30</td><td>32100.0</td><td>32108.0</td><td>0.0</td><td class=msdate>2023.03.16 17:21:00</td><td>32108.0</td><td>0.00</td><td>0.00</td><td>0.00</td><td>8.00</td></tr>
<tr align=right><td>1004</td><td class=msdate>2023.03.17 16:40:00</td><td>buy limit</td><td class=mspt>1.00</td><td>us30</td><td>32000.0</td><td>0</td><td>0</td><td class=msdate>2023.03.17 16:41:00</td><td>cancelled</td><td></td><td></td><td></td><td></td></tr>
<tr align=right><td>1005</td><td class=msdate>2023.03.17 16:45:00</td><td>balance</td><td colspan=10>Deposit</td><td>1000.00</td></tr>
</table></body></html>`;

const TESTER = `<html><head><title>Strategy Tester: HFT Secret EA</title></head><body>
<table><tr align=left><td colspan=2>Symbol</td><td colspan=4>US30 (Dow Jones)</td></tr></table>
<table>
<tr bgcolor="#C0C0C0" align=right><td>#</td><td>Time</td><td>Type</td><td>Order</td><td>Size</td><td>Price</td><td>S / L</td><td>T / P</td><td>Profit</td><td>Balance</td></tr>
<tr align=right><td>1</td><td class=msdate>2024.01.03 16:31</td><td>buy stop</td><td>1</td><td class=mspt>1.00</td><td>37500.0</td><td>37475.0</td><td>0.0</td><td></td><td></td></tr>
<tr align=right><td>2</td><td class=msdate>2024.01.03 16:31</td><td>modify</td><td>1</td><td class=mspt>1.00</td><td>37498.0</td><td>37473.0</td><td>0.0</td><td></td><td></td></tr>
<tr align=right><td>3</td><td class=msdate>2024.01.03 16:32</td><td>buy</td><td>1</td><td class=mspt>1.00</td><td>37498.0</td><td>37473.0</td><td>0.0</td><td></td><td></td></tr>
<tr align=right><td>4</td><td class=msdate>2024.01.03 16:32</td><td>modify</td><td>1</td><td class=mspt>1.00</td><td>37498.0</td><td>37498.5</td><td>0.0</td><td></td><td></td></tr>
<tr align=right><td>5</td><td class=msdate>2024.01.03 16:33</td><td>modify</td><td>1</td><td class=mspt>1.00</td><td>37498.0</td><td>37499.0</td><td>0.0</td><td></td><td></td></tr>
<tr align=right><td>6</td><td class=msdate>2024.01.03 16:33</td><td>modify</td><td>1</td><td class=mspt>1.00</td><td>37498.0</td><td>37499.5</td><td>0.0</td><td></td><td></td></tr>
<tr align=right><td>7</td><td class=msdate>2024.01.03 16:34</td><td>s/l</td><td>1</td><td class=mspt>1.00</td><td>37499.5</td><td>37499.5</td><td>0.0</td><td>1.50</td><td>1001.50</td></tr>
<tr align=right><td>8</td><td class=msdate>2024.01.03 16:40</td><td>sell stop</td><td>2</td><td class=mspt>1.00</td><td>37480.0</td><td>37505.0</td><td>0.0</td><td></td><td></td></tr>
<tr align=right><td>9</td><td class=msdate>2024.01.03 16:41</td><td>delete</td><td>2</td><td class=mspt>1.00</td><td>37480.0</td><td>37505.0</td><td>0.0</td><td></td><td></td></tr>
</table></body></html>`;

describe("fingerprinting the original from its reports", () => {
  it("reads a detailed statement, skipping pendings and balance rows", () => {
    const rep = parseMt4Report(STATEMENT, 3);
    expect(rep.kind).toBe("statement");
    expect(rep.trades).toHaveLength(3);
    expect(rep.trades[0]).toMatchObject({ ticket: 1001, type: "buy", lots: 1, openPrice: 32010, closeKind: "sl" });
    // 16:35 server (GMT+3) = 13:35 UTC = 09:35 New York in March after DST
    expect(new Date(rep.trades[0].openTime).toISOString()).toBe("2023-03-16T13:35:10.000Z");
    const fp = fingerprint(rep);
    expect(fp.exits.trailedInProfit).toBe(2);
    expect(fp.nyHours[9]).toBe(2);
    expect(fp.nyHours[10]).toBe(1);
    expect(guessInstrument(fp.symbols)).toBe("US30");
  });

  it("reads a tester report: pendings, trail steps and deletes", () => {
    const rep = parseMt4Report(TESTER, 2);
    expect(rep.kind).toBe("tester");
    expect(rep.trades).toHaveLength(1);
    const t = rep.trades[0];
    expect(t.viaPending).toBe(true);
    expect(t.initialSl).toBe(37473);
    expect(t.slMoves).toEqual([37498.5, 37499, 37499.5]);
    expect(rep.deletedPendings).toBe(1);
    expect(rep.pendingModifies).toBe(1);
    const fp = fingerprint(rep);
    expect(fp.stopDist).toBe(25);
    expect(fp.viaPendingShare).toBe(1);
    expect(fp.symbols).toEqual(["US30"]);
  });

  it("turns measurements into v2 inputs with reasons", () => {
    const fp = fingerprint(parseMt4Report(STATEMENT, 3));
    const s = suggestV2(fp, 0.1);
    const get = (k: string) => s.find((x) => x.key === k);
    expect(get("TakeProfit")?.value).toBe(0);
    expect(get("FixedLots")?.value).toBe(1);
    expect(get("TrailDistance")?.confidence).toBe("estimated");
    expect(get("SessionStartHHMM")?.value).toBe(930);
    const p = applySuggestions(defaultParams(HFT_SECRET_V2, "US30"), s);
    expect(p.FixedLots).toBe(1);
    expect(p.EntryDistance).toBe(8); // not measurable from a statement — left alone
  });
});

// --- v2 behaviour -----------------------------------------------------------

/** 09:30 NY on Friday 2026-10-16. */
const OPEN = Date.UTC(2026, 9, 16, 13, 30);

function trendTape(dir: 1 | -1): TickSeries {
  // 50 minutes of steady trend from 08:40 NY (so the M1 channel forms), then a burst in the same direction after 09:30.
  const time: number[] = [];
  const bid: number[] = [];
  const ask: number[] = [];
  let px = 46500;
  let t = OPEN - 50 * 60_000;
  while (t < OPEN + 20 * 60_000) {
    const burst = t > OPEN + 2 * 60_000 && t < OPEN + 4 * 60_000;
    px += dir * (burst ? 0.6 : 0.02) + (Math.sin(t / 7000) * 0.3);
    time.push(t);
    bid.push(Math.round(px * 10) / 10);
    ask.push(Math.round((px + 1.5) * 10) / 10);
    t += burst ? 250 : 1000;
  }
  return { symbol: "US30", time: Float64Array.from(time), bid: Float64Array.from(bid), ask: Float64Array.from(ask), source: "demo" };
}

describe("HFT Secret v2", () => {
  it("only works the side the 34-SMA wave allows", () => {
    for (const dir of [1, -1] as const) {
      const eng = new ReplayEngine({ ticks: trendTape(dir), instrument: US30, strategy: HFT_SECRET_V2, params: defaultParams(HFT_SECRET_V2, "US30"), broker: { latencyMs: 0, commissionPerLot: 0 } });
      eng.runToEnd();
      expect(eng.crashed).toBeNull();
      const placed = eng.broker.events.filter((e) => e.kind === "placed");
      expect(placed.length).toBeGreaterThan(0);
      expect(new Set(placed.map((e) => e.type))).toEqual(new Set([dir === 1 ? "buystop" : "sellstop"]));
      const fills = eng.broker.events.filter((e) => e.kind === "filled");
      expect(fills.length).toBeGreaterThan(0);
      expect(fills.every((e) => e.type === (dir === 1 ? "buy" : "sell"))).toBe(true);
    }
  });

  it("moves the stop to breakeven, then trails, on a winning burst", () => {
    const eng = new ReplayEngine({ ticks: trendTape(1), instrument: US30, strategy: HFT_SECRET_V2, params: defaultParams(HFT_SECRET_V2, "US30"), broker: { latencyMs: 0, commissionPerLot: 0 } });
    eng.runToEnd();
    const first = eng.broker.history.find((o) => o.status === "closed")!;
    const mods = eng.broker.events.filter((e) => e.kind === "modified" && e.ticket === first.ticket && e.sl! > first.openPrice);
    expect(mods.length).toBeGreaterThan(1);
    expect(first.profit!).toBeGreaterThan(0);
  });

  it("places nothing before the channel has 34 closed bars", () => {
    const t0 = OPEN;
    const ticks = demoTicks(US30, t0, t0 + 20 * 60_000, 5); // starts AT the open: no history
    const eng = new ReplayEngine({ ticks, instrument: US30, strategy: HFT_SECRET_V2, params: defaultParams(HFT_SECRET_V2, "US30"), broker: { latencyMs: 0 } });
    eng.runToEnd();
    expect(eng.broker.events.filter((e) => e.kind === "placed")).toHaveLength(0);
  });

  it("runs a demo NY open without crashing; filter off behaves like v1 (both sides)", () => {
    const ticks = demoTicks(US30, OPEN - 45 * 60_000, OPEN + 2 * 3_600_000, 9);
    const eng = new ReplayEngine({ ticks, instrument: US30, strategy: HFT_SECRET_V2, params: { ...defaultParams(HFT_SECRET_V2, "US30"), BiasMode: "off" } });
    eng.runToEnd();
    expect(eng.crashed).toBeNull();
    const types = new Set(eng.broker.events.filter((e) => e.kind === "placed").map((e) => e.type));
    expect(types).toEqual(new Set(["buystop", "sellstop"]));
  });
});

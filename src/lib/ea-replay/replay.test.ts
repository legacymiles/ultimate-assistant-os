import { describe, expect, it } from "vitest";
import { detectScale, hourUrl, hoursBetween, parseHour } from "./dukascopy";
import { instrumentById, pointValuePerLot } from "./instruments";
import { inNySession, nyClock, nyToUtc, recentSessionDates, usDstAt } from "./session";
import { buildCandles, decodeTicks, encodeTicks, type TickSeries } from "./types";
import { SimBroker, DEFAULT_BROKER } from "./broker";
import { ReplayEngine } from "./engine";
import { HFT_SECRET } from "./strategies/hftSecret";
import { OPENING_RANGE } from "./strategies/openingRange";
import { defaultParams } from "./strategy";
import { computeStats } from "./stats";
import { parseTickCsv } from "./csv";
import { compileCustom, CUSTOM_TEMPLATE, extractCode } from "./custom";
import { demoTicks } from "./demo";
import { ema, rsi, sma } from "./indicators";

const EURUSD = instrumentById("EURUSD")!;

function series(rows: [number, number, number][]): TickSeries {
  return {
    symbol: "EURUSD",
    time: Float64Array.from(rows.map((r) => r[0])),
    bid: Float64Array.from(rows.map((r) => r[1])),
    ask: Float64Array.from(rows.map((r) => r[2])),
    source: "demo",
  };
}

describe("session (New York time, US DST rule)", () => {
  it("maps 08:00 NY to 12:00 UTC in October and 13:00 UTC in January", () => {
    expect(new Date(nyToUtc("2026-10-16", 800)).toISOString()).toBe("2026-10-16T12:00:00.000Z");
    expect(new Date(nyToUtc("2026-01-15", 800)).toISOString()).toBe("2026-01-15T13:00:00.000Z");
  });
  it("switches on the second Sunday of March and the first Sunday of November", () => {
    expect(usDstAt(Date.UTC(2026, 2, 8, 6, 59))).toBe(false);
    expect(usDstAt(Date.UTC(2026, 2, 8, 7, 0))).toBe(true);
    expect(usDstAt(Date.UTC(2026, 10, 1, 5, 59))).toBe(true);
    expect(usDstAt(Date.UTC(2026, 10, 1, 6, 0))).toBe(false);
  });
  it("reads the NY clock and window", () => {
    const t = Date.UTC(2026, 9, 16, 13, 45);
    expect(nyClock(t)).toEqual({ hhmm: 945, dow: 5, date: "2026-10-16" });
    expect(inNySession(t, 800, 1100)).toBe(true);
    expect(inNySession(Date.UTC(2026, 9, 17, 13, 45), 800, 1100)).toBe(false); // Saturday
  });
  it("lists finished weekday sessions, newest first", () => {
    // Saturday 2026-10-17 midday: Friday's session is done.
    const dates = recentSessionDates(Date.UTC(2026, 9, 17, 16), 3, 1100);
    expect(dates).toEqual(["2026-10-16", "2026-10-15", "2026-10-14"]);
    // Friday 10:00 NY: Friday's 08–11 window is not finished yet.
    expect(recentSessionDates(Date.UTC(2026, 9, 16, 14), 1, 1100)).toEqual(["2026-10-15"]);
  });
});

describe("dukascopy", () => {
  it("builds the URL with a zero-based month", () => {
    expect(hourUrl("EURUSD", Date.UTC(2026, 9, 16, 12))).toBe(
      "https://datafeed.dukascopy.com/datafeed/EURUSD/2026/09/16/12h_ticks.bi5",
    );
    expect(hoursBetween(Date.UTC(2026, 9, 16, 12, 30), Date.UTC(2026, 9, 16, 15))).toHaveLength(3);
  });
  it("decodes 20-byte big-endian records", () => {
    const buf = new Uint8Array(40);
    const v = new DataView(buf.buffer);
    v.setUint32(0, 1500);
    v.setUint32(4, 117012);
    v.setUint32(8, 117010);
    v.setUint32(20, 2600);
    v.setUint32(24, 117015);
    v.setUint32(28, 117013);
    const hour = Date.UTC(2026, 9, 16, 12);
    const ticks = parseHour(buf, hour, 1e5);
    expect(ticks).toEqual([
      { t: hour + 1500, ask: 1.17012, bid: 1.1701 },
      { t: hour + 2600, ask: 1.17015, bid: 1.17013 },
    ]);
    expect(detectScale(buf, EURUSD)).toBe(1e5);
    const gold = instrumentById("XAUUSD")!;
    const g = new Uint8Array(20);
    new DataView(g.buffer).setUint32(8, 4_150_250);
    expect(detectScale(g, gold)).toBe(1e3);
  });
});

describe("tick encoding", () => {
  it("round-trips prices exactly at the broker's point", () => {
    const s = series([
      [1000, 1.17010, 1.17012],
      [1250, 1.17003, 1.17009],
      [1900, 1.17111, 1.17113],
    ]);
    const back = decodeTicks(JSON.parse(JSON.stringify(encodeTicks(s, EURUSD.point))));
    expect(Array.from(back.bid)).toEqual([1.1701, 1.17003, 1.17111]);
    expect(Array.from(back.ask)).toEqual([1.17012, 1.17009, 1.17113]);
    expect(Array.from(back.time)).toEqual([1000, 1250, 1900]);
  });
  it("builds candles from bid", () => {
    const s = series([
      [0, 1.1, 1.1001],
      [30_000, 1.2, 1.2001],
      [61_000, 1.05, 1.0501],
    ]);
    const c = buildCandles(s, 60);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ time: 0, open: 1.1, high: 1.2, close: 1.2, ticks: 2 });
    expect(c[1]).toMatchObject({ time: 60, open: 1.05 });
  });
});

describe("simulated broker", () => {
  const cfg = { ...DEFAULT_BROKER, latencyMs: 0, slippagePts: 2, commissionPerLot: 7, stopLevelPts: 0 };

  it("fills a buy stop at the ask plus slippage and stops out with slippage", () => {
    const b = new SimBroker(EURUSD, cfg);
    b.onTick(0, 1.1, 1.10002);
    b.submit({ kind: "send", ticket: 1, type: "buystop", lots: 1, price: 1.1005, sl: 1.1, tp: 0, comment: "" }, 0);
    b.onTick(10, 1.1, 1.10002);
    expect(b.live.get(1)?.status).toBe("pending");
    b.onTick(20, 1.10049, 1.10051); // ask through the stop
    const o = b.live.get(1)!;
    expect(o.type).toBe("buy");
    expect(o.openPrice).toBeCloseTo(1.10053, 5);
    b.onTick(30, 1.1, 1.10002); // bid touches SL
    expect(b.live.size).toBe(0);
    const closed = b.history[0];
    expect(closed.closeReason).toBe("sl");
    expect(closed.closePrice).toBeCloseTo(1.09998, 5);
    // 55 points × $1 × 1 lot = -55, minus $7 commission
    expect(closed.profit).toBeCloseTo(-62, 2);
    expect(b.balance).toBeCloseTo(10_000 - 62, 2);
  });

  it("rejects a pending inside the stop level with error 130", () => {
    const b = new SimBroker(EURUSD, { ...cfg, stopLevelPts: 50 });
    b.onTick(0, 1.1, 1.10002);
    b.submit({ kind: "send", ticket: 1, type: "buystop", lots: 1, price: 1.1003, sl: 0, tp: 0, comment: "" }, 0);
    b.onTick(1, 1.1, 1.10002);
    expect(b.live.size).toBe(0);
    expect(b.events.at(-1)?.message).toMatch(/^130/);
  });

  it("holds a request for the latency and executes it at the later price", () => {
    const b = new SimBroker(EURUSD, { ...cfg, latencyMs: 100 });
    b.onTick(0, 1.1, 1.10002);
    b.submit({ kind: "send", ticket: 1, type: "buy", lots: 1, price: 0, sl: 0, tp: 0, comment: "" }, 0);
    b.onTick(50, 1.101, 1.10102);
    expect(b.hasInFlight()).toBe(true);
    b.onTick(120, 1.102, 1.10202);
    expect(b.hasInFlight()).toBe(false);
    expect(b.live.get(1)?.openPrice).toBeCloseTo(1.10202, 5);
  });

  it("values JPY points in USD", () => {
    const jpy = instrumentById("USDJPY")!;
    expect(pointValuePerLot(jpy, 150)).toBeCloseTo(100_000 * 0.001 / 150, 6);
    expect(pointValuePerLot(EURUSD, 1.1)).toBeCloseTo(1, 6);
  });
});

/** NY 08:00 on Friday 2026-10-16 = 12:00 UTC. */
const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);

function hftTape(): TickSeries {
  const rows: [number, number, number][] = [];
  let t = T0;
  let bid = 1.17;
  const push = (b: number, spreadPts = 2) => {
    rows.push([t, Math.round(b * 1e5) / 1e5, Math.round((b + spreadPts * 1e-5) * 1e5) / 1e5]);
    t += 200;
  };
  for (let i = 0; i < 50; i++) push(bid); // quiet: pendings get parked
  for (let i = 0; i < 40; i++) push((bid -= 0.00001)); // drift down 40 pts: buy stop dragged
  for (let i = 0; i < 30; i++) push((bid += 0.00005)); // burst up 150 pts: buy stop fills, trail
  for (let i = 0; i < 40; i++) push((bid -= 0.00002)); // pull back: trailed stop hit
  for (let i = 0; i < 20; i++) push(bid);
  return series(rows);
}

describe("HFT Secret rebuild", () => {
  it("parks both stops, drags the buy stop down, fills on the burst, cancels the other side and banks via the trail", () => {
    const params = { ...defaultParams(HFT_SECRET), CooldownSeconds: 0 };
    const eng = new ReplayEngine({
      ticks: hftTape(),
      instrument: EURUSD,
      strategy: HFT_SECRET,
      params,
      broker: { latencyMs: 0, slippagePts: 0, commissionPerLot: 0, balance: 10_000 },
    });
    eng.runToEnd();
    expect(eng.crashed).toBeNull();
    const ev = eng.broker.events;
    const placed = ev.filter((e) => e.kind === "placed");
    expect(placed.slice(0, 2).map((e) => e.type).sort()).toEqual(["buystop", "sellstop"]);
    // after the trade closes (cooldown 0) it goes hunting again
    expect(placed.length).toBe(4);
    expect(ev.some((e) => e.kind === "modified" && e.type === "buystop")).toBe(true);
    const fills = ev.filter((e) => e.kind === "filled");
    expect(fills[0].type).toBe("buy");
    expect(ev.some((e) => e.kind === "deleted" && e.type === "sellstop")).toBe(true);
    const closed = eng.broker.history.filter((o) => o.status === "closed");
    expect(closed[0].closeReason).toBe("sl"); // the trailed stop
    expect(closed[0].profit!).toBeGreaterThan(0);
  });

  it("keeps no orders outside the session or when the spread is wide", () => {
    const outside = series(
      Array.from({ length: 50 }, (_, i) => [T0 - 3_600_000 + i * 200, 1.17, 1.17002] as [number, number, number]),
    );
    const e1 = new ReplayEngine({ ticks: outside, instrument: EURUSD, strategy: HFT_SECRET, params: defaultParams(HFT_SECRET), broker: { latencyMs: 0 } });
    e1.runToEnd();
    expect(e1.broker.events.filter((e) => e.kind === "placed")).toHaveLength(0);

    const wide = series(Array.from({ length: 50 }, (_, i) => [T0 + i * 200, 1.17, 1.1704] as [number, number, number]));
    const e2 = new ReplayEngine({ ticks: wide, instrument: EURUSD, strategy: HFT_SECRET, params: defaultParams(HFT_SECRET), broker: { latencyMs: 0 } });
    e2.runToEnd();
    expect(e2.broker.events.filter((e) => e.kind === "placed")).toHaveLength(0);
  });

  it("applies per-instrument presets", () => {
    expect(defaultParams(HFT_SECRET, "XAUUSD").EntryDistance).toBe(150);
    expect(defaultParams(HFT_SECRET, "EURUSD").EntryDistance).toBe(60);
  });

  it("runs a full demo NY session without crashing and produces stats", () => {
    const ticks = demoTicks(EURUSD, T0, T0 + 3 * 3_600_000, 11);
    const eng = new ReplayEngine({ ticks, instrument: EURUSD, strategy: HFT_SECRET, params: defaultParams(HFT_SECRET) });
    eng.runToEnd();
    expect(eng.crashed).toBeNull();
    const s = computeStats(eng.broker.history, eng.equity, 10_000, EURUSD.point);
    expect(s.trades).toBeGreaterThan(0);
    expect(s.trades).toBe(s.wins + s.losses);
    expect(eng.broker.live.size).toBe(0);
  });
});

describe("opening range bot", () => {
  it("trades one breakout after the range", () => {
    const rows: [number, number, number][] = [];
    const open = Date.UTC(2026, 9, 16, 13, 30); // 09:30 NY
    for (let i = 0; i < 15 * 60; i += 5) rows.push([open + i * 1000, 1.17 + (i % 20) * 1e-5, 1.17 + (i % 20) * 1e-5 + 2e-5]);
    let px = 1.1702;
    for (let i = 0; i < 300; i++) {
      px += 1e-5;
      rows.push([open + 15 * 60_000 + i * 1000, px, px + 2e-5]);
    }
    const eng = new ReplayEngine({ ticks: series(rows), instrument: EURUSD, strategy: OPENING_RANGE, params: defaultParams(OPENING_RANGE), broker: { latencyMs: 0 } });
    eng.runToEnd();
    const fills = eng.broker.events.filter((e) => e.kind === "filled");
    expect(fills).toHaveLength(1);
    expect(fills[0].type).toBe("buy");
  });
});

describe("csv import", () => {
  it("reads a Dukascopy export", () => {
    const r = parseTickCsv("Time (UTC),Ask,Bid,AskVolume,BidVolume\n16.10.2026 12:00:00.123,1.17012,1.17010,1,1\n16.10.2026 12:00:00.500,1.17015,1.17013,1,1", "EURUSD");
    expect(r.layout).toBe("dukascopy");
    expect(r.series.time[0]).toBe(Date.UTC(2026, 9, 16, 12, 0, 0, 123));
    expect(r.series.bid[1]).toBe(1.17013);
  });
  it("reads an MT5 export in server time and fills blank sides", () => {
    const r = parseTickCsv("<DATE>\t<TIME>\t<BID>\t<ASK>\t<LAST>\t<VOLUME>\t<FLAGS>\n2026.10.16\t15:00:00.100\t1.17010\t1.17012\t\t\t6\n2026.10.16\t15:00:00.300\t1.17011\t\t\t\t2", "EURUSD", 3);
    expect(r.layout).toBe("mt5");
    expect(r.series.time[0]).toBe(Date.UTC(2026, 9, 16, 12, 0, 0, 100));
    expect(r.series.ask[1]).toBe(1.17012);
  });
  it("reads a plain time,bid,ask file", () => {
    const r = parseTickCsv("timestamp,bid,ask\n2026-10-16T12:00:00Z,1.1,1.1002\n1792152001000,1.1001,1.1003", "EURUSD");
    expect(r.layout).toBe("plain");
    expect(r.series.time.length).toBe(2);
  });
});

describe("custom bots", () => {
  it("compiles the template and runs it", () => {
    const def = compileCustom({ id: "c1", name: "t", source: CUSTOM_TEMPLATE, from: "hand", createdAt: 0 });
    expect(def.params.map((p) => p.key)).toContain("Lots");
    const ticks = demoTicks(EURUSD, T0, T0 + 3_600_000, 3);
    const eng = new ReplayEngine({ ticks, instrument: EURUSD, strategy: def, params: defaultParams(def) });
    eng.runToEnd();
    expect(eng.crashed).toBeNull();
  });
  it("explains broken code", () => {
    expect(() => compileCustom({ id: "x", name: "x", source: "({ name: 'x' })", from: "hand", createdAt: 0 })).toThrow(/create/);
    expect(() => compileCustom({ id: "x", name: "x", source: "({ oops", from: "hand", createdAt: 0 })).toThrow(/parse/);
  });
  it("pulls code out of a fenced reply", () => {
    expect(extractCode("Here:\n```js\n({a:1})\n```\nDone")).toBe("({a:1})");
  });
});

describe("indicators", () => {
  it("computes sma/ema/rsi with MT4 shift semantics", () => {
    const v = [1, 2, 3, 4, 5];
    expect(sma(v, 3)).toBe(4);
    expect(sma(v, 3, 1)).toBe(3);
    expect(Number.isNaN(sma(v, 6))).toBe(true);
    expect(ema([2, 2, 2, 2], 3)).toBe(2);
    expect(rsi([1, 2, 3, 4, 5, 6], 3)).toBe(100);
  });
});

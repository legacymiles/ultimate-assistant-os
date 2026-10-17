// ---------------------------------------------------------------------------
// EA World › Replay — the engine that walks a bot through real ticks.
//
// One loop, used two ways: the visual replay calls `advanceTo(time)` every
// animation frame (so 1x is real time and 300x is five minutes a second), and
// "Run to end" calls `runToEnd()` with no drawing at all. Both see exactly the
// same ticks in the same order, so what you watch is what the stats count.
// ---------------------------------------------------------------------------

import { DEFAULT_BROKER, SimBroker, type BrokerConfig, type OrderType } from "./broker";
import { type Instrument, normalize, pointValuePerLot } from "./instruments";
import { INDICATORS } from "./indicators";
import { inNySession, nyClock, type NyClock } from "./session";
import type { OrderView, Params, StrategyContext, StrategyDef, StrategyInstance } from "./strategy";
import type { Candle, TickSeries } from "./types";

class Aggregator {
  readonly candles: Candle[] = [];
  constructor(readonly tfSec: number) {}
  feed(tMs: number, px: number): void {
    const bucket = Math.floor(tMs / (this.tfSec * 1000)) * this.tfSec;
    const last = this.candles[this.candles.length - 1];
    if (!last || last.time !== bucket) {
      this.candles.push({ time: bucket, open: px, high: px, low: px, close: px, ticks: 1 });
    } else {
      if (px > last.high) last.high = px;
      if (px < last.low) last.low = px;
      last.close = px;
      last.ticks++;
    }
  }
}

export interface EquityPoint {
  /** Epoch seconds. */
  time: number;
  equity: number;
  balance: number;
}

export interface LogLine {
  time: number;
  text: string;
}

export interface EngineSetup {
  ticks: TickSeries;
  instrument: Instrument;
  strategy: StrategyDef;
  params: Params;
  broker?: Partial<BrokerConfig>;
}

const view = (o: OrderView): OrderView => ({ ...o });

export class ReplayEngine {
  readonly ticks: TickSeries;
  readonly inst: Instrument;
  readonly broker: SimBroker;
  readonly def: StrategyDef;
  readonly params: Params;
  readonly equity: EquityPoint[] = [];
  readonly logs: LogLine[] = [];
  /** Index of the next tick to process. */
  cursor = 0;
  /** Set when the bot threw; the replay keeps running prices but the bot is stopped. */
  crashed: string | null = null;
  finished = false;
  /** Ticks on which the bot's OnTick actually ran (it is skipped while a request is in flight). */
  botTicks = 0;

  private bot: StrategyInstance | null = null;
  private aggs = new Map<number, Aggregator>();
  private state: Record<string, unknown> = {};
  private ctx: StrategyContext;
  private lastEquitySec = -1;
  private nyCache = { minute: -1, clock: null as NyClock | null };

  constructor(setup: EngineSetup) {
    this.ticks = setup.ticks;
    this.inst = setup.instrument;
    this.def = setup.strategy;
    this.params = setup.params;
    this.broker = new SimBroker(this.inst, { ...DEFAULT_BROKER, ...setup.broker });
    this.ctx = this.makeContext();
    try {
      this.bot = this.def.create(this.params);
    } catch (e) {
      this.crashed = `create() failed: ${errText(e)}`;
    }
  }

  get time(): number {
    const i = Math.min(this.cursor, this.ticks.time.length) - 1;
    return i >= 0 ? this.ticks.time[i] : this.ticks.time[0] ?? 0;
  }

  get done(): boolean {
    return this.cursor >= this.ticks.time.length;
  }

  /** Process every tick with time <= tMs. */
  advanceTo(tMs: number): void {
    const n = this.ticks.time.length;
    while (this.cursor < n && this.ticks.time[this.cursor] <= tMs) this.step();
    if (this.done) this.finish();
  }

  /** Process exactly `count` ticks. */
  advanceTicks(count: number): void {
    for (let k = 0; k < count && !this.done; k++) this.step();
    if (this.done) this.finish();
  }

  runToEnd(): void {
    while (!this.done) this.step();
    this.finish();
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.broker.closeAll("end");
    this.sampleEquity(true);
  }

  private step(): void {
    const i = this.cursor++;
    const t = this.ticks.time[i];
    const bid = this.ticks.bid[i];
    const ask = this.ticks.ask[i];
    this.broker.onTick(t, bid, ask);
    for (const a of this.aggs.values()) a.feed(t, bid);

    if (this.bot && !this.crashed && !this.broker.hasInFlight() && !this.broker.stoppedOut) {
      try {
        if (this.botTicks === 0) this.bot.onInit?.(this.ctx);
        this.botTicks++;
        this.bot.onTick(this.ctx);
      } catch (e) {
        this.crashed = errText(e);
        this.logs.push({ time: t, text: `Bot stopped: ${this.crashed}` });
      }
    }
    this.sampleEquity(false);
  }

  private sampleEquity(force: boolean): void {
    const sec = Math.floor(this.time / 1000);
    if (!force && sec === this.lastEquitySec) return;
    this.lastEquitySec = sec;
    const point = { time: sec, equity: round2(this.broker.equity()), balance: round2(this.broker.balance) };
    const last = this.equity[this.equity.length - 1];
    if (last && last.time === sec) this.equity[this.equity.length - 1] = point;
    else this.equity.push(point);
  }

  private aggregator(tfSec: number): Aggregator {
    let a = this.aggs.get(tfSec);
    if (!a) {
      // A bot asking for M5 for the first time gets M5 built from everything seen so far.
      a = new Aggregator(tfSec);
      for (let i = 0; i < this.cursor; i++) a.feed(this.ticks.time[i], this.ticks.bid[i]);
      this.aggs.set(tfSec, a);
    }
    return a;
  }

  private nyNow(): NyClock {
    const minute = Math.floor(this.time / 60_000);
    if (this.nyCache.minute !== minute || !this.nyCache.clock) {
      this.nyCache = { minute, clock: nyClock(this.time) };
    }
    return this.nyCache.clock!;
  }

  private makeContext(): StrategyContext {
    const eng = this;
    const b = this.broker;
    const inst = this.inst;
    const send = (type: OrderType, lots: number, price: number, sl = 0, tp = 0, comment = ""): number => {
      if (!(lots > 0) || !Number.isFinite(price)) return -1;
      const ticket = b.allocateTicket();
      b.submit({ kind: "send", ticket, type, lots: Math.round(lots * 100) / 100, price, sl, tp, comment }, b.time);
      return ticket;
    };
    const ctx: StrategyContext = {
      Symbol: inst.id,
      Point: inst.point,
      Digits: inst.digits,
      get Bid() { return b.bid; },
      get Ask() { return b.ask; },
      get Time() { return b.time; },
      get spreadPoints() { return Math.round((b.ask - b.bid) / inst.point); },
      stopLevelPoints: b.cfg.stopLevelPts,
      get ny() { return eng.nyNow(); },
      inSession: (s, e) => inNySession(b.time, s, e, !!inst.weekends),
      AccountBalance: () => b.balance,
      AccountEquity: () => b.equity(),
      AccountFreeMargin: () => b.freeMargin(),
      pointValuePerLot: () => pointValuePerLot(inst, b.bid),
      orders: () => [...b.live.values()].map(view),
      positions: () => [...b.live.values()].filter((o) => o.status === "open").map(view),
      pendings: () => [...b.live.values()].filter((o) => o.status === "pending").map(view),
      history: () => b.history.filter((o) => o.status === "closed").map(view),
      OrderSend: send,
      OrderModify: (ticket, price, sl, tp) => {
        if (!b.live.has(ticket)) return false;
        b.submit({ kind: "modify", ticket, price, sl, tp }, b.time);
        return true;
      },
      OrderDelete: (ticket) => {
        if (!b.live.has(ticket)) return false;
        b.submit({ kind: "delete", ticket }, b.time);
        return true;
      },
      OrderClose: (ticket) => {
        if (!b.live.has(ticket)) return false;
        b.submit({ kind: "close", ticket }, b.time);
        return true;
      },
      NormalizeDouble: (p) => normalize(inst, p),
      candles: (tf, count) => {
        const c = eng.aggregator(tf).candles;
        return count ? c.slice(-count) : c.slice();
      },
      closes: (tf, count) => {
        const c = eng.aggregator(tf).candles;
        return (count ? c.slice(-count) : c).map((x) => x.close);
      },
      ind: INDICATORS,
      state: this.state,
      log: (text) => {
        if (eng.logs.length < 5000) eng.logs.push({ time: b.time, text: String(text) });
      },
      OP_BUY: "buy",
      OP_SELL: "sell",
      OP_BUYSTOP: "buystop",
      OP_SELLSTOP: "sellstop",
      OP_BUYLIMIT: "buylimit",
      OP_SELLLIMIT: "selllimit",
    };
    return ctx;
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

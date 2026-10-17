// ---------------------------------------------------------------------------
// EA World › Replay — a simulated MT4 broker.
//
// An HFT EA lives or dies on execution details that a candle backtest erases,
// so this broker models the ones that matter and nothing else:
//
//  - REAL SPREAD. Buys fill at the ask, sells at the bid, from the tick data.
//  - LATENCY. A request leaves the EA, arrives `latencyMs` later, and executes
//    at THAT tick's prices — and, exactly like OrderSend in MT4, the EA does not
//    see another tick until its requests are answered.
//  - STOP SLIPPAGE. Stop entries and stop losses become market orders when
//    triggered, so they fill at the next price plus `slippagePts` against you.
//    Take profits are limits and do not slip.
//  - STOP LEVEL. Pendings and stops closer than the broker's minimum are
//    rejected with MT4's error 130, the most common reason a live HFT EA
//    "does nothing".
//  - COMMISSION per lot, round turn, which on an ECN account is often larger
//    than the average HFT win.
//  - MARGIN and a 50% stop-out.
// ---------------------------------------------------------------------------

import { type Instrument, marginFor, normalize, pointValuePerLot } from "./instruments";

export type OrderType = "buy" | "sell" | "buystop" | "sellstop" | "buylimit" | "selllimit";

export function isBuySide(t: OrderType): boolean {
  return t === "buy" || t === "buystop" || t === "buylimit";
}
export function isPendingType(t: OrderType): boolean {
  return t !== "buy" && t !== "sell";
}

export type CloseReason = "sl" | "tp" | "close" | "stopout" | "end";

export interface SimOrder {
  ticket: number;
  /** For a filled pending this becomes "buy"/"sell"; `pendingType` keeps what it was. */
  type: OrderType;
  pendingType?: OrderType;
  lots: number;
  openPrice: number;
  sl: number;
  tp: number;
  comment: string;
  status: "pending" | "open" | "closed" | "deleted";
  placedAt: number;
  openTime: number | null;
  closeTime?: number;
  closePrice?: number;
  closeReason?: CloseReason;
  /** Net of commission, in account currency. */
  profit?: number;
  commission: number;
  /** Most adverse / favourable excursion while open, in points. */
  maePts: number;
  mfePts: number;
}

export interface BrokerConfig {
  balance: number;
  leverage: number;
  /** USD per 1.00 lot, round turn. */
  commissionPerLot: number;
  /** Extra points against you on stop-triggered fills. */
  slippagePts: number;
  latencyMs: number;
  /** MT4 MODE_STOPLEVEL in points. */
  stopLevelPts: number;
}

export const DEFAULT_BROKER: BrokerConfig = {
  balance: 10_000,
  leverage: 500,
  commissionPerLot: 7,
  slippagePts: 2,
  latencyMs: 60,
  stopLevelPts: 0,
};

export type Request =
  | { kind: "send"; ticket: number; type: OrderType; lots: number; price: number; sl: number; tp: number; comment: string }
  | { kind: "modify"; ticket: number; price: number; sl: number; tp: number }
  | { kind: "delete"; ticket: number }
  | { kind: "close"; ticket: number };

export type EventKind = "placed" | "modified" | "deleted" | "filled" | "closed" | "rejected" | "stopout";

export interface BrokerEvent {
  time: number;
  kind: EventKind;
  ticket: number;
  type?: OrderType;
  price?: number;
  sl?: number;
  tp?: number;
  lots?: number;
  profit?: number;
  reason?: CloseReason;
  message?: string;
}

interface Queued {
  at: number;
  req: Request;
}

export class SimBroker {
  readonly inst: Instrument;
  readonly cfg: BrokerConfig;
  balance: number;
  /** Pending and open orders. */
  readonly live = new Map<number, SimOrder>();
  readonly history: SimOrder[] = [];
  readonly events: BrokerEvent[] = [];
  private queue: Queued[] = [];
  private nextTicket = 1;
  /** Latest prices seen. */
  bid = 0;
  ask = 0;
  time = 0;
  stoppedOut = false;

  constructor(inst: Instrument, cfg: BrokerConfig) {
    this.inst = inst;
    this.cfg = cfg;
    this.balance = cfg.balance;
  }

  allocateTicket(): number {
    return this.nextTicket++;
  }

  submit(req: Request, now: number): void {
    this.queue.push({ at: now + Math.max(0, this.cfg.latencyMs), req });
  }

  hasInFlight(): boolean {
    return this.queue.length > 0;
  }

  /** Advance to a new tick: answer due requests, then trigger pendings and stops. */
  onTick(time: number, bid: number, ask: number): void {
    this.time = time;
    this.bid = bid;
    this.ask = ask;

    if (this.queue.length) {
      const due: Queued[] = [];
      const later: Queued[] = [];
      for (const q of this.queue) (q.at <= time ? due : later).push(q);
      this.queue = later;
      for (const q of due) this.execute(q.req);
    }

    const pt = this.inst.point;
    for (const o of this.live.values()) {
      if (o.status === "pending") {
        const hit =
          (o.type === "buystop" && ask >= o.openPrice) ||
          (o.type === "sellstop" && bid <= o.openPrice) ||
          (o.type === "buylimit" && ask <= o.openPrice) ||
          (o.type === "selllimit" && bid >= o.openPrice);
        if (!hit) continue;
        const slip = (o.type === "buystop" || o.type === "sellstop") ? this.cfg.slippagePts * pt : 0;
        const buy = isBuySide(o.type);
        const px = normalize(this.inst, buy ? ask + slip : bid - slip);
        if (!this.hasMarginFor(o.lots, px)) {
          this.live.delete(o.ticket);
          o.status = "deleted";
          this.history.push(o);
          this.events.push({ time, kind: "rejected", ticket: o.ticket, type: o.type, message: "134 not enough money — pending cancelled on trigger" });
          continue;
        }
        o.pendingType = o.type;
        o.type = buy ? "buy" : "sell";
        o.openPrice = px;
        o.openTime = time;
        o.status = "open";
        this.events.push({ time, kind: "filled", ticket: o.ticket, type: o.type, price: px, lots: o.lots, sl: o.sl, tp: o.tp });
        continue; // stops are checked from the next tick, as MT4 does
      }

      if (o.status !== "open" || o.openTime === time) continue;
      const buy = o.type === "buy";
      const mark = buy ? bid : ask;
      const movePts = ((mark - o.openPrice) / pt) * (buy ? 1 : -1);
      if (movePts < o.maePts) o.maePts = movePts;
      if (movePts > o.mfePts) o.mfePts = movePts;

      if (o.sl > 0 && (buy ? bid <= o.sl : ask >= o.sl)) {
        const slip = this.cfg.slippagePts * pt;
        this.closeOrder(o, normalize(this.inst, buy ? bid - slip : ask + slip), "sl");
      } else if (o.tp > 0 && (buy ? bid >= o.tp : ask <= o.tp)) {
        this.closeOrder(o, buy ? bid : ask, "tp");
      }
    }

    if (!this.stoppedOut && this.marginUsed() > 0 && this.marginLevel() < 50) {
      this.stoppedOut = true;
      this.events.push({ time, kind: "stopout", ticket: 0, message: `Margin level ${this.marginLevel().toFixed(0)}% — stop-out, everything closed` });
      for (const o of [...this.live.values()]) {
        if (o.status === "open") this.closeOrder(o, o.type === "buy" ? bid : ask, "stopout");
      }
    }
  }

  private reject(req: Request, message: string, type?: OrderType): void {
    this.events.push({ time: this.time, kind: "rejected", ticket: req.ticket, type, message });
  }

  private stopsOk(buy: boolean, ref: number, sl: number, tp: number): string | null {
    const min = this.cfg.stopLevelPts * this.inst.point;
    if (sl > 0 && (buy ? sl > ref - min || sl >= ref : sl < ref + min || sl <= ref)) return "130 invalid stops (SL too close or wrong side)";
    if (tp > 0 && (buy ? tp < ref + min || tp <= ref : tp > ref - min || tp >= ref)) return "130 invalid stops (TP too close or wrong side)";
    return null;
  }

  private pendingPriceOk(type: OrderType, price: number): string | null {
    const min = this.cfg.stopLevelPts * this.inst.point;
    const { bid, ask } = this;
    const ok =
      (type === "buystop" && price > ask && price - ask >= min) ||
      (type === "sellstop" && price < bid && bid - price >= min) ||
      (type === "buylimit" && price < ask && ask - price >= min) ||
      (type === "selllimit" && price > bid && price - bid >= min);
    return ok ? null : "130 invalid price (pending too close to market or wrong side)";
  }

  private execute(req: Request): void {
    const inst = this.inst;
    if (req.kind === "send") {
      const { type, lots } = req;
      if (!(lots > 0)) return this.reject(req, "131 invalid volume", type);
      const sl = req.sl > 0 ? normalize(inst, req.sl) : 0;
      const tp = req.tp > 0 ? normalize(inst, req.tp) : 0;
      if (isPendingType(type)) {
        const price = normalize(inst, req.price);
        const bad = this.pendingPriceOk(type, price) ?? this.stopsOk(isBuySide(type), price, sl, tp);
        if (bad) return this.reject(req, bad, type);
        const o = this.makeOrder(req.ticket, type, lots, price, sl, tp, req.comment, "pending");
        this.live.set(o.ticket, o);
        this.events.push({ time: this.time, kind: "placed", ticket: o.ticket, type, price, sl, tp, lots });
        return;
      }
      const buy = type === "buy";
      const px = buy ? this.ask : this.bid;
      const bad = this.stopsOk(buy, buy ? this.bid : this.ask, sl, tp);
      if (bad) return this.reject(req, bad, type);
      if (!this.hasMarginFor(lots, px)) return this.reject(req, "134 not enough money", type);
      const o = this.makeOrder(req.ticket, type, lots, px, sl, tp, req.comment, "open");
      o.openTime = this.time;
      this.live.set(o.ticket, o);
      this.events.push({ time: this.time, kind: "filled", ticket: o.ticket, type, price: px, lots, sl, tp });
      return;
    }

    const o = this.live.get(req.ticket);
    if (!o) return this.reject(req, "4108 invalid ticket (already filled, closed or deleted)");

    if (req.kind === "modify") {
      const sl = req.sl > 0 ? normalize(inst, req.sl) : 0;
      const tp = req.tp > 0 ? normalize(inst, req.tp) : 0;
      if (o.status === "pending") {
        const price = normalize(inst, req.price);
        if (price === o.openPrice && sl === o.sl && tp === o.tp) return; // MT4 error 1: nothing to do
        const bad = this.pendingPriceOk(o.type, price) ?? this.stopsOk(isBuySide(o.type), price, sl, tp);
        if (bad) return this.reject(req, bad, o.type);
        o.openPrice = price;
      } else {
        if (sl === o.sl && tp === o.tp) return;
        const buy = o.type === "buy";
        const bad = this.stopsOk(buy, buy ? this.bid : this.ask, sl, tp);
        if (bad) return this.reject(req, bad, o.type);
      }
      o.sl = sl;
      o.tp = tp;
      this.events.push({ time: this.time, kind: "modified", ticket: o.ticket, type: o.type, price: o.openPrice, sl, tp });
      return;
    }

    if (req.kind === "delete") {
      if (o.status !== "pending") return this.reject(req, "4108 cannot delete an open position", o.type);
      this.live.delete(o.ticket);
      o.status = "deleted";
      o.closeTime = this.time;
      this.history.push(o);
      this.events.push({ time: this.time, kind: "deleted", ticket: o.ticket, type: o.type, price: o.openPrice });
      return;
    }

    if (req.kind === "close") {
      if (o.status !== "open") return this.reject(req, "4108 close needs an open position", o.type);
      this.closeOrder(o, o.type === "buy" ? this.bid : this.ask, "close");
    }
  }

  private makeOrder(ticket: number, type: OrderType, lots: number, price: number, sl: number, tp: number, comment: string, status: SimOrder["status"]): SimOrder {
    return { ticket, type, lots, openPrice: price, sl, tp, comment, status, placedAt: this.time, openTime: null, commission: 0, maePts: 0, mfePts: 0 };
  }

  private grossPnl(o: SimOrder, exit: number): number {
    const dir = o.type === "buy" ? 1 : -1;
    const pts = ((exit - o.openPrice) / this.inst.point) * dir;
    return pts * pointValuePerLot(this.inst, exit) * o.lots;
  }

  private closeOrder(o: SimOrder, price: number, reason: CloseReason): void {
    const px = normalize(this.inst, price);
    const commission = this.cfg.commissionPerLot * o.lots;
    const profit = this.grossPnl(o, px) - commission;
    o.status = "closed";
    o.closePrice = px;
    o.closeTime = this.time;
    o.closeReason = reason;
    o.commission = commission;
    o.profit = Math.round(profit * 100) / 100;
    this.balance += o.profit;
    this.live.delete(o.ticket);
    this.history.push(o);
    this.events.push({ time: this.time, kind: "closed", ticket: o.ticket, type: o.type, price: px, profit: o.profit, reason });
  }

  /** Close every position and cancel every pending — the end of a replay. */
  closeAll(reason: CloseReason = "end"): void {
    for (const o of [...this.live.values()]) {
      if (o.status === "open") this.closeOrder(o, o.type === "buy" ? this.bid : this.ask, reason);
      else {
        this.live.delete(o.ticket);
        o.status = "deleted";
        o.closeTime = this.time;
        this.history.push(o);
      }
    }
    this.queue = [];
  }

  floating(): number {
    let f = 0;
    for (const o of this.live.values()) {
      if (o.status !== "open") continue;
      f += this.grossPnl(o, o.type === "buy" ? this.bid : this.ask) - this.cfg.commissionPerLot * o.lots;
    }
    return f;
  }

  equity(): number {
    return this.balance + this.floating();
  }

  marginUsed(): number {
    let m = 0;
    for (const o of this.live.values()) if (o.status === "open") m += marginFor(this.inst, o.lots, o.openPrice, this.cfg.leverage);
    return m;
  }

  marginLevel(): number {
    const used = this.marginUsed();
    return used > 0 ? (this.equity() / used) * 100 : Infinity;
  }

  freeMargin(): number {
    return this.equity() - this.marginUsed();
  }

  private hasMarginFor(lots: number, price: number): boolean {
    return this.freeMargin() >= marginFor(this.inst, lots, price, this.cfg.leverage);
  }
}

// ---------------------------------------------------------------------------
// HFT Secret v2 — the replay twin of public/ea-world/experts/HFT_Secret_v2.mq4.
//
// v2 is v1's HFT engine steered by the one rule every public listing of the
// original gives: a 34-period SMA channel on the M1 highs and lows, longs
// above it and shorts below it, on US30. Distances are in PRICE (index points
// on US30), not broker points, so the same inputs work at a 1-digit and a
// 2-digit broker.
//
// Keep this and the .mq4 in step: same inputs, same order of decisions. The
// comments name the matching MQL4 function.
// ---------------------------------------------------------------------------

import type { OrderType } from "../broker";
import { bool, num, str, type Params, type StrategyContext, type StrategyDef } from "../strategy";

/** Price-unit presets. US30 is the default because it is what the original was sold for. */
const fx = (pip: number): Params => ({
  EntryDistance: 6 * pip, ReplaceStep: pip, MaxSpread: 2 * pip, StopLoss: 10 * pip, BreakEvenAt: 3 * pip, BreakEvenLock: 0.5 * pip,
  TrailStart: 3 * pip, TrailDistance: 2.5 * pip, TrailStep: 0.5 * pip, FixedLots: 0.1,
});

export const HFT_SECRET_V2: StrategyDef = {
  id: "hft-secret-v2",
  name: "HFT Secret v2 (wave + HFT)",
  summary:
    "The original's published rule — a 34-SMA channel on M1 highs and lows, longs above it, shorts below it — choosing the side, " +
    "and v1's HFT engine doing the work: one stop order dragged after price, breakeven, tight trailing stop. US30 defaults, distances in price.",
  origin: "builtin",
  mq4: "/ea-world/experts/HFT_Secret_v2.mq4",
  suggestedSession: "ny-open",
  params: [
    { key: "LotMode", label: "Lot mode", type: "select", default: "fixed", group: "Money", options: [{ value: "fixed", label: "Fixed lots" }, { value: "risk", label: "Risk % of equity" }] },
    { key: "FixedLots", label: "Fixed lots", type: "number", default: 1, min: 0.01, step: 0.01, group: "Money" },
    { key: "RiskPercent", label: "Risk % per trade", type: "number", default: 0.5, min: 0.1, step: 0.1, group: "Money" },
    { key: "MaxLots", label: "Lot ceiling", type: "number", default: 5, min: 0.01, step: 0.01, group: "Money" },
    { key: "BiasMode", label: "Wave filter", type: "select", default: "wave", group: "Wave", options: [
      { value: "wave", label: "Wave: above SMA(high) buy, below SMA(low) sell" },
      { value: "cross", label: "Cross: up through SMA(low) buy, down through SMA(high) sell" },
      { value: "off", label: "Off: both sides (v1)" },
    ] },
    { key: "BiasTfSec", label: "Channel timeframe (s)", type: "int", default: 60, min: 5, group: "Wave", hint: "60 = M1, as the original" },
    { key: "MaPeriod", label: "Channel period", type: "int", default: 34, min: 2, group: "Wave" },
    { key: "MaMethod", label: "Channel average", type: "select", default: "sma", group: "Wave", options: [{ value: "sma", label: "SMA" }, { value: "ema", label: "EMA" }] },
    { key: "Direction", label: "Allowed sides", type: "select", default: "both", group: "Wave", options: [{ value: "both", label: "Both" }, { value: "buy", label: "Buy only" }, { value: "sell", label: "Sell only" }] },
    { key: "EntryDistance", label: "Entry distance (price)", type: "number", default: 8, min: 0, step: 0.1, group: "Entry" },
    { key: "ReplaceStep", label: "Drag step (price)", type: "number", default: 1, min: 0, step: 0.1, group: "Entry" },
    { key: "MaxSpread", label: "Max spread (price)", type: "number", default: 4, min: 0, step: 0.1, group: "Entry" },
    { key: "DeleteOppositeOnFill", label: "OCO — cancel other side on fill", type: "bool", default: true, group: "Entry" },
    { key: "StopLoss", label: "Stop loss (price)", type: "number", default: 25, min: 0, step: 0.5, group: "Exit" },
    { key: "TakeProfit", label: "Take profit (price, 0 = trail)", type: "number", default: 0, min: 0, step: 0.5, group: "Exit" },
    { key: "BreakEvenAt", label: "Breakeven at (price, 0 = off)", type: "number", default: 5, min: 0, step: 0.5, group: "Exit" },
    { key: "BreakEvenLock", label: "Breakeven lock (price)", type: "number", default: 0.5, min: 0, step: 0.1, group: "Exit" },
    { key: "TrailStart", label: "Trail starts at (price)", type: "number", default: 7, min: 0, step: 0.5, group: "Exit" },
    { key: "TrailDistance", label: "Trail distance (price)", type: "number", default: 5, min: 0, step: 0.5, group: "Exit" },
    { key: "TrailStep", label: "Trail step (price)", type: "number", default: 0.5, min: 0, step: 0.1, group: "Exit" },
    { key: "UseSession", label: "Only trade in session", type: "bool", default: true, group: "Session" },
    { key: "SessionStartHHMM", label: "Start (NY, HHMM)", type: "int", default: 930, min: 0, max: 2359, group: "Session" },
    { key: "SessionEndHHMM", label: "End (NY, HHMM)", type: "int", default: 1130, min: 0, max: 2359, group: "Session" },
    { key: "CloseAtSessionEnd", label: "Flatten at session end", type: "bool", default: true, group: "Session" },
    { key: "MaxTradesPerDay", label: "Max fills per day", type: "int", default: 40, min: 0, group: "Protection" },
    { key: "MaxDailyLossPct", label: "Max daily loss %", type: "number", default: 2, min: 0, step: 0.5, group: "Protection" },
    { key: "DailyTargetPct", label: "Daily target % (0 = off)", type: "number", default: 0, min: 0, step: 0.5, group: "Protection" },
    { key: "CooldownSeconds", label: "Cooldown after close (s)", type: "int", default: 10, min: 0, group: "Protection" },
  ],
  presets: {
    US30: {},
    NAS100: { EntryDistance: 6, ReplaceStep: 1, MaxSpread: 3, StopLoss: 20, BreakEvenAt: 4, BreakEvenLock: 0.5, TrailStart: 5, TrailDistance: 4, TrailStep: 0.5 },
    SPX500: { EntryDistance: 1.5, ReplaceStep: 0.25, MaxSpread: 1, StopLoss: 5, BreakEvenAt: 1, BreakEvenLock: 0.1, TrailStart: 1.2, TrailDistance: 1, TrailStep: 0.1 },
    XAUUSD: { EntryDistance: 1.5, ReplaceStep: 0.2, MaxSpread: 0.6, StopLoss: 4, BreakEvenAt: 0.8, BreakEvenLock: 0.1, TrailStart: 1, TrailDistance: 0.8, TrailStep: 0.1, FixedLots: 0.1 },
    EURUSD: fx(0.0001),
    GBPUSD: fx(0.0001),
    AUDUSD: fx(0.0001),
    USDJPY: fx(0.01),
    BTCUSD: { EntryDistance: 40, ReplaceStep: 5, MaxSpread: 30, StopLoss: 80, BreakEvenAt: 20, BreakEvenLock: 2, TrailStart: 25, TrailDistance: 20, TrailStep: 3, FixedLots: 0.1 },
  },

  create(p) {
    const P = {
      LotMode: str(p, "LotMode", "fixed"),
      FixedLots: num(p, "FixedLots", 1),
      RiskPercent: num(p, "RiskPercent", 0.5),
      MaxLots: num(p, "MaxLots", 5),
      BiasMode: str(p, "BiasMode", "wave"),
      BiasTfSec: Math.max(5, num(p, "BiasTfSec", 60)),
      MaPeriod: Math.max(2, Math.round(num(p, "MaPeriod", 34))),
      MaMethod: str(p, "MaMethod", "sma"),
      Direction: str(p, "Direction", "both"),
      EntryDistance: num(p, "EntryDistance", 8),
      ReplaceStep: num(p, "ReplaceStep", 1),
      MaxSpread: num(p, "MaxSpread", 4),
      DeleteOppositeOnFill: bool(p, "DeleteOppositeOnFill", true),
      StopLoss: num(p, "StopLoss", 25),
      TakeProfit: num(p, "TakeProfit", 0),
      BreakEvenAt: num(p, "BreakEvenAt", 5),
      BreakEvenLock: num(p, "BreakEvenLock", 0.5),
      TrailStart: num(p, "TrailStart", 7),
      TrailDistance: num(p, "TrailDistance", 5),
      TrailStep: num(p, "TrailStep", 0.5),
      UseSession: bool(p, "UseSession", true),
      SessionStartHHMM: num(p, "SessionStartHHMM", 930),
      SessionEndHHMM: num(p, "SessionEndHHMM", 1130),
      CloseAtSessionEnd: bool(p, "CloseAtSessionEnd", true),
      MaxTradesPerDay: num(p, "MaxTradesPerDay", 40),
      MaxDailyLossPct: num(p, "MaxDailyLossPct", 2),
      DailyTargetPct: num(p, "DailyTargetPct", 0),
      CooldownSeconds: num(p, "CooldownSeconds", 10),
    };

    let day = "";
    let dayStartEquity = 0;
    let fillsToday = 0;
    let lastPosTicket = -1;
    let lastCloseTime = -Infinity;
    let dayLocked = false;
    let crossBias = 0;
    let lastBias = 0;

    const eps = (c: StrategyContext) => c.Point / 10;

    // ComputeBias(): +1 buy side, -1 sell side, 0 none, 2 both (filter off)
    const computeBias = (c: StrategyContext): number => {
      if (P.BiasMode === "off") return P.Direction === "sell" ? -1 : P.Direction === "buy" ? 1 : 2;
      const k = c.candles(P.BiasTfSec, P.MaPeriod + 4);
      if (k.length < P.MaPeriod + 3) return 0;
      const highs = k.map((x) => x.high);
      const lows = k.map((x) => x.low);
      const avg = P.MaMethod === "ema" ? c.ind.ema : c.ind.sma;
      const hi1 = avg(highs, P.MaPeriod, 1);
      const lo1 = avg(lows, P.MaPeriod, 1);
      const c1 = k[k.length - 2].close;
      if (P.BiasMode === "wave") return c1 > hi1 ? 1 : c1 < lo1 ? -1 : 0;
      const hi2 = avg(highs, P.MaPeriod, 2);
      const lo2 = avg(lows, P.MaPeriod, 2);
      const c2 = k[k.length - 3].close;
      if (c1 > lo1 && c2 <= lo2) crossBias = 1;
      if (c1 < hi1 && c2 >= hi2) crossBias = -1;
      return crossBias;
    };

    const calcLots = (c: StrategyContext): number => {
      let lots = P.FixedLots;
      if (P.LotMode === "risk") {
        const lossPerLot = (P.StopLoss / c.Point) * c.pointValuePerLot();
        if (!(lossPerLot > 0)) return 0;
        lots = (c.AccountEquity() * P.RiskPercent) / 100 / lossPerLot;
      }
      lots = Math.floor(lots / 0.01 + 1e-9) * 0.01;
      return Math.max(0.01, Math.min(P.MaxLots, Math.round(lots * 100) / 100));
    };

    const exitsFor = (c: StrategyContext, buy: boolean, entry: number): [number, number] => {
      const stopLevel = c.stopLevelPoints * c.Point;
      const slDist = Math.max(P.StopLoss, stopLevel + c.Point);
      const tpDist = P.TakeProfit > 0 ? Math.max(P.TakeProfit, stopLevel + c.Point) : 0;
      return [c.NormalizeDouble(buy ? entry - slDist : entry + slDist), tpDist > 0 ? c.NormalizeDouble(buy ? entry + tpDist : entry - tpDist) : 0];
    };

    // WorkPending()
    const workPending = (c: StrategyContext, type: OrderType) => {
      const stopLevel = c.stopLevelPoints * c.Point;
      const dist = Math.max(P.EntryDistance, stopLevel + c.Point);
      const buy = type === "buystop";
      const desired = c.NormalizeDouble(buy ? c.Ask + dist : c.Bid - dist);
      const existing = c.pendings().find((o) => o.type === type);
      if (!existing) {
        const lots = calcLots(c);
        if (lots <= 0) return;
        const [sl, tp] = exitsFor(c, buy, desired);
        c.OrderSend(type, lots, desired, sl, tp, "HFT-v2");
        return;
      }
      const gap = buy ? existing.openPrice - desired : desired - existing.openPrice;
      if (gap >= P.ReplaceStep - eps(c)) {
        const [sl, tp] = exitsFor(c, buy, desired);
        c.OrderModify(existing.ticket, desired, sl, tp);
      }
    };

    const deletePending = (c: StrategyContext, type: OrderType) => {
      const o = c.pendings().find((x) => x.type === type);
      if (o) c.OrderDelete(o.ticket);
    };

    // ManageExit(): breakeven, then trailing
    const manageExit = (c: StrategyContext, ticket: number) => {
      const o = c.positions().find((x) => x.ticket === ticket);
      if (!o) return;
      const stopLevel = c.stopLevelPoints * c.Point;
      const trailDist = Math.max(P.TrailDistance, stopLevel + c.Point);
      const e = eps(c);
      let newSL = o.sl;
      if (o.type === "buy") {
        const profit = c.Bid - o.openPrice;
        if (P.BreakEvenAt > 0 && profit >= P.BreakEvenAt - e) {
          const be = c.NormalizeDouble(o.openPrice + P.BreakEvenLock);
          if ((o.sl === 0 || be > o.sl) && be <= c.Bid - stopLevel) newSL = be;
        }
        if (profit >= P.TrailStart - e) {
          const t = c.NormalizeDouble(c.Bid - trailDist);
          if (t > newSL && (o.sl === 0 || t >= o.sl + P.TrailStep - e)) newSL = t;
        }
        if (newSL !== o.sl && newSL > o.sl) c.OrderModify(ticket, o.openPrice, newSL, o.tp);
      } else if (o.type === "sell") {
        const profit = o.openPrice - c.Ask;
        if (P.BreakEvenAt > 0 && profit >= P.BreakEvenAt - e) {
          const be = c.NormalizeDouble(o.openPrice - P.BreakEvenLock);
          if ((o.sl === 0 || be < o.sl) && be >= c.Ask + stopLevel) newSL = be;
        }
        if (profit >= P.TrailStart - e) {
          const t = c.NormalizeDouble(c.Ask + trailDist);
          if ((newSL === 0 || t < newSL) && (o.sl === 0 || t <= o.sl - P.TrailStep + e)) newSL = t;
        }
        if (newSL !== o.sl && (o.sl === 0 || newSL < o.sl)) c.OrderModify(ticket, o.openPrice, newSL, o.tp);
      }
    };

    return {
      onTick(c) {
        if (c.ny.date !== day) {
          day = c.ny.date;
          dayStartEquity = c.AccountEquity();
          fillsToday = 0;
          dayLocked = false;
        }
        const pos = c.positions()[0];
        const posTicket = pos ? pos.ticket : -1;
        if (posTicket > 0 && posTicket !== lastPosTicket) fillsToday++;
        if (posTicket < 0 && lastPosTicket > 0) lastCloseTime = c.Time;
        lastPosTicket = posTicket;

        const eq = c.AccountEquity();
        if (!dayLocked && dayStartEquity > 0) {
          if (P.MaxDailyLossPct > 0 && eq <= dayStartEquity * (1 - P.MaxDailyLossPct / 100)) {
            dayLocked = true;
            c.log("Daily loss limit hit — done for today");
          } else if (P.DailyTargetPct > 0 && eq >= dayStartEquity * (1 + P.DailyTargetPct / 100) && posTicket < 0) {
            dayLocked = true;
            c.log("Daily target reached — done for today");
          }
        }

        const inSession = !P.UseSession || c.inSession(P.SessionStartHHMM, P.SessionEndHHMM);
        const bias = computeBias(c);
        if (bias !== lastBias) {
          c.log(`Wave: ${bias === 1 ? "buy side" : bias === -1 ? "sell side" : bias === 2 ? "both sides" : "inside, no side"}`);
          lastBias = bias;
        }

        if (posTicket > 0) {
          if (P.DeleteOppositeOnFill && c.pendings().length) for (const o of c.pendings()) c.OrderDelete(o.ticket);
          if (P.CloseAtSessionEnd && !inSession) c.OrderClose(posTicket);
          else manageExit(c, posTicket);
          return;
        }

        const blocked =
          dayLocked ||
          (P.MaxTradesPerDay > 0 && fillsToday >= P.MaxTradesPerDay) ||
          !inSession ||
          c.Ask - c.Bid > P.MaxSpread + eps(c) ||
          (P.CooldownSeconds > 0 && c.Time - lastCloseTime < P.CooldownSeconds * 1000) ||
          bias === 0;
        if (blocked) {
          for (const o of c.pendings()) c.OrderDelete(o.ticket);
          return;
        }

        const buyOk = bias > 0 && P.Direction !== "sell";
        const sellOk = (bias < 0 || bias === 2) && P.Direction !== "buy";
        if (buyOk) workPending(c, "buystop");
        else deletePending(c, "buystop");
        if (sellOk) workPending(c, "sellstop");
        else deletePending(c, "sellstop");
      },
    };
  },
};

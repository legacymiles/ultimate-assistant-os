// ---------------------------------------------------------------------------
// HFT Secret (rebuild) — the replay twin of
// public/ea-world/experts/HFT_Secret_Rebuild.mq4.
//
// Same inputs, same names, same order of decisions, so a replay of a past New
// York session shows what the .mq4 would have done on that tape. If you change
// the logic in one file, change it in the other; the comments mark the
// matching MQL4 function for each block.
// ---------------------------------------------------------------------------

import type { OrderType } from "../broker";
import { bool, num, str, type StrategyContext, type StrategyDef } from "../strategy";

export const HFT_SECRET: StrategyDef = {
  id: "hft-secret",
  name: "HFT Secret (rebuild)",
  summary:
    "Buy Stop above, Sell Stop below, both dragged along when price drifts away and left alone when it comes toward them. " +
    "A fast move fills one, the other is cancelled, and a tight trailing stop takes the exit. Spread, NY session, daily loss and trade-count filters.",
  origin: "builtin",
  mq4: "/ea-world/experts/HFT_Secret_Rebuild.mq4",
  suggestedSession: "ny-peak",
  params: [
    { key: "LotMode", label: "Lot mode", type: "select", default: "fixed", group: "Money", options: [{ value: "fixed", label: "Fixed lots" }, { value: "risk", label: "Risk % of equity" }] },
    { key: "FixedLots", label: "Fixed lots", type: "number", default: 0.1, min: 0.01, step: 0.01, group: "Money" },
    { key: "RiskPercent", label: "Risk % per trade", type: "number", default: 1, min: 0.1, step: 0.1, group: "Money" },
    { key: "MaxLots", label: "Lot ceiling", type: "number", default: 5, min: 0.01, step: 0.01, group: "Money" },
    { key: "Direction", label: "Direction", type: "select", default: "both", group: "Entry", options: [{ value: "both", label: "Both" }, { value: "buy", label: "Buy only" }, { value: "sell", label: "Sell only" }] },
    { key: "EntryDistance", label: "Entry distance (pts)", type: "int", default: 60, min: 1, group: "Entry", hint: "How far the stop orders sit from price" },
    { key: "ReplaceStep", label: "Drag step (pts)", type: "int", default: 10, min: 0, group: "Entry", hint: "Only move a pending once it is this far off" },
    { key: "DeleteOppositeOnFill", label: "OCO — cancel other side on fill", type: "bool", default: true, group: "Entry" },
    { key: "MaxSpread", label: "Max spread (pts)", type: "int", default: 20, min: 0, group: "Entry" },
    { key: "StopLoss", label: "Stop loss (pts)", type: "int", default: 100, min: 1, group: "Exit" },
    { key: "TakeProfit", label: "Take profit (pts, 0 = trail only)", type: "int", default: 0, min: 0, group: "Exit" },
    { key: "TrailStart", label: "Trail starts at (pts)", type: "int", default: 30, min: 0, group: "Exit" },
    { key: "TrailDistance", label: "Trail distance (pts)", type: "int", default: 25, min: 1, group: "Exit" },
    { key: "TrailStep", label: "Trail step (pts)", type: "int", default: 5, min: 0, group: "Exit" },
    { key: "UseSession", label: "Only trade in session", type: "bool", default: true, group: "Session" },
    { key: "SessionStartHHMM", label: "Start (NY, HHMM)", type: "int", default: 800, min: 0, max: 2359, group: "Session" },
    { key: "SessionEndHHMM", label: "End (NY, HHMM)", type: "int", default: 1100, min: 0, max: 2359, group: "Session" },
    { key: "CloseAtSessionEnd", label: "Close trades at session end", type: "bool", default: false, group: "Session" },
    { key: "MaxTradesPerDay", label: "Max fills per day", type: "int", default: 60, min: 0, group: "Protection" },
    { key: "MaxDailyLossPct", label: "Max daily loss %", type: "number", default: 3, min: 0, step: 0.5, group: "Protection" },
    { key: "CooldownSeconds", label: "Cooldown after close (s)", type: "int", default: 5, min: 0, group: "Protection" },
  ],
  presets: {
    XAUUSD: { EntryDistance: 150, ReplaceStep: 20, MaxSpread: 40, StopLoss: 300, TrailStart: 80, TrailDistance: 60, TrailStep: 10, FixedLots: 0.05 },
    USDJPY: { EntryDistance: 60, MaxSpread: 20 },
    US30: { EntryDistance: 80, ReplaceStep: 10, MaxSpread: 40, StopLoss: 200, TrailStart: 50, TrailDistance: 40, TrailStep: 5, FixedLots: 1 },
    NAS100: { EntryDistance: 40, ReplaceStep: 5, MaxSpread: 20, StopLoss: 100, TrailStart: 25, TrailDistance: 20, TrailStep: 3, FixedLots: 1 },
    SPX500: { EntryDistance: 15, ReplaceStep: 3, MaxSpread: 10, StopLoss: 40, TrailStart: 10, TrailDistance: 8, TrailStep: 2, FixedLots: 1 },
    BTCUSD: { EntryDistance: 4000, ReplaceStep: 500, MaxSpread: 3000, StopLoss: 8000, TrailStart: 2500, TrailDistance: 2000, TrailStep: 300, FixedLots: 0.1 },
  },

  create(p) {
    const P = {
      LotMode: str(p, "LotMode", "fixed"),
      FixedLots: num(p, "FixedLots", 0.1),
      RiskPercent: num(p, "RiskPercent", 1),
      MaxLots: num(p, "MaxLots", 5),
      Direction: str(p, "Direction", "both"),
      EntryDistance: num(p, "EntryDistance", 60),
      ReplaceStep: num(p, "ReplaceStep", 10),
      DeleteOppositeOnFill: bool(p, "DeleteOppositeOnFill", true),
      MaxSpread: num(p, "MaxSpread", 20),
      StopLoss: num(p, "StopLoss", 100),
      TakeProfit: num(p, "TakeProfit", 0),
      TrailStart: num(p, "TrailStart", 30),
      TrailDistance: num(p, "TrailDistance", 25),
      TrailStep: num(p, "TrailStep", 5),
      UseSession: bool(p, "UseSession", true),
      SessionStartHHMM: num(p, "SessionStartHHMM", 800),
      SessionEndHHMM: num(p, "SessionEndHHMM", 1100),
      CloseAtSessionEnd: bool(p, "CloseAtSessionEnd", false),
      MaxTradesPerDay: num(p, "MaxTradesPerDay", 60),
      MaxDailyLossPct: num(p, "MaxDailyLossPct", 3),
      CooldownSeconds: num(p, "CooldownSeconds", 5),
    };

    let day = "";
    let dayStartEquity = 0;
    let fillsToday = 0;
    let lastPosTicket = -1;
    let lastCloseTime = -Infinity;
    let dayLocked = false;

    // CalcLots()
    const calcLots = (c: StrategyContext): number => {
      let lots = P.FixedLots;
      if (P.LotMode === "risk") {
        const lossPerLot = P.StopLoss * c.pointValuePerLot();
        if (!(lossPerLot > 0)) return 0;
        lots = (c.AccountEquity() * P.RiskPercent) / 100 / lossPerLot;
      }
      lots = Math.floor(lots / 0.01 + 1e-9) * 0.01;
      return Math.max(0.01, Math.min(Math.min(100, P.MaxLots), Math.round(lots * 100) / 100));
    };

    // ExitsFor()
    const exitsFor = (c: StrategyContext, buy: boolean, entry: number): [number, number] => {
      const stopLevel = Math.max(c.stopLevelPoints, 0) * c.Point;
      const slDist = Math.max(P.StopLoss * c.Point, stopLevel + c.Point);
      const tpDist = P.TakeProfit > 0 ? Math.max(P.TakeProfit * c.Point, stopLevel + c.Point) : 0;
      const sl = c.NormalizeDouble(buy ? entry - slDist : entry + slDist);
      const tp = tpDist > 0 ? c.NormalizeDouble(buy ? entry + tpDist : entry - tpDist) : 0;
      return [sl, tp];
    };

    // WorkPending()
    const workPending = (c: StrategyContext, type: OrderType) => {
      const stopLevel = Math.max(c.stopLevelPoints, 0) * c.Point;
      const dist = Math.max(P.EntryDistance * c.Point, stopLevel + c.Point);
      const buy = type === "buystop";
      const desired = c.NormalizeDouble(buy ? c.Ask + dist : c.Bid - dist);
      const existing = c.pendings().find((o) => o.type === type);
      if (!existing) {
        const lots = calcLots(c);
        if (lots <= 0) return;
        const [sl, tp] = exitsFor(c, buy, desired);
        c.OrderSend(type, lots, desired, sl, tp, "HFT-Rebuild");
        return;
      }
      const gap = buy ? existing.openPrice - desired : desired - existing.openPrice;
      if (gap >= P.ReplaceStep * c.Point - c.Point / 10) {
        const [sl, tp] = exitsFor(c, buy, desired);
        c.OrderModify(existing.ticket, desired, sl, tp);
      }
    };

    // Trail()
    const trail = (c: StrategyContext, ticket: number) => {
      const o = c.positions().find((x) => x.ticket === ticket);
      if (!o) return;
      const stopLevel = Math.max(c.stopLevelPoints, 0) * c.Point;
      const dist = Math.max(P.TrailDistance * c.Point, stopLevel + c.Point);
      const eps = c.Point / 10;
      if (o.type === "buy") {
        if (c.Bid - o.openPrice < P.TrailStart * c.Point - eps) return;
        const newSL = c.NormalizeDouble(c.Bid - dist);
        if (o.sl === 0 || newSL >= o.sl + P.TrailStep * c.Point - eps) {
          if (newSL !== o.sl) c.OrderModify(ticket, o.openPrice, newSL, o.tp);
        }
      } else if (o.type === "sell") {
        if (o.openPrice - c.Ask < P.TrailStart * c.Point - eps) return;
        const newSL = c.NormalizeDouble(c.Ask + dist);
        if (o.sl === 0 || newSL <= o.sl - P.TrailStep * c.Point + eps) {
          if (newSL !== o.sl) c.OrderModify(ticket, o.openPrice, newSL, o.tp);
        }
      }
    };

    const deleteAllPendings = (c: StrategyContext) => {
      for (const o of c.pendings()) c.OrderDelete(o.ticket);
    };

    return {
      // OnTick()
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

        if (!dayLocked && P.MaxDailyLossPct > 0 && dayStartEquity > 0 && c.AccountEquity() <= dayStartEquity * (1 - P.MaxDailyLossPct / 100)) {
          dayLocked = true;
          c.log("Daily loss limit hit — done for today");
        }

        const inSession = !P.UseSession || c.inSession(P.SessionStartHHMM, P.SessionEndHHMM);

        if (posTicket > 0) {
          if (P.DeleteOppositeOnFill && c.pendings().length) deleteAllPendings(c);
          if (P.CloseAtSessionEnd && !inSession) c.OrderClose(posTicket);
          else trail(c, posTicket);
          return;
        }

        let block = "";
        if (dayLocked) block = "daily loss";
        else if (P.MaxTradesPerDay > 0 && fillsToday >= P.MaxTradesPerDay) block = "max trades";
        else if (!inSession) block = "session";
        else if (c.spreadPoints > P.MaxSpread) block = "spread";
        else if (P.CooldownSeconds > 0 && c.Time - lastCloseTime < P.CooldownSeconds * 1000) block = "cooldown";

        if (block) {
          if (c.pendings().length) deleteAllPendings(c);
          return;
        }

        if (P.Direction !== "sell") workPending(c, "buystop");
        if (P.Direction !== "buy") workPending(c, "sellstop");
      },
    };
  },
};

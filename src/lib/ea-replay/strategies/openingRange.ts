// ---------------------------------------------------------------------------
// NY Opening Range Breakout — a second, deliberately plain bot.
//
// It is here to show the strategy API doing something the HFT bot does not:
// reading candles. Mark the high and low of the first N minutes after the
// window opens, then trade the first break of either side with a fixed stop
// and a target in multiples of the range.
// ---------------------------------------------------------------------------

import { num, type StrategyDef } from "../strategy";

export const OPENING_RANGE: StrategyDef = {
  id: "ny-orb",
  name: "NY Opening Range Breakout",
  summary: "High/low of the first minutes after the open, then one breakout trade per day with the stop on the other side of the range.",
  origin: "builtin",
  suggestedSession: "ny-open",
  params: [
    { key: "OpenHHMM", label: "Range starts (NY, HHMM)", type: "int", default: 930, group: "Range" },
    { key: "RangeMinutes", label: "Range length (min)", type: "int", default: 15, min: 1, group: "Range" },
    { key: "LastEntryHHMM", label: "No entries after (NY)", type: "int", default: 1130, group: "Range" },
    { key: "TargetR", label: "Target (× range)", type: "number", default: 1.5, min: 0.1, step: 0.1, group: "Exit" },
    { key: "BufferPts", label: "Breakout buffer (pts)", type: "int", default: 20, min: 0, group: "Entry" },
    { key: "Lots", label: "Lots", type: "number", default: 0.1, min: 0.01, step: 0.01, group: "Money" },
  ],
  presets: {
    XAUUSD: { BufferPts: 50, Lots: 0.05 },
    US30: { BufferPts: 30, Lots: 1 },
    NAS100: { BufferPts: 20, Lots: 1 },
  },
  create(p) {
    const open = num(p, "OpenHHMM", 930);
    const minutes = num(p, "RangeMinutes", 15);
    const lastEntry = num(p, "LastEntryHHMM", 1130);
    const targetR = num(p, "TargetR", 1.5);
    const buffer = num(p, "BufferPts", 20);
    const lots = num(p, "Lots", 0.1);
    const rangeEnd = (() => {
      const m = Math.floor(open / 100) * 60 + (open % 100) + minutes;
      return Math.floor(m / 60) * 100 + (m % 60);
    })();

    let day = "";
    let hi = -Infinity;
    let lo = Infinity;
    let traded = false;

    return {
      onTick(c) {
        const { date, hhmm, dow } = c.ny;
        if (dow === 0 || dow === 6) return;
        if (date !== day) {
          day = date;
          hi = -Infinity;
          lo = Infinity;
          traded = false;
        }
        if (hhmm >= open && hhmm < rangeEnd) {
          hi = Math.max(hi, c.Bid);
          lo = Math.min(lo, c.Bid);
          return;
        }
        if (traded || hhmm < rangeEnd || hhmm >= lastEntry || !Number.isFinite(hi) || c.positions().length) return;
        const range = hi - lo;
        if (range <= 0) return;
        const buf = buffer * c.Point;
        if (c.Ask > hi + buf) {
          traded = true;
          c.OrderSend("buy", lots, c.Ask, c.NormalizeDouble(lo), c.NormalizeDouble(c.Ask + range * targetR), "ORB");
          c.log(`Long break of ${hi.toFixed(c.Digits)} (range ${(range / c.Point).toFixed(0)} pts)`);
        } else if (c.Bid < lo - buf) {
          traded = true;
          c.OrderSend("sell", lots, c.Bid, c.NormalizeDouble(hi), c.NormalizeDouble(c.Bid - range * targetR), "ORB");
          c.log(`Short break of ${lo.toFixed(c.Digits)} (range ${(range / c.Point).toFixed(0)} pts)`);
        }
      },
    };
  },
};

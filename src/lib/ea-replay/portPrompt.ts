// ---------------------------------------------------------------------------
// EA World › Replay — the instructions for turning an .mq4 into a replay bot.
//
// The model is told the replay's API in MT4's own vocabulary, and told what to
// do with the parts that cannot carry over (iCustom indicators, DLL calls,
// other symbols) — say so in NOTES rather than invent a substitute, because a
// port that quietly drops a filter is a different bot with the same name.
// ---------------------------------------------------------------------------

export const PORT_SYSTEM = `You port MetaTrader 4 Expert Advisors (MQL4) to a JavaScript strategy for a tick-replay engine.
Reply with exactly two parts:
1. One \`\`\`js fenced block containing ONLY a JavaScript object literal wrapped in parentheses.
2. A line starting "NOTES:" listing, briefly, anything that could not be ported faithfully.

The object shape:
({
  name: string,
  summary: string,               // one sentence on how it trades
  suggestedSession?: "ny-peak" | "ny-open" | "overlap" | "data" | "ny-full",
  params: [ { key, label, type: "int"|"number"|"bool"|"select", default, min?, max?, step?, options?: [{value,label}], group?, hint? } ],
  create(p) {                    // p[key] holds each param value
    // closure state here (replaces MQL4 globals/statics)
    return { onInit?(c) {}, onTick(c) {} };   // onTick replaces OnTick()/start()
  },
})

The context c (MT4 names on purpose):
- c.Symbol, c.Point, c.Digits, c.Bid, c.Ask, c.Time (epoch ms UTC), c.spreadPoints, c.stopLevelPoints
- c.ny -> { hhmm, dow, date } New York clock; c.inSession(startHHMM, endHHMM) New York window
- c.AccountBalance(), c.AccountEquity(), c.AccountFreeMargin(), c.pointValuePerLot() (USD per point per 1.00 lot)
- c.orders() (pending+open), c.positions(), c.pendings(), c.history() -> arrays of { ticket, type, lots, openPrice, sl, tp, comment, status, openTime, profit }
  type is "buy"|"sell"|"buystop"|"sellstop"|"buylimit"|"selllimit"; also c.OP_BUY … c.OP_SELLLIMIT constants
- c.OrderSend(type, lots, price, sl, tp, comment) -> ticket or -1; c.OrderModify(ticket, price, sl, tp); c.OrderDelete(ticket); c.OrderClose(ticket)
  Requests take effect after broker latency; the engine does not call onTick again until they are answered, exactly like MT4 blocking on OrderSend.
- c.NormalizeDouble(price)
- c.candles(tfSeconds, count?) -> [{ time, open, high, low, close, ticks }] oldest first, LAST ONE IS STILL FORMING (MT4 shift 0)
- c.closes(tfSeconds, count?) -> close prices oldest first
- c.ind.sma(values, period, shift=0), ema, rsi, atr(candles, period, shift), highest(values, count, shift), lowest — shift as in MT4 (0 newest)
- c.state (object persisting between ticks), c.log(message)

Porting rules:
- Keep every extern/input as a param with the SAME key name and default. Group them sensibly.
- Translate iMA/iRSI/iATR/iHigh/iLow/iClose/Close[]/High[] etc. using c.candles/c.closes and c.ind. PERIOD_M1=60, M5=300, M15=900, M30=1800, H1=3600, H4=14400, D1=86400 seconds.
- Time filters: MT4 Hour()/TimeHour() are BROKER time. Convert to New York time assuming broker = GMT+3 in US summer (NY+7h) unless the EA says otherwise, and say what you assumed in NOTES. Prefer exposing the window as NY HHMM params.
- Loops over OrdersTotal()/OrderSelect become c.orders()/c.positions()/c.pendings() filtered by comment or just by type (one symbol, one EA).
- Order history (OrdersHistoryTotal) -> c.history().
- iCustom, DLL imports, file IO, other symbols, GlobalVariables, MarketInfo modes other than the above: approximate only if trivial, otherwise leave out and list in NOTES.
- No imports, no async, no timers, no network, no DOM. Pure synchronous code.
- Never throw on missing history: if an indicator returns NaN just return from onTick.`;

export function portUserMessage(fileName: string, source: string): string {
  return `File: ${fileName || "expert.mq4"}\n\n\`\`\`mql4\n${source}\n\`\`\``;
}

export function splitNotes(reply: string): string {
  const m = reply.match(/NOTES:\s*([\s\S]*)$/i);
  return m ? m[1].trim() : "";
}

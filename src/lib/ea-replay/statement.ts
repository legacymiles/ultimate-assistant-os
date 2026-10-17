// ---------------------------------------------------------------------------
// EA World › Replay › Fingerprint the original.
//
// When an EA is compiled and encrypted, the only honest way to learn how it
// trades is to watch it trade. Its trades are already written down wherever it
// ran: an MT4 account statement (Account History › right-click › Save as
// Detailed Report) or a Strategy Tester report (Report tab › Save as Report).
//
// This reads either one and measures the bot from the outside — stop and
// target distance, how often it exits on a trailed stop, how far the stop
// moves each step, lot size, which side, which hours of the New York day — and
// turns the measurements into inputs for HFT Secret v2. The Strategy Tester
// report is the richer source: it logs every stop MODIFY and every pending
// order, so the trail step and the use of stop orders can be seen directly;
// a statement only shows where each trade ended.
//
// All distances are in PRICE (index points on US30), the unit v2 uses.
// ---------------------------------------------------------------------------

import { nyClock } from "./session";
import type { Params } from "./strategy";

export interface OrigTrade {
  ticket: number;
  type: "buy" | "sell";
  lots: number;
  symbol: string;
  /** UTC ms (already corrected by the server offset). */
  openTime: number;
  openPrice: number;
  /** First stop seen (tester) or the final stop (statement). 0 = none. */
  initialSl: number;
  finalSl: number;
  tp: number;
  closeTime: number;
  closePrice: number;
  profit: number;
  /** Every stop change, in order (tester reports only). */
  slMoves: number[];
  viaPending: boolean;
  closeKind: "sl" | "tp" | "close" | "unknown";
}

export interface ParsedReport {
  kind: "statement" | "tester";
  trades: OrigTrade[];
  /** Pending orders that were placed and later deleted (tester only) — the "hunting" ones. */
  deletedPendings: number;
  pendingModifies: number;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

function rows(html: string): string[][] {
  const out: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html))) {
    const cells: string[] = [];
    const tdRe = /<t[dh]\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi;
    let c: RegExpExecArray | null;
    while ((c = tdRe.exec(m[1]))) {
      const span = /colspan\s*=\s*"?(\d+)/i.exec(c[1]);
      cells.push(decode(c[2]));
      for (let k = 1; span && k < Number(span[1]); k++) cells.push("");
    }
    if (cells.length) out.push(cells);
  }
  return out;
}

function mtTime(s: string, offsetMs: number): number {
  const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) - offsetMs;
}

const n = (s: string | undefined) => {
  const v = Number((s ?? "").replace(/\s/g, "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
};

/** Reads an MT4 Detailed Statement or Strategy Tester report (.htm). */
export function parseMt4Report(html: string, serverOffsetHours = 0): ParsedReport {
  const offsetMs = serverOffsetHours * 3_600_000;
  const all = rows(html);
  const isTester = /Strategy Tester/i.test(html) || all.some((r) => r.length >= 9 && /^#$/.test(r[0]) && /order/i.test(r[3] ?? ""));
  return isTester ? parseTester(all, offsetMs, html) : parseStatement(all, offsetMs);
}

function parseStatement(all: string[][], offsetMs: number): ParsedReport {
  const trades: OrigTrade[] = [];
  for (const r of all) {
    // Ticket | Open Time | Type | Size | Item | Price | S/L | T/P | Close Time | Price | Commission | Taxes | Swap | Profit
    if (r.length < 14 || !/^\d+$/.test(r[0]) || !/^(buy|sell)$/i.test(r[2])) continue;
    const type = r[2].toLowerCase() as "buy" | "sell";
    const openPrice = n(r[5]);
    const sl = n(r[6]);
    const tp = n(r[7]);
    const closePrice = n(r[9]);
    const t: OrigTrade = {
      ticket: Number(r[0]),
      type,
      lots: n(r[3]),
      symbol: r[4],
      openTime: mtTime(r[1], offsetMs),
      openPrice,
      initialSl: sl,
      finalSl: sl,
      tp,
      closeTime: mtTime(r[8], offsetMs),
      closePrice,
      profit: n(r[10]) + n(r[11]) + n(r[12]) + n(r[13]),
      slMoves: [],
      viaPending: false,
      closeKind: "unknown",
    };
    const tol = Math.max(Math.abs(openPrice) * 2e-5, 1e-9);
    if (sl > 0 && Math.abs(closePrice - sl) <= tol * 5) t.closeKind = "sl";
    else if (tp > 0 && Math.abs(closePrice - tp) <= tol * 5) t.closeKind = "tp";
    else t.closeKind = "close";
    if (Number.isFinite(t.openTime) && Number.isFinite(t.closeTime)) trades.push(t);
  }
  return { kind: "statement", trades, deletedPendings: 0, pendingModifies: 0 };
}

function parseTester(all: string[][], offsetMs: number, html: string): ParsedReport {
  // # | Time | Type | Order | Size | Price | S/L | T/P | Profit | Balance
  const symbol = (html.match(/Symbol[\s\S]{0,80}?<td[^>]*>([^<(]+)/i)?.[1] ?? "").trim();
  const open = new Map<number, OrigTrade>();
  const pending = new Map<number, { type: string; sl: number; tp: number }>();
  const trades: OrigTrade[] = [];
  let deletedPendings = 0;
  let pendingModifies = 0;
  for (const r of all) {
    if (r.length < 9 || !/^\d+$/.test(r[0])) continue;
    const time = mtTime(r[1], offsetMs);
    const kind = r[2].toLowerCase();
    const order = Number(r[3]);
    const lots = n(r[4]);
    const price = n(r[5]);
    const sl = n(r[6]);
    const tp = n(r[7]);
    if (/^(buy|sell) (stop|limit)$/.test(kind)) {
      pending.set(order, { type: kind, sl, tp });
    } else if (kind === "delete") {
      if (pending.delete(order)) deletedPendings++;
    } else if (kind === "buy" || kind === "sell") {
      const p = pending.get(order);
      pending.delete(order);
      open.set(order, {
        ticket: order, type: kind, lots, symbol, openTime: time, openPrice: price,
        initialSl: sl || p?.sl || 0, finalSl: sl || p?.sl || 0, tp: tp || p?.tp || 0,
        closeTime: NaN, closePrice: NaN, profit: 0, slMoves: [], viaPending: !!p, closeKind: "unknown",
      });
    } else if (kind === "modify") {
      const t = open.get(order);
      if (t) {
        if (sl > 0 && sl !== t.finalSl) t.slMoves.push(sl);
        t.finalSl = sl;
        t.tp = tp;
      } else if (pending.has(order)) {
        pendingModifies++;
      }
    } else if (kind === "close" || kind === "s/l" || kind === "t/p" || kind === "close at stop") {
      const t = open.get(order);
      if (!t) continue;
      open.delete(order);
      t.closeTime = time;
      t.closePrice = price;
      t.profit = n(r[8]);
      t.closeKind = kind === "s/l" ? "sl" : kind === "t/p" ? "tp" : "close";
      trades.push(t);
    }
  }
  return { kind: "tester", trades, deletedPendings, pendingModifies };
}

// ---------------------------------------------------------------------------

export interface Fingerprint {
  kind: ParsedReport["kind"];
  trades: number;
  symbols: string[];
  buys: number;
  sells: number;
  winRate: number;
  net: number;
  hold: { p10: number; median: number; p90: number };
  medianLots: number;
  /** Price distance entry→initial stop. */
  stopDist: number | null;
  targetDist: number | null;
  targetShare: number;
  exits: { sl: number; tp: number; close: number; trailedInProfit: number };
  medianWin: number;
  medianLoss: number;
  trailStep: number | null;
  viaPendingShare: number | null;
  deletedPendings: number;
  pendingModifies: number;
  /** Entries per New York hour, index 0–23. */
  nyHours: number[];
  window: { start: number; end: number } | null;
  maxTradesInADay: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};
const round = (x: number, step: number) => Math.round(x / step) * step;

export function fingerprint(rep: ParsedReport): Fingerprint {
  const T = rep.trades;
  const dir = (t: OrigTrade) => (t.type === "buy" ? 1 : -1);
  const moves = T.map((t) => (t.closePrice - t.openPrice) * dir(t));
  const wins = moves.filter((m, i) => T[i].profit > 0 && m > 0);
  const losses = moves.filter((m, i) => T[i].profit <= 0).map((m) => -m).filter((m) => m > 0);
  const stops = T.filter((t) => t.initialSl > 0).map((t) => Math.abs(t.openPrice - t.initialSl));
  const targets = T.filter((t) => t.tp > 0).map((t) => Math.abs(t.tp - t.openPrice));
  const holds = T.map((t) => (t.closeTime - t.openTime) / 1000).filter((h) => h >= 0);
  const steps: number[] = [];
  for (const t of T) {
    let prev = t.initialSl;
    for (const s of t.slMoves) {
      const d = (s - prev) * dir(t);
      if (prev > 0 && d > 0) steps.push(d);
      prev = s;
    }
  }
  const nyHours = new Array(24).fill(0);
  const minutes: number[] = [];
  const perDay = new Map<string, number>();
  for (const t of T) {
    const c = nyClock(t.openTime);
    nyHours[Math.floor(c.hhmm / 100)]++;
    minutes.push(Math.floor(c.hhmm / 100) * 60 + (c.hhmm % 100));
    perDay.set(c.date, (perDay.get(c.date) ?? 0) + 1);
  }
  const toHHMM = (m: number) => Math.floor(m / 60) * 100 + (m % 60);
  const window =
    minutes.length >= 3
      ? { start: toHHMM(Math.floor(pct(minutes, 0.05) / 15) * 15), end: toHHMM(Math.min(23 * 60 + 45, Math.ceil((pct(minutes, 0.95) + 1) / 15) * 15)) }
      : null;
  const trailedInProfit = T.filter((t) => t.closeKind === "sl" && t.profit > 0).length;

  return {
    kind: rep.kind,
    trades: T.length,
    symbols: [...new Set(T.map((t) => t.symbol).filter(Boolean))],
    buys: T.filter((t) => t.type === "buy").length,
    sells: T.filter((t) => t.type === "sell").length,
    winRate: T.length ? (T.filter((t) => t.profit > 0).length / T.length) * 100 : 0,
    net: Math.round(T.reduce((s, t) => s + t.profit, 0) * 100) / 100,
    hold: { p10: pct(holds, 0.1), median: median(holds), p90: pct(holds, 0.9) },
    medianLots: median(T.map((t) => t.lots)),
    stopDist: stops.length ? median(stops) : null,
    targetDist: targets.length ? median(targets) : null,
    targetShare: T.length ? targets.length / T.length : 0,
    exits: {
      sl: T.filter((t) => t.closeKind === "sl").length,
      tp: T.filter((t) => t.closeKind === "tp").length,
      close: T.filter((t) => t.closeKind === "close" || t.closeKind === "unknown").length,
      trailedInProfit,
    },
    medianWin: median(wins),
    medianLoss: median(losses),
    trailStep: steps.length >= 3 ? median(steps) : null,
    viaPendingShare: rep.kind === "tester" && T.length ? T.filter((t) => t.viaPending).length / T.length : null,
    deletedPendings: rep.deletedPendings,
    pendingModifies: rep.pendingModifies,
    nyHours,
    window,
    maxTradesInADay: Math.max(0, ...perDay.values()),
  };
}

export interface Suggestion {
  key: string;
  value: number | string | boolean;
  why: string;
  confidence: "measured" | "estimated";
}

/** Turns a fingerprint into HFT Secret v2 inputs, each with the reason. */
export function suggestV2(fp: Fingerprint, tick = 0.01): Suggestion[] {
  const out: Suggestion[] = [];
  const r = (x: number) => Math.max(tick, round(x, tick));
  if (!fp.trades) return out;

  if (fp.stopDist && fp.stopDist > 0) {
    out.push({ key: "StopLoss", value: r(fp.stopDist), why: `median entry-to-stop distance over ${fp.trades} trades`, confidence: "measured" });
  } else if (fp.medianLoss > 0) {
    out.push({ key: "StopLoss", value: r(fp.medianLoss), why: "no stops in the file; median losing move used instead", confidence: "estimated" });
  }

  if (fp.targetShare >= 0.5 && fp.targetDist) {
    out.push({ key: "TakeProfit", value: r(fp.targetDist), why: `${Math.round(fp.targetShare * 100)}% of trades carried a target`, confidence: "measured" });
  } else {
    out.push({ key: "TakeProfit", value: 0, why: `only ${Math.round(fp.targetShare * 100)}% of trades had a target — it exits by stop`, confidence: "measured" });
  }

  const trailed = fp.trades ? fp.exits.trailedInProfit / fp.trades : 0;
  if (fp.trailStep) {
    out.push({ key: "TrailStep", value: r(fp.trailStep), why: "median size of each stop move in the tester log", confidence: "measured" });
  }
  if (trailed >= 0.2 && fp.medianWin > 0) {
    const dist = r(Math.max(fp.medianWin * 0.6, tick));
    out.push({ key: "TrailDistance", value: dist, why: `${Math.round(trailed * 100)}% of trades closed on a stop in profit — a trailing stop; distance estimated from the median win`, confidence: "estimated" });
    out.push({ key: "TrailStart", value: r(dist * 1.3), why: "set a little beyond the trail distance", confidence: "estimated" });
    out.push({ key: "BreakEvenAt", value: r(dist), why: "breakeven at the trail distance", confidence: "estimated" });
  }

  if (fp.medianLots > 0) out.push({ key: "FixedLots", value: Math.round(fp.medianLots * 100) / 100, why: "median lot size", confidence: "measured" });
  out.push({ key: "LotMode", value: "fixed", why: "lots taken from the file", confidence: "measured" });

  if (fp.window) {
    out.push({ key: "SessionStartHHMM", value: fp.window.start, why: "5th percentile of entry times, New York", confidence: "measured" });
    out.push({ key: "SessionEndHHMM", value: fp.window.end, why: "95th percentile of entry times, New York", confidence: "measured" });
    out.push({ key: "UseSession", value: true, why: "entries cluster inside that window", confidence: "measured" });
  }

  const buyShare = fp.buys / fp.trades;
  if (buyShare >= 0.85) out.push({ key: "Direction", value: "buy", why: `${Math.round(buyShare * 100)}% of trades were buys`, confidence: "measured" });
  else if (buyShare <= 0.15) out.push({ key: "Direction", value: "sell", why: `${Math.round((1 - buyShare) * 100)}% of trades were sells`, confidence: "measured" });

  if (fp.maxTradesInADay > 0) {
    out.push({ key: "MaxTradesPerDay", value: Math.ceil(fp.maxTradesInADay * 1.2), why: `busiest day had ${fp.maxTradesInADay} trades`, confidence: "measured" });
  }
  return out;
}

export function applySuggestions(base: Params, s: Suggestion[]): Params {
  const out = { ...base };
  for (const x of s) out[x.key] = x.value;
  return out;
}

/** Best guess at which Replay symbol the file traded. */
export function guessInstrument(symbols: string[]): string | null {
  const s = symbols.join(" ").toUpperCase();
  if (/US30|DJ30|WS30|DOW|USA30|YM/.test(s)) return "US30";
  if (/NAS|NDX|US100|USTEC|USATECH/.test(s)) return "NAS100";
  if (/SPX|US500|SP500|USA500/.test(s)) return "SPX500";
  if (/XAU|GOLD/.test(s)) return "XAUUSD";
  for (const fx of ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY", "BTCUSD"]) if (s.includes(fx)) return fx;
  return null;
}

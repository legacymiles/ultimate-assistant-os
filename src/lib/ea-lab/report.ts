// ---------------------------------------------------------------------------
// Parse a MetaTrader Strategy Tester report.
//
// Written against a REAL report produced by the rig (Coinexx-Demo build 1443,
// see __fixtures__/mt4-report.htm), not against the documented format, because
// two details only show up in real output:
//
//  1. Trades are PAIRED ROWS, not one row per trade. An entry row (`buy` /
//     `sell`) carries no profit; a later `close` / `s/l` / `t/p` row carries
//     the profit and balance. They are joined by the ORDER number, and without
//     that join there is no open time -- which is exactly what the exposure
//     detector needs to reconstruct what was held at once.
//  2. `Modelling quality` is literally `n/a` for open-prices runs. That is not
//     a missing value to default away; it is the report saying the run cannot
//     support any intrabar claim.
// ---------------------------------------------------------------------------

import type { ModelQuality, Trade, RunMetrics } from "./types";

export interface ParsedReport {
  ea: string;
  server: string;
  symbol: string;
  period: string;
  from?: number;
  to?: number;
  model: ModelQuality;
  parameters: string;
  barsInTest: number;
  ticksModelled: number;
  deposit: number;
  spread: number | "current";
  metrics: RunMetrics;
  trades: Trade[];
  /** Anything the report said that we could not turn into a number. */
  warnings: string[];
}

/** MT reports ship in whatever the terminal's codepage was. Try the likely ones. */
export function decodeReport(raw: Uint8Array): string {
  // A UTF-16 BOM is unambiguous; otherwise UTF-8 then Windows-1252, which
  // between them cover every terminal build seen here.
  if (raw[0] === 0xff && raw[1] === 0xfe) return new TextDecoder("utf-16le").decode(raw);
  if (raw[0] === 0xfe && raw[1] === 0xff) return new TextDecoder("utf-16be").decode(raw);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder("windows-1252").decode(raw);
  }
}

const strip = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").trim();

/** Every table row as an array of cell strings. */
function rows(html: string): string[][] {
  const out: string[][] = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1]));
    if (cells.length) out.push(cells);
  }
  return out;
}

const num = (s: string | undefined): number => {
  if (!s) return NaN;
  const m = s.replace(/\s+/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
};

/** "19390.80 (82.64%)" -> [19390.80, 82.64] */
function pair(s: string | undefined): [number, number] {
  if (!s) return [NaN, NaN];
  const all = [...s.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));
  return [all[0] ?? NaN, all[1] ?? NaN];
}

function parseModel(modelText: string, qualityText: string): ModelQuality {
  const q = num(qualityText);
  const t = modelText.toLowerCase();
  if (t.includes("real tick")) return { kind: "real-ticks" };
  if (t.includes("open price")) return { kind: "open-prices", percent: Number.isFinite(q) ? q : 0 };
  if (t.includes("control point")) return { kind: "control-points", percent: Number.isFinite(q) ? q : 0 };
  if (t.includes("every tick")) return { kind: "every-tick", percent: Number.isFinite(q) ? q : 0 };
  return { kind: "unknown" };
}

/** "2026.01.02 02:00" -> epoch ms (report times are server-local; treated as UTC). */
function parseTime(s: string): number {
  const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
}

const OPEN_TYPES = new Set(["buy", "sell"]);
const CLOSE_TYPES = new Set(["close", "s/l", "t/p", "close at stop", "so"]);

export function parseMt4Report(html: string): ParsedReport {
  const warnings: string[] = [];
  const rs = rows(html);

  /** The cell following a label cell, anywhere in the report. */
  const after = (label: string): string | undefined => {
    const want = label.toLowerCase();
    for (const r of rs) {
      for (let i = 0; i < r.length - 1; i++) {
        if (r[i].toLowerCase() === want) return r[i + 1];
      }
    }
    return undefined;
  };

  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const ea = title.replace(/^Strategy Tester:\s*/i, "").trim();

  const periodText = after("Period") ?? "";
  const range = periodText.match(
    /(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2})\s*-\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2})/,
  );

  const model = parseModel(after("Model") ?? "", after("Modelling quality") ?? "");
  if (model.kind === "open-prices") {
    warnings.push("Open-prices model: this run cannot support any claim about intrabar behaviour.");
  } else if (model.kind !== "real-ticks" && "percent" in model && model.percent < 90) {
    warnings.push(
      `Modelling quality ${model.percent || "n/a"}% is below the 90% needed to trust the result.`,
    );
  }

  const [maxDd, maxDdPct] = pair(after("Maximal drawdown"));
  const spreadRaw = after("Spread") ?? "";

  // --- Trades --------------------------------------------------------------
  const hdr = rs.findIndex((r) => r[0] === "#" && r.some((c) => c.toLowerCase() === "order"));
  const openOrders = new Map<
    string,
    { time: number; side: "buy" | "sell"; lots: number; price: number }
  >();
  const trades: Trade[] = [];

  if (hdr === -1) {
    warnings.push("No deal table found in the report.");
  } else {
    const cols = rs[hdr].map((c) => c.toLowerCase());
    const idx = (n: string) => cols.indexOf(n);
    const iTime = idx("time");
    const iType = idx("type");
    const iOrder = idx("order");
    const iSize = idx("size");
    const iPrice = idx("price");
    const iProfit = idx("profit");
    const iBalance = idx("balance");

    for (const r of rs.slice(hdr + 1)) {
      const type = (r[iType] ?? "").toLowerCase();
      const order = r[iOrder];
      if (!order) continue;

      if (OPEN_TYPES.has(type)) {
        openOrders.set(order, {
          time: parseTime(r[iTime] ?? ""),
          side: type as "buy" | "sell",
          lots: num(r[iSize]),
          price: num(r[iPrice]),
        });
      } else if (CLOSE_TYPES.has(type)) {
        const o = openOrders.get(order);
        if (!o) {
          // An exit with no matching entry means the table is partial. Counting
          // it would put a position in the book that never opened, and the
          // exposure sweep would report size the account never carried.
          warnings.push(`Exit for order ${order} has no matching entry; skipped.`);
          continue;
        }
        const bal = num(r[iBalance]);
        trades.push({
          openTime: o.time,
          time: parseTime(r[iTime] ?? ""),
          side: o.side,
          lots: o.lots,
          price: num(r[iPrice]),
          profit: num(r[iProfit]),
          balance: Number.isFinite(bal) ? bal : undefined,
        });
        openOrders.delete(order);
      }
    }
    if (openOrders.size) {
      warnings.push(`${openOrders.size} position(s) still open at the end of the test.`);
    }
  }

  const wins = trades.filter((t) => t.profit > 0).length;
  const netProfit = num(after("Total net profit"));

  const metrics: RunMetrics = {
    netProfit,
    grossProfit: num(after("Gross profit")),
    grossLoss: num(after("Gross loss")),
    profitFactor: num(after("Profit factor")),
    expectedPayoff: num(after("Expected payoff")),
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    maxDrawdownDays: drawdownDays(trades),
    recoveryFactor: maxDd > 0 ? netProfit / maxDd : 0,
    trades: trades.length || num(after("Total trades")),
    winRate: trades.length ? wins / trades.length : NaN,
    largestLoss: num(after("loss trade")),
    maxConsecutiveLosses: num(after("consecutive losses (loss in money)")),
  };

  return {
    ea,
    server: serverName(html),
    symbol: (after("Symbol") ?? "").split(/\s+/)[0] ?? "",
    period: periodText.split(/\s{2,}/)[0]?.trim() ?? "",
    from: range ? parseTime(range[1]) : undefined,
    to: range ? parseTime(range[2]) : undefined,
    model,
    parameters: after("Parameters") ?? "",
    barsInTest: num(after("Bars in test")),
    ticksModelled: num(after("Ticks modelled")),
    deposit: num(after("Initial deposit")),
    spread: /current/i.test(spreadRaw) ? "current" : num(spreadRaw),
    metrics,
    trades,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// MT5
//
// The MT5 report differs from MT4's in three ways that matter here:
//
//  1. Labels end in a colon ("Total Net Profit:") and sit three to a row.
//  2. Money uses a SPACE as the thousands separator ("10 000.00"), so a naive
//     number grab reads "10" -- and a drawdown pair "2 000.00 (18.50%)" would
//     read as 2 and 0.
//  3. Trades are DEALS: an `in` deal opens size, an `out` deal closes it, and
//     the table does not say which position an `out` belongs to. Positions are
//     matched first-in-first-out per symbol and side, splitting partial closes,
//     which is exactly what a hedging account does and what a netting account's
//     single position reduces to.
//
// NOTE: the fixture for this parser is hand-written from MT5's report layout,
// not taken off a rig, because no MT5 test had been run when it was written.
// Replace __fixtures__/mt5-report.htm with a real report when one exists.
// ---------------------------------------------------------------------------

/** True when the report came out of the MT5 tester. */
export function isMt5Report(html: string): boolean {
  return /Total Deals|Equity Drawdown Maximal|Balance Drawdown Maximal/i.test(html);
}

/** Pick the parser by what the report is, not by what the run was meant to be. */
export function parseReport(html: string, hint?: { model?: string }): ParsedReport {
  return isMt5Report(html) ? parseMt5Report(html, hint) : parseMt4Report(html);
}

/** Join digits split by a thousands space: "10 000.00" -> "10000.00". */
const joinThousands = (s: string | undefined) => (s ?? "").replace(/(\d)[\s ]+(?=\d)/g, "$1");
const num5 = (s: string | undefined) => num(joinThousands(s));
const pair5 = (s: string | undefined) => pair(joinThousands(s));

interface OpenLeg { time: number; lots: number; commission: number; side: "buy" | "sell" }

export function parseMt5Report(html: string, hint?: { model?: string }): ParsedReport {
  const warnings: string[] = [];
  const rs = rows(html);

  /** The cell after a label, matched with or without its trailing colon. */
  const after = (label: string): string | undefined => {
    const want = label.toLowerCase().replace(/:$/, "");
    for (const r of rs) {
      for (let i = 0; i < r.length - 1; i++) {
        if (r[i].toLowerCase().replace(/:$/, "").trim() === want) return r[i + 1];
      }
    }
    return undefined;
  };

  const periodText = after("Period") ?? "";
  const range = periodText.match(
    /(\d{4}\.\d{2}\.\d{2}(?:\s+\d{2}:\d{2})?)\s*-\s*(\d{4}\.\d{2}\.\d{2}(?:\s+\d{2}:\d{2})?)/,
  );
  const day = (s: string) => parseTime(/\d{2}:\d{2}/.test(s) ? s : `${s} 00:00`);

  // --- model ---------------------------------------------------------------
  // "History Quality: 99% real ticks" names the model itself. Other modes give
  // only a percentage, so the mode the run asked for fills in the kind.
  const quality = after("History Quality") ?? "";
  const q = num(quality);
  const pct = Number.isFinite(q) ? q : 0;
  let model: ModelQuality;
  if (/real tick/i.test(quality)) model = { kind: "real-ticks" };
  else if (hint?.model === "open-prices") model = { kind: "open-prices", percent: pct };
  else if (hint?.model === "control-points") model = { kind: "control-points", percent: pct };
  else if (quality) model = { kind: "every-tick", percent: pct };
  else model = { kind: "unknown" };
  if (model.kind === "open-prices") {
    warnings.push("Open-prices model: this run cannot support any claim about intrabar behaviour.");
  } else if (model.kind === "control-points") {
    warnings.push("1-minute OHLC model: indicative only, not a test of intrabar behaviour.");
  } else if (model.kind === "every-tick" && pct < 90) {
    warnings.push(`History quality ${pct || "n/a"}% is below the 90% needed to trust the result.`);
  }

  // --- deals -----------------------------------------------------------------
  const hdr = rs.findIndex((r) => {
    const lower = r.map((c) => c.toLowerCase());
    return lower.includes("deal") && lower.includes("direction");
  });
  const trades: Trade[] = [];
  const book = new Map<string, OpenLeg[]>();   // symbol|side -> open legs, oldest first
  let unmatched = 0;

  if (hdr === -1) {
    warnings.push("No deal table found in the report.");
  } else {
    const cols = rs[hdr].map((c) => c.toLowerCase());
    const at = (n: string) => cols.indexOf(n);
    const [iTime, iSym, iType, iDir, iVol, iPrice, iComm, iSwap, iProfit, iBal] = [
      at("time"), at("symbol"), at("type"), at("direction"), at("volume"),
      at("price"), at("commission"), at("swap"), at("profit"), at("balance"),
    ];

    const open = (sym: string, side: "buy" | "sell", leg: OpenLeg) => {
      const key = `${sym}|${side}`;
      if (!book.has(key)) book.set(key, []);
      book.get(key)!.push(leg);
    };

    /** Close `lots` of the opposite side, FIFO; returns the volume it could not match. */
    const close = (
      sym: string, closingType: "buy" | "sell", lots: number, time: number, price: number,
      money: number, balance: number | undefined,
    ): number => {
      const side = closingType === "sell" ? "buy" : "sell";
      const legs = book.get(`${sym}|${side}`) ?? [];
      let left = lots;
      const total = lots;
      while (left > 1e-9 && legs.length) {
        const leg = legs[0];
        const take = Math.min(leg.lots, left);
        const share = take / total;
        const legShare = take / leg.lots;
        trades.push({
          openTime: leg.time,
          time,
          side,
          lots: Math.round(take * 100) / 100,
          price,
          profit: Math.round((money * share + leg.commission * legShare) * 100) / 100,
          // The balance after the deal belongs to the last piece of it.
          balance: left - take <= 1e-9 ? balance : undefined,
        });
        leg.commission -= leg.commission * legShare;
        leg.lots -= take;
        left -= take;
        if (leg.lots <= 1e-9) legs.shift();
      }
      return left;
    };

    for (const r of rs.slice(hdr + 1)) {
      const type = (r[iType] ?? "").toLowerCase();
      if (type !== "buy" && type !== "sell") continue;   // balance, credit, the totals row
      const dir = (r[iDir] ?? "").toLowerCase();
      const sym = r[iSym] ?? "";
      const time = parseTime(r[iTime] ?? "");
      const lots = num5(r[iVol]);
      const price = num5(r[iPrice]);
      const commission = num5(r[iComm]) || 0;
      const money = (num5(r[iProfit]) || 0) + (num5(r[iSwap]) || 0) + commission;
      const balRaw = num5(r[iBal]);
      const balance = Number.isFinite(balRaw) ? balRaw : undefined;
      if (!Number.isFinite(lots) || lots <= 0) continue;

      if (dir === "in") {
        open(sym, type, { time, lots, commission, side: type });
      } else if (dir === "out" || dir === "out by") {
        if (close(sym, type, lots, time, price, money, balance) > 1e-9) unmatched++;
      } else if (dir === "inout") {
        // A netting reversal: close what is held, open the remainder the other way.
        const held = (book.get(`${sym}|${type === "sell" ? "buy" : "sell"}`) ?? []).reduce((s, l) => s + l.lots, 0);
        const closing = Math.min(held, lots);
        if (closing > 0) close(sym, type, closing, time, price, money, balance);
        if (lots - closing > 1e-9) open(sym, type, { time, lots: lots - closing, commission: 0, side: type });
      }
    }
    if (unmatched) warnings.push(`${unmatched} closing deal(s) had no matching entry; their unmatched volume was skipped.`);
    const stillOpen = [...book.values()].reduce((n, legs) => n + legs.length, 0);
    if (stillOpen) warnings.push(`${stillOpen} position(s) still open at the end of the test.`);
  }

  // --- metrics ---------------------------------------------------------------
  const [maxDd, maxDdPct] = pair5(after("Equity Drawdown Maximal"));
  const netProfit = num5(after("Total Net Profit"));
  const wins = trades.filter((t) => t.profit > 0).length;
  const recovery = num5(after("Recovery Factor"));
  const sharpe = num5(after("Sharpe Ratio"));

  const metrics: RunMetrics = {
    netProfit,
    grossProfit: num5(after("Gross Profit")),
    grossLoss: num5(after("Gross Loss")),
    profitFactor: num5(after("Profit Factor")),
    expectedPayoff: num5(after("Expected Payoff")),
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
    maxDrawdownDays: drawdownDays(trades),
    recoveryFactor: Number.isFinite(recovery) ? recovery : maxDd > 0 ? netProfit / maxDd : 0,
    trades: num5(after("Total Trades")) || trades.length,
    winRate: trades.length ? wins / trades.length : NaN,
    largestLoss: num5(after("Largest loss trade")),
    maxConsecutiveLosses: pair5(after("Maximum consecutive losses ($)"))[0],
    ...(Number.isFinite(sharpe) ? { sharpe } : {}),
  };

  return {
    ea: after("Expert") ?? "",
    server: mt5Server(html),
    symbol: (after("Symbol") ?? "").split(/\s+/)[0] ?? "",
    period: periodText.split(/\s*\(/)[0]?.trim() ?? "",
    from: range ? day(range[1]) : undefined,
    to: range ? day(range[2]) : undefined,
    model,
    parameters: after("Inputs") ?? "",
    barsInTest: num5(after("Bars")),
    ticksModelled: num5(after("Ticks")),
    deposit: num5(after("Initial Deposit")),
    // MT5 tests on the spread recorded in the history, not a fixed setting.
    spread: "current",
    metrics,
    trades,
    warnings,
  };
}

/** The server: "Name (Build N)" when present, else the bold line under the report title. */
function mt5Server(html: string): string {
  const built = serverName(html);
  if (built) return built;
  const heading = html.search(/<b>\s*Strategy Tester Report\s*<\/b>/i);
  if (heading === -1) return "";
  const tail = html.slice(heading).replace(/^<b>[^<]*<\/b>/i, "");
  for (const m of tail.matchAll(/<b>([^<]{2,80})<\/b>/gi)) {
    const t = strip(m[1]);
    if (t && !/^\(?build/i.test(t)) return t;
  }
  return "";
}

/**
 * The server sits alone under the EA name, e.g. "Coinexx-Demo (Build 1443)" --
 * in a heading div ABOVE the tables, not in a cell, so this scans the whole
 * document rather than the parsed rows.
 */
function serverName(html: string): string {
  const m = html.match(/>\s*([^<>]{2,60}?)\s*\(Build\s*\d+\)\s*</i);
  return m ? m[1].trim() : "";
}

/** Longest stretch, in days, spent below a previous equity peak. */
function drawdownDays(trades: Trade[]): number {
  const withBalance = trades.filter((t) => typeof t.balance === "number");
  if (withBalance.length < 2) return 0;
  let peak = -Infinity;
  let peakAt = withBalance[0].time;
  let worst = 0;
  for (const t of withBalance) {
    const b = t.balance as number;
    if (b >= peak) {
      peak = b;
      peakAt = t.time;
    } else {
      worst = Math.max(worst, t.time - peakAt);
    }
  }
  return Math.round(worst / 86_400_000);
}

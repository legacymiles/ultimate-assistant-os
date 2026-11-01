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

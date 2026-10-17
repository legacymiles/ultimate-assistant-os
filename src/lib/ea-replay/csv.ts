// ---------------------------------------------------------------------------
// EA World › Replay — bring your own ticks.
//
// For when Dukascopy is unreachable, or you want to replay YOUR broker's feed
// (its spread is what your EA actually pays). Three layouts are understood:
//
//  1. Dukascopy CSV export      Time (UTC),Ask,Bid,AskVolume,BidVolume
//                               16.10.2026 12:00:00.123,1.17012,1.17010,…
//  2. MT5 tick export (Ctrl+U)  <DATE>\t<TIME>\t<BID>\t<ASK>\t<LAST>\t…
//                               2026.10.16\t15:00:00.123\t1.17010\t1.17012
//  3. Plain                     time,bid,ask   (ISO time or epoch ms/seconds)
//
// MT5 exports are in BROKER SERVER time, so the caller passes that offset in
// hours (most brokers: +3 in summer, +2 in winter). Rows with no bid or ask
// (MT5 writes blanks when only one side changed) carry the last known value.
// ---------------------------------------------------------------------------

import type { TickSeries } from "./types";

export interface CsvResult {
  series: TickSeries;
  layout: "dukascopy" | "mt5" | "plain";
  skipped: number;
}

function parseDukaTime(s: string): number {
  // 16.10.2026 12:00:00.123
  const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
  if (!m) return NaN;
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6], +(m[7] ?? "0").padEnd(3, "0"));
}

function parseMt5Time(d: string, t: string): number {
  const dm = d.trim().match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  const tm = t.trim().match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!dm || !tm) return NaN;
  return Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], +tm[3], +(tm[4] ?? "0").padEnd(3, "0"));
}

function parsePlainTime(s: string): number {
  const v = s.trim();
  if (/^\d{12,14}$/.test(v)) return Number(v);
  if (/^\d{9,11}(\.\d+)?$/.test(v)) return Number(v) * 1000;
  const iso = v.includes("T") || v.endsWith("Z") ? v : v.replace(" ", "T");
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z");
  return ms;
}

export function parseTickCsv(text: string, symbol: string, serverOffsetHours = 0): CsvResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) throw new Error("The file is empty");
  const head = lines[0];
  const isMt5 = /<DATE>/i.test(head);
  const isDuka = /time\s*\(utc\)/i.test(head) || /^\d{2}\.\d{2}\.\d{4}\s/.test(head);
  const layout: CsvResult["layout"] = isMt5 ? "mt5" : isDuka ? "dukascopy" : "plain";
  const sep = head.includes("\t") ? "\t" : head.includes(";") ? ";" : ",";
  const hasHeader = isMt5 || !/^\s*[\d"]/.test(head) || /time|bid|ask/i.test(head);
  const body = hasHeader ? lines.slice(1) : lines;

  // Column order for "plain": find bid/ask by header name when there is one.
  let tCol = 0;
  let bidCol = 1;
  let askCol = 2;
  if (layout === "plain" && hasHeader) {
    const cols = head.split(sep).map((c) => c.trim().toLowerCase().replace(/"/g, ""));
    const find = (re: RegExp, d: number) => {
      const i = cols.findIndex((c) => re.test(c));
      return i >= 0 ? i : d;
    };
    tCol = find(/time|date|timestamp/, 0);
    bidCol = find(/^bid/, 1);
    askCol = find(/^ask/, 2);
  }

  const time: number[] = [];
  const bid: number[] = [];
  const ask: number[] = [];
  let lastBid = NaN;
  let lastAsk = NaN;
  let skipped = 0;
  const offsetMs = serverOffsetHours * 3_600_000;

  for (const line of body) {
    const f = line.split(sep).map((x) => x.replace(/"/g, ""));
    let t: number;
    let b: number;
    let a: number;
    if (layout === "mt5") {
      t = parseMt5Time(f[0] ?? "", f[1] ?? "") - offsetMs;
      b = f[2]?.trim() ? Number(f[2]) : lastBid;
      a = f[3]?.trim() ? Number(f[3]) : lastAsk;
    } else if (layout === "dukascopy") {
      t = parseDukaTime(f[0] ?? "");
      a = Number(f[1]);
      b = Number(f[2]);
    } else {
      t = parsePlainTime(f[tCol] ?? "") - offsetMs;
      b = Number(f[bidCol]);
      a = Number(f[askCol]);
    }
    if (!Number.isFinite(t) || !(b > 0) || !(a > 0)) {
      skipped++;
      continue;
    }
    lastBid = b;
    lastAsk = a;
    if (time.length && t < time[time.length - 1]) {
      skipped++;
      continue; // out-of-order rows would make the replay walk backwards
    }
    time.push(t);
    bid.push(Math.min(b, a));
    ask.push(Math.max(b, a));
  }
  if (!time.length) throw new Error("No usable rows — expected time, bid and ask columns");

  return {
    layout,
    skipped,
    series: {
      symbol,
      time: Float64Array.from(time),
      bid: Float64Array.from(bid),
      ask: Float64Array.from(ask),
      source: "csv",
      note: `CSV (${layout}) · ${time.length.toLocaleString()} ticks${skipped ? ` · ${skipped} rows skipped` : ""}`,
    },
  };
}

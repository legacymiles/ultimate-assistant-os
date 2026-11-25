// ---------------------------------------------------------------------------
// MT4 / MT5 Expert Advisor static analyzer — PURE.
//
// Reads MQL4/MQL5 source TEXT and says what kind of bot it is, how it manages
// risk, whether its signals can repaint or peek into the future, and whether
// it does anything unsafe (DLL imports, shell calls, network exfiltration,
// account locks, time bombs, obfuscation). Every flag carries evidence — the
// line number and the line itself — so a score is never a black box.
//
// It never runs, compiles or ports the code, and it never claims a bot is
// profitable: the scores measure code quality, backtest reliability, trading
// risk and strategy soundness as far as the TEXT shows, nothing more.
//
// No I/O. Deterministic: same text in, same analysis out. Tests: analyze.test.ts.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

export type Severity = "info" | "warn" | "danger";

export interface Evidence {
  line: number;
  text: string;
}

export interface Mt4Flag {
  id: string;
  severity: Severity;
  label: string;
  evidence: Evidence[];
}

export interface Mt4Input {
  name: string;
  type: string;
  default: string | null;
}

export interface Mt4Risk {
  /** Order calls found (OrderSend, CTrade.Buy/Sell/…, PositionOpen, request.sl…). */
  orderCalls: number;
  /** Every order gets a stop loss (in the call, or set right after via OrderModify / PositionModify). */
  hasStopLoss: boolean;
  /** Order calls whose stop-loss argument is a literal 0. */
  ordersWithoutStopLoss: number;
  /** A StopLoss input exists but defaults to 0 (off). */
  stopLossDefaultOff: boolean;
  hasTakeProfit: boolean;
  hasTrailingStop: boolean;
  /** Checks equity / drawdown against a limit and acts on it. */
  hasEquityGuard: boolean;
  /** Caps the number of open orders / grid levels. */
  hasMaxOrders: boolean;
  lotSizing: "fixed" | "percent-risk" | "balance-scaled" | "unknown";
  hasSpreadCheck: boolean;
  hasSlippage: boolean;
  hasMagicNumber: boolean;
  hasErrorHandling: boolean;
  hasNewBarCheck: boolean;
  usesDll: boolean;
  networkAccess: boolean;
  accountLock: boolean;
  brokerLock: boolean;
  timeBomb: boolean;
  testerDetection: boolean;
  obfuscated: boolean;
  decompiled: boolean;
}

export interface Mt4Score {
  value: number;
  why: string[];
}

export type Mt4Language = "mql4" | "mql5" | "compiled" | "unknown";
export type Mt4ProgramKind = "expert" | "indicator" | "script" | "library" | "include" | "unknown";

export interface Mt4Analysis {
  language: Mt4Language;
  programKind: Mt4ProgramKind;
  lines: number;
  /** Strategy families detected, e.g. ["martingale", "grid", "trend-following"]. */
  strategy: string[];
  /** Built-in / custom indicator calls seen, e.g. ["iMA", "iRSI"]. */
  indicators: string[];
  flags: Mt4Flag[];
  risk: Mt4Risk;
  scores: { quality: Mt4Score; reliability: Mt4Score; risk: Mt4Score; strategy: Mt4Score };
  verdict: string;
  /** sha256 of the source with comments and all whitespace removed. Same code ⇒ same fingerprint. */
  fingerprint: string;
  /** sha256 of (name + sorted input names): survives code edits, links versions of one bot. */
  lineage: string;
  name: string | null;
  version: string | null;
  copyright: string | null;
  link: string | null;
  description: string | null;
  inputs: Mt4Input[];
}

export interface AnalyzeOptions {
  fileName?: string;
}

// --- text plumbing ----------------------------------------------------------

/**
 * One pass over the source: `code` has comments blanked to spaces (strings
 * kept), `bare` additionally blanks string/char literal CONTENTS. Both keep
 * every character's offset and every newline, so an index in either maps to
 * the same line of the original.
 */
export function stripSource(src: string): { code: string; bare: string } {
  const code: string[] = [];
  const bare: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") {
        code.push(" ");
        bare.push(" ");
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      code.push("  ");
      bare.push("  ");
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        const ch = src[i] === "\n" ? "\n" : " ";
        code.push(ch);
        bare.push(ch);
        i++;
      }
      if (i < n) {
        code.push("  ");
        bare.push("  ");
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      code.push(q);
      bare.push(q);
      i++;
      while (i < n && src[i] !== q && src[i] !== "\n") {
        if (src[i] === "\\" && i + 1 < n && src[i + 1] !== "\n") {
          code.push(src[i], src[i + 1]);
          bare.push(" ", " ");
          i += 2;
          continue;
        }
        code.push(src[i]);
        bare.push(" ");
        i++;
      }
      if (i < n && src[i] === q) {
        code.push(q);
        bare.push(q);
        i++;
      }
      continue;
    }
    code.push(c);
    bare.push(c);
    i++;
  }
  return { code: code.join(""), bare: bare.join("") };
}

/** Source with comments and every whitespace character removed — what the fingerprint hashes. */
export function normalizeSource(src: string): string {
  return stripSource(src.replace(/\r\n?/g, "\n")).code.replace(/\s+/g, "");
}

export function fingerprintOf(src: string): string {
  return createHash("sha256").update(normalizeSource(src)).digest("hex");
}

class Doc {
  readonly orig: string[];
  readonly code: string;
  readonly bare: string;
  private readonly starts: number[];

  constructor(src: string) {
    const text = src.replace(/\r\n?/g, "\n");
    this.orig = text.split("\n");
    const s = stripSource(text);
    this.code = s.code;
    this.bare = s.bare;
    this.starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") this.starts.push(i + 1);
  }

  lineOf(index: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  ev(index: number): Evidence {
    const line = this.lineOf(index);
    return { line, text: (this.orig[line - 1] ?? "").trim().slice(0, 160) };
  }

  /** Every match of `re` (made global) in the comment-free, string-blank text. */
  find(re: RegExp, where: "bare" | "code" = "bare"): { index: number; m: RegExpExecArray }[] {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    const text = where === "bare" ? this.bare : this.code;
    const out: { index: number; m: RegExpExecArray }[] = [];
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) {
      out.push({ index: m.index, m });
      if (m[0].length === 0) g.lastIndex++;
      if (out.length > 500) break;
    }
    return out;
  }

  /** Evidence lines for matches, one per line, at most `max`. */
  evidence(re: RegExp, where: "bare" | "code" = "bare", max = 5): Evidence[] {
    return dedupe(this.find(re, where).map((h) => this.ev(h.index)), max);
  }

  /**
   * Arguments of the call whose "(" is at `open` (in `code`), split on
   * top-level commas. Null when the parens never close.
   */
  args(open: number): string[] | null {
    const t = this.code;
    if (t[open] !== "(") return null;
    let depth = 0;
    let cur = "";
    const out: string[] = [];
    let inStr: string | null = null;
    for (let i = open; i < t.length && i < open + 4000; i++) {
      const ch = t[i];
      if (inStr) {
        cur += ch;
        if (ch === "\\") {
          cur += t[i + 1] ?? "";
          i++;
        } else if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = ch;
        cur += ch;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") {
        depth++;
        if (depth === 1 && ch === "(") continue;
      } else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) {
          out.push(cur.trim());
          return out;
        }
      } else if (ch === "," && depth === 1) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    return null;
  }
}

function dedupe(evs: Evidence[], max: number): Evidence[] {
  const seen = new Set<number>();
  const out: Evidence[] = [];
  for (const e of [...evs].sort((a, b) => a.line - b.line)) {
    if (seen.has(e.line)) continue;
    seen.add(e.line);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

function isZeroLiteral(arg: string | undefined): boolean {
  if (arg === undefined) return false;
  return /^\(?\s*(0+(\.0*)?|0?\.0+|NULL|EMPTY_VALUE\s*\*\s*0)\s*\)?$/i.test(arg.trim());
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

// --- metadata ---------------------------------------------------------------

function propertyOf(doc: Doc, name: string): string | null {
  const re = new RegExp(`^\\s*#property\\s+${name}\\s+"([^"]*)"`, "m");
  const m = re.exec(doc.code);
  return m ? m[1].trim() || null : null;
}

export function parseInputs(doc: Doc): Mt4Input[] {
  const out: Mt4Input[] = [];
  const re = /^[ \t]*(?:extern|input|sinput)\s+(?:const\s+)?([A-Za-z_][\w]*)\s+([A-Za-z_][\w]*)\s*(?:=\s*([^;]+?))?\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc.code))) {
    out.push({ type: m[1], name: m[2], default: m[3]?.trim() ?? null });
    if (out.length >= 300) break;
  }
  return out;
}

function detectLanguage(doc: Doc, fileName?: string): Mt4Language {
  const ext = (fileName ?? "").toLowerCase().match(/\.(mq4|mq5|mqh|ex4|ex5)$/)?.[1];
  if (ext === "mq4") return "mql4";
  if (ext === "mq5") return "mql5";
  if (ext === "ex4" || ext === "ex5") return "compiled";
  const b = doc.bare;
  let five = 0;
  let four = 0;
  if (/\bCTrade\b|#include\s*<Trade\\/.test(doc.code)) five += 3;
  if (/\b(MqlTradeRequest|MqlTradeResult|MqlTick|CopyBuffer|PositionSelect|PositionGetDouble|PositionsTotal|HistoryDealGetDouble|SymbolInfoDouble|ENUM_TIMEFRAMES|OnTradeTransaction)\b/.test(b)) five += 2;
  if (/\b(OrderSelect\s*\([^)]*MODE_TRADES|OP_BUY|OP_SELL|MODE_TRADES|MODE_HISTORY|OrderLots|OrderOpenPrice|AccountBalance\s*\(|MarketInfo|RefreshRates)\b/.test(b)) four += 2;
  if (/#property\s+strict/.test(doc.code)) four += 2;
  if (/\bint\s+start\s*\(\s*\)/.test(b)) four += 2;
  if (five > four) return "mql5";
  if (four > 0) return "mql4";
  if (five > 0) return "mql5";
  return "unknown";
}

function detectKind(doc: Doc, fileName?: string): Mt4ProgramKind {
  const c = doc.code;
  if (/\.mqh$/i.test(fileName ?? "")) return "include";
  if (/#property\s+library/.test(c)) return "library";
  if (/#property\s+indicator_|\bOnCalculate\s*\(/.test(c)) return "indicator";
  if (/\bOnStart\s*\(/.test(c)) return "script";
  if (/\bOnTick\s*\(|\bint\s+start\s*\(/.test(c)) return "expert";
  return "unknown";
}

/** Looks like a compiled binary handed over as text (NULs / EX-4 header / mostly unprintable). */
export function looksCompiled(text: string): boolean {
  if (!text) return false;
  if (text.includes("\u0000")) return true;
  const sample = text.slice(0, 4000);
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code < 9 || (code > 13 && code < 32) || code === 0xfffd) bad++;
  }
  return bad / Math.max(1, sample.length) > 0.1;
}

// --- the analyzer -----------------------------------------------------------

const INDICATORS = [
  "iMA", "iRSI", "iMACD", "iBands", "iStochastic", "iCCI", "iATR", "iADX", "iCustom", "iIchimoku", "iSAR",
  "iMomentum", "iEnvelopes", "iFractals", "iWPR", "iDeMarker", "iOsMA", "iAO", "iAC", "iForce", "iMFI", "iOBV",
  "iRVI", "iStdDev", "iBearsPower", "iBullsPower", "iAlligator", "iGator", "iBWMFI", "iVolumes",
];
const TREND = new Set(["iMA", "iMACD", "iADX", "iSAR", "iIchimoku", "iAlligator", "iGator", "iOsMA", "iEnvelopes"]);
const OSC = new Set(["iRSI", "iStochastic", "iCCI", "iWPR", "iDeMarker", "iMFI", "iBands", "iRVI", "iMomentum"]);
const PRICE_SERIES_FN = ["iClose", "iOpen", "iHigh", "iLow", "iTime", "iVolume"];
const SYSTEM_DLLS = /\b(kernel32|shell32|wininet|user32|urlmon|ws2_32|advapi32|ntdll|msvcrt|winhttp|psapi|crypt32)\b/i;

export function analyzeMq(source: string, opts: AnalyzeOptions = {}): Mt4Analysis {
  if (/\.(ex4|ex5)$/i.test(opts.fileName ?? "") || looksCompiled(source)) {
    return compiledOnlyAnalysis(opts.fileName ?? "compiled file");
  }
  const doc = new Doc(source);
  const flags: Mt4Flag[] = [];
  const flag = (id: string, severity: Severity, label: string, evidence: Evidence[]) => {
    flags.push({ id, severity, label, evidence });
  };
  const has = (re: RegExp, where: "bare" | "code" = "bare") => new RegExp(re.source, re.flags.replace("g", "")).test(where === "bare" ? doc.bare : doc.code);

  const language = detectLanguage(doc, opts.fileName);
  const programKind = detectKind(doc, opts.fileName);
  const inputs = parseInputs(doc);
  const inputNamed = (re: RegExp) => inputs.filter((i) => re.test(i.name));
  const strategy: string[] = [];

  // ---- strategy families ----------------------------------------------------
  const martEv = dedupe(
    [
      ...doc.evidence(/\b(LotExponent|Lots?_?Multipl\w*|Lots?Mult\w*|MultiLot\w*|Martingale\w*|Martin\w*|LotFactor|KLot|XLot|Exponent)\b/i),
      ...doc.find(/\bMultiplier\b/i).filter((h) => /lot/i.test(doc.orig[doc.lineOf(h.index) - 1] ?? "")).map((h) => doc.ev(h.index)),
      ...doc.evidence(/\b\w*lots?\w*\s*\*=\s*[^;]+/i),
      ...doc.evidence(/\b\w*lots?\w*\s*=\s*[^;]*\b(OrderLots\s*\(\s*\)|PositionGetDouble\s*\(\s*POSITION_VOLUME\s*\)|\w*(last|prev)\w*lots?\w*)\s*\*\s*[\w.]+/i),
      ...doc.evidence(/\bMathPow\s*\(\s*\w*(exp|mult|factor|martin)\w*/i),
    ].sort((a, b) => a.line - b.line),
    5,
  );
  const afterLoss = doc.evidence(/\b(OrderProfit\s*\(\s*\)|PositionGetDouble\s*\(\s*POSITION_PROFIT\s*\)|HistoryDealGetDouble\s*\([^)]*DEAL_PROFIT\s*\))\s*<\s*0|\b(consecutive|last)\w*loss\w*/i, "bare", 2);
  if (martEv.length) {
    strategy.push("martingale");
    flag(
      "martingale",
      "warn",
      afterLoss.length ? "Martingale: lot size multiplies after losing trades" : "Martingale: lot size multiplies as positions are added",
      dedupe([...martEv, ...afterLoss], 6),
    );
  }

  const gridInputs = inputNamed(/^(Grid\w*|PipStep|Pip_?Step\w*|Step|StepPips|Step_?Points?|StepSize|LevelStep|OrderStep|Distance(Pips|Points)?|Pips?Distance)$/i);
  const gridEv = dedupe(
    [
      ...gridInputs.flatMap((inp) => doc.evidence(new RegExp(`\\b(extern|input|sinput)\\b[^;]*\\b${inp.name}\\b`), "code", 1)),
      ...doc.evidence(/\b(Ask|Bid|OrderOpenPrice\s*\(\s*\)|\w*price\w*)\s*[-+]\s*\(?\s*\w*(step|grid)\w*\s*\*?/i),
      ...doc.evidence(/\bGrid\w*\b/),
    ].sort((a, b) => a.line - b.line),
    5,
  );
  if (gridEv.length) {
    strategy.push("grid");
    const pend = doc.evidence(/\b(OP_BUYLIMIT|OP_SELLLIMIT|OP_BUYSTOP|OP_SELLSTOP|ORDER_TYPE_BUY_LIMIT|ORDER_TYPE_SELL_LIMIT|ORDER_TYPE_BUY_STOP|ORDER_TYPE_SELL_STOP|BuyLimit|SellLimit|BuyStop|SellStop)\b/, "bare", 2);
    flag("grid", "warn", "Grid: opens orders at fixed price steps", dedupe([...gridEv, ...pend], 6));
  }

  const avgEv = doc.evidence(/\b(Averag\w*|DCA|AvgPrice|BreakEvenPrice|BE_?Price)\b|\+=\s*OrderOpenPrice\s*\(\s*\)\s*\*\s*OrderLots|OrderLots\s*\(\s*\)\s*\*\s*OrderOpenPrice/i);
  if (avgEv.length) {
    strategy.push("averaging");
    flag("averaging", "warn", "Averaging / DCA: adds to positions and exits on an averaged price", avgEv);
  }

  const hedgeEv = doc.evidence(/\b\w*hedg\w*\b|ACCOUNT_MARGIN_MODE_RETAIL_HEDGING/i);
  if (hedgeEv.length) {
    strategy.push("hedging");
    flag("hedging", "info", "Hedging: holds opposite positions at once", hedgeEv);
  }

  const tinyTp = inputs.filter((i) => /^(TakeProfit|TP|Take_?Profit)\w*$/i.test(i.name) && i.default !== null && Number(i.default) > 0 && Number(i.default) <= 10);
  const scalpEv = dedupe(
    [
      ...doc.evidence(/\bscalp\w*\b|\bHFT\b|\bSymbolInfoTick\b|\bMqlTick\b|\bGetTickCount\b|\bTicks?Count\w*\b|\bVolume\s*\[\s*0\s*\]/i),
      ...tinyTp.flatMap((i) => doc.evidence(new RegExp(`\\b${i.name}\\b\\s*=`), "code", 1)),
    ].sort((a, b) => a.line - b.line),
    5,
  );
  if (scalpEv.length) {
    strategy.push("scalping");
    flag("scalping", "info", "Scalping / tick-driven: tiny targets or tick-level logic (backtests on modelled ticks are unreliable)", scalpEv);
  }

  const indicators = INDICATORS.filter((fn) => has(new RegExp(`\\b${fn}\\s*\\(`)));
  if (indicators.some((i) => TREND.has(i))) strategy.push("trend-following");
  if (indicators.some((i) => OSC.has(i))) strategy.push("oscillator / mean-reversion");
  if (indicators.includes("iCustom")) strategy.push("custom-indicator");
  if (indicators.length) {
    flag("indicators", "info", `Indicator signals: ${indicators.join(", ")}`, doc.evidence(new RegExp(`\\b(${indicators.join("|")})\\s*\\(`), "bare", 4));
  }
  const breakoutEv = doc.evidence(/\bbreak_?out\w*\b|\biHighest\s*\(|\biLowest\s*\(/i, "bare", 3);
  if (breakoutEv.length) strategy.push("breakout");

  const newsEv = doc.evidence(/\b\w*news\w*\b|\bFFCal\b|\bForexFactory\b|\bCalendarValue\w*\b/i, "bare", 3);
  if (newsEv.length) {
    strategy.push("news-filter");
    flag("news-filter", "info", "News filter (depends on an outside calendar; cannot be reproduced in a backtest)", newsEv);
  }
  const timeEv = doc.evidence(/\b(TimeHour|Hour|TimeDayOfWeek|DayOfWeek|TimeMinute)\s*\(|\b(Start_?Hour|End_?Hour|Start_?Time|End_?Time|TradingHours|Session\w*|TimeToStruct|MqlDateTime)\b/i, "bare", 3);
  if (timeEv.length) {
    strategy.push("time-filter");
    flag("time-filter", "info", "Trading-hours / weekday filter", timeEv);
  }
  if (!strategy.filter((s) => s !== "time-filter" && s !== "news-filter").length) strategy.push("unclassified");

  // ---- repainting / look-ahead ---------------------------------------------
  const newBarEv = doc.evidence(/(\bTime\s*\[\s*0\s*\]|\biTime\s*\([^;]*?,\s*0\s*\))\s*[!=<>]=?|[!=<>]=?\s*(\bTime\s*\[\s*0\s*\]|\biTime\s*\()|\b(is)?new_?bar\w*\b|\bstatic\s+datetime\b|\bBars\s*[!<>]=?|\b\w*(last|prev)\w*bar\w*time\w*\b/i, "bare", 2);
  const hasNewBarCheck = newBarEv.length > 0;
  const shift0: Evidence[] = [];
  const custom0: Evidence[] = [];
  const negShift: Evidence[] = [];
  const fractal: Evidence[] = [];
  if (language !== "mql5") {
    for (const fn of [...INDICATORS, ...PRICE_SERIES_FN]) {
      for (const h of doc.find(new RegExp(`\\b${fn}\\s*\\(`))) {
        const open = doc.code.indexOf("(", h.index);
        const a = doc.args(open);
        if (!a || !a.length) continue;
        const last = a[a.length - 1];
        if (/^-\s*\d/.test(last)) negShift.push(doc.ev(h.index));
        else if (fn === "iFractals" && /^[012]$/.test(last)) fractal.push(doc.ev(h.index));
        else if (last === "0" && fn === "iCustom") custom0.push(doc.ev(h.index));
        else if (last === "0" && INDICATORS.includes(fn)) shift0.push(doc.ev(h.index));
      }
    }
  } else {
    for (const h of doc.find(/\bCopyBuffer\s*\(/)) {
      const a = doc.args(doc.code.indexOf("(", h.index));
      if (a && a[2] !== undefined) {
        if (/^-\s*\d/.test(a[2])) negShift.push(doc.ev(h.index));
        else if (a[2] === "0") shift0.push(doc.ev(h.index));
      }
    }
  }
  negShift.push(...doc.evidence(/\b(Close|Open|High|Low|Time|Volume)\s*\[\s*-\s*\d+\s*\]/));
  if (negShift.length) flag("future-leak", "danger", "Look-ahead: reads a bar with a negative shift (data from the future)", dedupe(negShift, 5));
  const iMinus = doc.evidence(/\b(Close|Open|High|Low|Time)\s*\[\s*[a-z_]\w*\s*-\s*\d+\s*\]/i, "bare", 3);
  if (iMinus.length) flag("possible-lookahead", "warn", "Possible look-ahead: series[i-N] reads a NEWER bar than bar i", iMinus);
  if (custom0.length) flag("icustom-current-bar", "warn", "iCustom read on the forming bar (shift 0): custom indicators often repaint", dedupe(custom0, 4));
  const zz = doc.evidence(/zig_?zag/i, "code", 3);
  if (zz.length) flag("zigzag", "warn", "Uses ZigZag, which repaints by design — signals in history look better than they were live", zz);
  if (fractal.length) flag("fractals-repaint", "warn", "Reads iFractals on the last 2 bars — fractals are confirmed only 2 bars later", dedupe(fractal, 3));
  if (shift0.length) {
    flag(
      "current-bar-signal",
      hasNewBarCheck ? "info" : "warn",
      hasNewBarCheck
        ? "Reads indicators on the forming bar (shift 0), but only once per new bar"
        : "Signals from the forming bar (shift 0) on every tick — can flip intrabar, backtest ≠ live",
      dedupe(shift0, 4),
    );
  }

  // ---- order calls: stop loss / take profit / slippage ----------------------
  let orderCalls = 0;
  let noSl = 0;
  let withTp = 0;
  let slippageSet = false;
  const noSlEv: Evidence[] = [];
  const pushOrder = (index: number, sl: string | undefined, tp: string | undefined) => {
    orderCalls++;
    if (isZeroLiteral(sl) || sl === undefined) {
      noSl++;
      noSlEv.push(doc.ev(index));
    }
    if (tp !== undefined && !isZeroLiteral(tp)) withTp++;
  };
  for (const h of doc.find(/\bOrderSend\s*\(/)) {
    const a = doc.args(doc.code.indexOf("(", h.index));
    if (!a) continue;
    if (a.length >= 7) {
      pushOrder(h.index, a[5], a[6]);
      if (!isZeroLiteral(a[4])) slippageSet = true;
    } else if (a.length <= 2) {
      // MQL5 OrderSend(request, result): judged by request.sl / request.tp below.
      orderCalls++;
    }
  }
  for (const h of doc.find(/\b\w+\s*\.\s*(Buy|Sell|BuyLimit|SellLimit|BuyStop|SellStop)\s*\(/)) {
    const a = doc.args(doc.code.indexOf("(", h.index));
    if (!a) continue;
    pushOrder(h.index, a[3], a[4]);
  }
  for (const h of doc.find(/\b\w+\s*\.\s*PositionOpen\s*\(/)) {
    const a = doc.args(doc.code.indexOf("(", h.index));
    if (!a) continue;
    pushOrder(h.index, a[4], a[5]);
  }
  const reqSl = doc.find(/\.\s*sl\s*=\s*([^;]+);/);
  const reqTp = doc.find(/\.\s*tp\s*=\s*([^;]+);/);
  if (reqTp.some((h) => !isZeroLiteral(h.m[1]))) withTp++;
  const reqSlSet = reqSl.some((h) => !isZeroLiteral(h.m[1]));
  // Stops set right after the order (ECN style) or trailed later.
  const modifySl = doc.find(/\bOrderModify\s*\(/).some((h) => {
    const a = doc.args(doc.code.indexOf("(", h.index));
    return !!a && a.length >= 3 && !isZeroLiteral(a[2]) && !/OrderStopLoss\s*\(\s*\)/.test(a[2]);
  }) || doc.find(/\b\w+\s*\.\s*PositionModify\s*\(/).some((h) => {
    const a = doc.args(doc.code.indexOf("(", h.index));
    return !!a && a.length >= 2 && !isZeroLiteral(a[1]);
  });
  if (doc.find(/\bOrderSend\s*\(/).some((h) => (doc.args(doc.code.indexOf("(", h.index)) ?? []).length <= 2) && !reqSlSet && !modifySl) {
    noSl++;
    noSlEv.push(...doc.evidence(/\bOrderSend\s*\(/, "bare", 2));
  }
  const slInputs = inputNamed(/^(Stop_?Loss|SL|StopLoss\w*|SL_?Pips|SL_?Points)$/i);
  const stopLossDefaultOff = slInputs.length > 0 && slInputs.every((i) => isZeroLiteral(i.default ?? undefined));
  const hasStopLoss = orderCalls > 0 && (noSl === 0 || modifySl || reqSlSet);
  if (orderCalls > 0 && !hasStopLoss) {
    flag("no-stop-loss", "danger", "Orders are sent with no stop loss (SL = 0) and none is set later", dedupe(noSlEv, 5));
  } else if (stopLossDefaultOff) {
    flag("stop-loss-off-by-default", "warn", "Stop loss exists but its input defaults to 0 (off)", dedupe(slInputs.flatMap((i) => doc.evidence(new RegExp(`\\b${i.name}\\b\\s*=`), "code", 1)), 3));
  }
  const tpInputs = inputNamed(/^(Take_?Profit|TP)\w*$/i).filter((i) => !isZeroLiteral(i.default ?? undefined));
  const hasTakeProfit = withTp > 0 || tpInputs.length > 0 || (has(/\bOrderClose\s*\([^;]*\)/) && has(/\bprofit\w*\s*>=?/i));
  const hasTrailingStop = has(/\btrail\w*/i);
  if (!slippageSet) slippageSet = has(/\bSlippage\b|\bSetDeviationInPoints\s*\(|\.deviation\s*=/i);

  // ---- money management -------------------------------------------------------
  const equityEv = doc.evidence(
    /\b(Max_?(Draw_?Down|DD|Loss\w*)\w*|Equity_?(Stop|Protect\w*|Guard|Limit|Risk|SL|Min)\w*|Stop_?Out\w*|Daily_?Loss\w*|Total_?Loss\w*|Kill_?Switch)\b|\b(AccountEquity\s*\(\s*\)|AccountInfoDouble\s*\(\s*ACCOUNT_EQUITY\s*\))\s*[<>]=?|[<>]=?\s*(AccountEquity\s*\(\s*\)|AccountInfoDouble\s*\(\s*ACCOUNT_EQUITY\s*\))|\b(AccountProfit\s*\(\s*\)|ACCOUNT_PROFIT\s*\))\s*<=?\s*-/i,
    "bare",
    3,
  );
  const hasEquityGuard = equityEv.length > 0;
  const maxOrdEv = doc.evidence(/\bMax_?(Orders?|Trades?|Positions?|Open_?Trades?|Levels?|Grid\w*|Steps?|Count)\w*\b|\b(OrdersTotal|PositionsTotal|\w*Count\w*)\s*\(\s*\)\s*(<|>=)\s*\w+/i, "bare", 3);
  const hasMaxOrders = maxOrdEv.length > 0;
  const riskInputs = inputNamed(/^(Risk\w*|Max_?Risk\w*|Risk_?Percent\w*|Percent\w*Risk|AutoLot\w*|MM|Money_?Management)$/i);
  const balanceLot = doc.evidence(/\b\w*lots?\w*\s*=\s*[^;]*\b(AccountBalance|AccountEquity|AccountFreeMargin)\s*\(|\b\w*lots?\w*\s*=\s*[^;]*\b(ACCOUNT_BALANCE|ACCOUNT_EQUITY|ACCOUNT_MARGIN_FREE)\b/i, "bare", 2);
  const lotSizing: Mt4Risk["lotSizing"] = riskInputs.length && balanceLot.length
    ? "percent-risk"
    : balanceLot.length
      ? "balance-scaled"
      : riskInputs.length
        ? "percent-risk"
        : inputNamed(/^(Lots?|Lot_?Size|Fixed_?Lots?|Volume|StartLots?|Initial_?Lots?|First_?Lots?|BaseLots?)$/i).length
          ? "fixed"
          : "unknown";
  const hasSpreadCheck = has(/\bMODE_SPREAD\b|\bSYMBOL_SPREAD\b|\bMax_?Spread\w*\b|\(\s*Ask\s*-\s*Bid\s*\)|\bspread\w*\s*[<>]/i);
  const hasMagicNumber = has(/\bMagic\w*\b|\bOrderMagicNumber\s*\(|\bSetExpertMagicNumber\s*\(/i);
  const hasErrorHandling = has(/\bGetLastError\s*\(|\bResultRetcode\s*\(|\.retcode\b/);

  if (orderCalls > 0 && !hasEquityGuard) {
    const severe = strategy.includes("martingale") || strategy.includes("grid") || strategy.includes("averaging");
    flag("no-equity-guard", severe ? "danger" : "warn", severe ? "No equity / drawdown stop on a martingale-grid style EA — one trend can wipe the account" : "No equity or drawdown guard", []);
  }
  if ((strategy.includes("martingale") || strategy.includes("grid")) && !hasMaxOrders) {
    flag("no-max-orders", "warn", "No cap on open orders / grid levels", []);
  }
  if (strategy.includes("scalping") && !hasSpreadCheck) flag("no-spread-check", "warn", "Scalper with no maximum-spread check", []);

  // ---- suspicious / unsafe ----------------------------------------------------
  const imports = doc.find(/^\s*#import\s+"([^"]+)"/m, "code");
  const sysDll = imports.filter((h) => SYSTEM_DLLS.test(h.m[1]));
  const otherDll = imports.filter((h) => /\.dll$/i.test(h.m[1]) && !SYSTEM_DLLS.test(h.m[1]));
  const exImports = imports.filter((h) => /\.(ex4|ex5)$/i.test(h.m[1]));
  if (sysDll.length) flag("dll-system", "danger", `Imports Windows system DLLs (${[...new Set(sysDll.map((h) => h.m[1]))].join(", ")}) — can touch files, network and processes outside MT4`, dedupe(sysDll.map((h) => doc.ev(h.index)), 5));
  if (otherDll.length) flag("dll-import", "warn", `Imports a custom DLL (${[...new Set(otherDll.map((h) => h.m[1]))].join(", ")}) — its code is not in this source`, dedupe(otherDll.map((h) => doc.ev(h.index)), 5));
  if (exImports.length) flag("compiled-library", "warn", "Imports a compiled .ex4/.ex5 library — that part cannot be verified", dedupe(exImports.map((h) => doc.ev(h.index)), 3));
  const shellEv = doc.evidence(/\b(ShellExecute\w*|WinExec|CreateProcess\w*|system)\s*\(/);
  if (shellEv.length) flag("shell-exec", "danger", "Runs programs on the computer (ShellExecute / WinExec / CreateProcess)", shellEv);
  const inetEv = doc.evidence(/\b(InternetOpen\w*|InternetConnect\w*|HttpOpenRequest\w*|HttpSendRequest\w*|InternetReadFile|URLDownloadToFile\w*|WinHttp\w+)\s*\(/);
  const accountReadEv = doc.evidence(/\b(AccountNumber|AccountName|AccountServer|AccountCompany|TerminalPath|TerminalInfoString|AccountInfoInteger\s*\(\s*ACCOUNT_LOGIN|AccountInfoString)\b/, "bare", 2);
  if (inetEv.length) flag("internet-dll", "danger", "Raw internet calls through a DLL (possible data exfiltration or remote control)", inetEv);
  const webEv = doc.evidence(/\b(WebRequest|SocketCreate|SocketConnect)\s*\(/);
  if (webEv.length) {
    const exfil = accountReadEv.length > 0;
    flag("web-request", exfil ? "danger" : "warn", exfil ? "WebRequest in an EA that also reads account/terminal details — could send them out" : "Calls WebRequest (needs URL allow-listing; sends/receives data online)", dedupe([...webEv, ...(exfil ? accountReadEv : [])], 5));
  }
  const mailEv = doc.evidence(/\b(SendMail|SendFTP)\s*\(/);
  if (mailEv.length) flag("send-mail-ftp", "warn", "Sends e-mail / FTP from the terminal", mailEv);
  const notifEv = doc.evidence(/\bSendNotification\s*\(/, "bare", 2);
  if (notifEv.length) flag("push-notification", "info", "Sends push notifications", notifEv);
  const fileOuts = doc.find(/\bFileOpen\w*\s*\(\s*"([^"]*)"/, "code").filter((h) => /^[a-z]:[\\/]|\\\\|\.\.[\\/]/i.test(h.m[1]));
  if (fileOuts.length) flag("file-outside-sandbox", "danger", "Opens files outside the MQL Files sandbox", dedupe(fileOuts.map((h) => doc.ev(h.index)), 3));
  const fileWrite = doc.evidence(/\b(FileWrite\w*|FileOpen\w*)\s*\(/, "bare", 2);
  if (fileWrite.length && !fileOuts.length) flag("file-io", "info", "Reads/writes files in the MQL Files folder", fileWrite);
  const accLock = doc.evidence(/\b(AccountNumber\s*\(\s*\)|AccountInfoInteger\s*\(\s*ACCOUNT_LOGIN\s*\))\s*[!=]=|[!=]=\s*(AccountNumber\s*\(\s*\)|AccountInfoInteger\s*\(\s*ACCOUNT_LOGIN\s*\))/);
  if (accLock.length) flag("account-lock", "warn", "Locked to specific account numbers", accLock);
  const brokerLock = doc.evidence(/\b(AccountCompany|AccountServer|AccountName)\s*\(\s*\)\s*[!=]=|[!=]=\s*(AccountCompany|AccountServer|AccountName)\s*\(|\bStringFind\s*\(\s*(AccountCompany|AccountServer)\s*\(|ACCOUNT_(COMPANY|SERVER)\b[^;]*[!=]=/);
  if (brokerLock.length) flag("broker-lock", "warn", "Locked to a broker / server", brokerLock);
  const bombEv = doc.evidence(/\b(TimeCurrent|TimeLocal|TimeGMT)\s*\(\s*\)\s*[<>]=?\s*(D'|StrToTime|StringToTime|\d{9,})|(D'[^']*'|StrToTime\s*\([^)]*\)|StringToTime\s*\([^)]*\))\s*[<>]=?\s*(TimeCurrent|TimeLocal)\s*\(|\b(Expir\w*|Expiry\w*|Valid_?Until|End_?Date)\b/i, "code", 3);
  if (bombEv.length) flag("expiry", "warn", "Has an expiry date / time bomb", bombEv);
  const testerEv = doc.evidence(/\b(IsTesting|IsOptimization|IsVisualMode)\s*\(\s*\)|\bMQL_(TESTER|OPTIMIZATION|VISUAL_MODE)\b/, "bare", 3);
  if (testerEv.length) flag("tester-detection", "warn", "Behaves differently inside the Strategy Tester — backtests may not show live behaviour", testerEv);
  const longStr = doc.find(/"([A-Za-z0-9+/=]{200,}|(?:[0-9A-Fa-f]{2}){100,})"/, "code");
  const charChains = doc.find(/\b(CharToStr|CharToString|StringSetChar|ShortToString)\s*\(/);
  const chainLines = new Map<number, number>();
  for (const h of charChains) chainLines.set(doc.lineOf(h.index), (chainLines.get(doc.lineOf(h.index)) ?? 0) + 1);
  const obfuscated = longStr.length > 0 || charChains.length >= 12 || [...chainLines.values()].some((v) => v >= 4);
  if (obfuscated) flag("obfuscation", "warn", "Obfuscated strings (long hex/base64 blobs or CharToStr chains) hide what the code does", dedupe([...longStr, ...charChains].map((h) => doc.ev(h.index)), 4));
  const decompNames = doc.find(/\b(g[idsb]|l[idsb]|G[idsb]|L[idsb]|gs|ls|gi|li)_\d{1,5}\b/);
  const decompiled = decompNames.length >= 15;
  if (decompiled) flag("decompiled", "warn", "Looks decompiled from an .ex4 (gi_123 / ld_45 style names) — likely a cracked or resold copy", dedupe(decompNames.map((h) => doc.ev(h.index)), 3));
  const gvSet = doc.find(/\bGlobalVariableSet\w*\s*\(/);
  if (gvSet.length) flag("global-variables", gvSet.length >= 10 ? "warn" : "info", `Writes ${gvSet.length} terminal global variable(s) (shared with every chart and EA)`, dedupe(gvSet.map((h) => doc.ev(h.index)), 3));
  if (programKind !== "expert" && orderCalls === 0) {
    flag("not-an-ea", "info", `No order placement found — this is ${programKind === "unknown" ? "not recognisably an EA" : `a ${programKind}`}`, []);
  }

  const risk: Mt4Risk = {
    orderCalls,
    hasStopLoss,
    ordersWithoutStopLoss: noSl,
    stopLossDefaultOff,
    hasTakeProfit,
    hasTrailingStop,
    hasEquityGuard,
    hasMaxOrders,
    lotSizing,
    hasSpreadCheck,
    hasSlippage: slippageSet,
    hasMagicNumber,
    hasErrorHandling,
    hasNewBarCheck,
    usesDll: sysDll.length + otherDll.length > 0,
    networkAccess: webEv.length + inetEv.length + mailEv.length > 0,
    accountLock: accLock.length > 0,
    brokerLock: brokerLock.length > 0,
    timeBomb: bombEv.length > 0,
    testerDetection: testerEv.length > 0,
    obfuscated,
    decompiled,
  };

  const strict = /#property\s+strict/.test(doc.code);
  const scores = scoreAnalysis({ strategy, flags, risk, inputs, lines: doc.orig.length, language, indicators, strict });
  const name = baseName(opts.fileName) || propertyOf(doc, "description")?.split(/\n|\\n/)[0]?.slice(0, 80) || null;
  const out: Mt4Analysis = {
    language,
    programKind,
    lines: doc.orig.length,
    strategy,
    indicators,
    flags,
    risk,
    scores,
    verdict: "",
    fingerprint: fingerprintOf(source),
    lineage: lineageOf(baseName(opts.fileName) ?? name, inputs),
    name,
    version: propertyOf(doc, "version"),
    copyright: propertyOf(doc, "copyright"),
    link: propertyOf(doc, "link"),
    description: propertyOf(doc, "description"),
    inputs,
  };
  out.verdict = verdictOf(out);
  return out;
}

function baseName(fileName?: string): string | null {
  if (!fileName) return null;
  const b = fileName.split(/[\\/]/).pop() ?? "";
  return b.replace(/\.(mq4|mq5|mqh|ex4|ex5)$/i, "") || null;
}

function lineageOf(name: string | null, inputs: Mt4Input[]): string {
  const key = `${(name ?? "").toLowerCase().replace(/[\s_\-.]*v?\d+(\.\d+)*$/i, "").replace(/[^a-z0-9]/g, "")}|${inputs.map((i) => i.name.toLowerCase()).sort().join(",")}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

// --- scoring ----------------------------------------------------------------

interface ScoreInput {
  strategy: string[];
  flags: Mt4Flag[];
  risk: Mt4Risk;
  inputs: Mt4Input[];
  lines: number;
  language: Mt4Language;
  indicators: string[];
  strict?: boolean;
}

class Tally {
  value: number;
  why: string[] = [];
  constructor(base: number, note: string) {
    this.value = base;
    this.why.push(`${base} ${note}`);
  }
  add(delta: number, reason: string) {
    if (!delta) return;
    this.value += delta;
    this.why.push(`${delta > 0 ? "+" : ""}${delta} ${reason}`);
  }
  done(): Mt4Score {
    return { value: clamp(this.value), why: this.why };
  }
}

/** Deterministic, explainable scores. Each `why` line is one signed contribution. */
export function scoreAnalysis(a: ScoreInput): Mt4Analysis["scores"] {
  const has = (id: string) => a.flags.some((f) => f.id === id);
  const dangers = a.flags.filter((f) => f.severity === "danger");
  const r = a.risk;
  const marti = a.strategy.includes("martingale");
  const grid = a.strategy.includes("grid");

  const q = new Tally(50, "base");
  if (r.orderCalls > 0) q.add(r.hasStopLoss ? 10 : -10, r.hasStopLoss ? "every order gets a stop loss" : "orders have no stop loss");
  if (r.hasTakeProfit) q.add(6, "take profit defined");
  if (a.inputs.length >= 3) q.add(6, `${a.inputs.length} configurable inputs`);
  if (r.hasMagicNumber) q.add(5, "uses a magic number (won't touch other EAs' trades)");
  if (r.hasErrorHandling) q.add(6, "checks trade errors");
  if (r.hasSpreadCheck) q.add(4, "checks the spread");
  if (r.hasSlippage) q.add(3, "sets slippage");
  if (r.hasNewBarCheck) q.add(4, "acts once per bar");
  if (a.language === "mql5" || a.strict) q.add(2, a.language === "mql5" ? "MQL5" : "#property strict");
  if (r.lotSizing === "percent-risk") q.add(4, "risk-based position sizing");
  if (r.decompiled) q.add(-20, "decompiled code");
  if (r.obfuscated) q.add(-15, "obfuscated");
  if (a.lines < 60) q.add(-8, "very small program (under 60 lines)");
  if (r.orderCalls === 0) q.add(-10, "places no orders");
  q.add(-8 * Math.min(3, dangers.length), `${dangers.length} danger flag(s)`);

  const rel = new Tally(80, "base");
  if (has("future-leak")) rel.add(-35, "reads future bars");
  if (has("possible-lookahead")) rel.add(-8, "possible look-ahead in series loops");
  if (has("icustom-current-bar")) rel.add(-12, "iCustom on the forming bar");
  if (has("zigzag")) rel.add(-15, "ZigZag repaints");
  if (has("fractals-repaint")) rel.add(-8, "unconfirmed fractals");
  if (a.flags.some((f) => f.id === "current-bar-signal" && f.severity === "warn")) rel.add(-10, "signals flip intrabar");
  if (r.testerDetection) rel.add(-12, "changes behaviour in the tester");
  if (r.usesDll) rel.add(-10, "depends on DLL code not in the source");
  if (has("compiled-library")) rel.add(-8, "depends on a compiled library");
  if (r.networkAccess) rel.add(-8, "depends on online data");
  if (a.strategy.includes("news-filter")) rel.add(-5, "news filter can't be replayed");
  if (a.strategy.includes("scalping")) rel.add(-10, "tick-level scalping (modelled ticks mislead)");
  if (r.accountLock || r.brokerLock) rel.add(-10, "account/broker lock");
  if (r.timeBomb) rel.add(-8, "expires");
  if (r.obfuscated || r.decompiled) rel.add(-10, "hidden or decompiled logic");
  if (r.hasNewBarCheck) rel.add(5, "bar-close logic");

  const rk = new Tally(20, "base");
  if (marti) rk.add(35, "martingale lot multiplication");
  if (grid) rk.add(20, "grid entries");
  if (a.strategy.includes("averaging")) rk.add(10, "averages into losers");
  if (a.strategy.includes("hedging")) rk.add(5, "hedged exposure");
  if (r.orderCalls > 0 && !r.hasStopLoss) rk.add(20, "no stop loss");
  else if (r.stopLossDefaultOff) rk.add(10, "stop loss off by default");
  if (r.orderCalls > 0 && !r.hasEquityGuard) rk.add(marti || grid ? 20 : 5, "no equity/drawdown guard");
  if (r.hasEquityGuard) rk.add(-10, "equity/drawdown guard");
  if ((marti || grid) && !r.hasMaxOrders) rk.add(10, "no cap on open orders");
  if (r.lotSizing === "percent-risk") rk.add(-5, "risk-based sizing");
  if (a.strategy.includes("scalping") && !r.hasSpreadCheck) rk.add(5, "scalping without spread check");
  const secDanger = a.flags.filter((f) => f.severity === "danger" && ["dll-system", "shell-exec", "internet-dll", "web-request", "file-outside-sandbox"].includes(f.id));
  if (secDanger.length) rk.add(Math.min(30, 15 * secDanger.length), "unsafe code (DLL / shell / network)");

  const st = new Tally(50, "base");
  if (a.indicators.length) st.add(12, `entry rules from ${a.indicators.length} indicator(s)`);
  if (a.strategy.includes("breakout")) st.add(6, "breakout logic");
  if (r.hasStopLoss && r.hasTakeProfit) st.add(10, "defined exit (SL + TP)");
  if (a.strategy.includes("time-filter")) st.add(4, "session filter");
  if (a.strategy.includes("news-filter")) st.add(3, "news filter");
  if (r.hasSpreadCheck) st.add(3, "spread filter");
  if (marti) st.add(-20, "relies on martingale recovery");
  if (grid) st.add(-12, "relies on grid recovery");
  if (a.strategy.includes("averaging")) st.add(-6, "averaging down");
  if (a.strategy.includes("unclassified")) st.add(-15, "no recognisable entry logic");
  if (has("future-leak")) st.add(-20, "edge may come from look-ahead");

  return { quality: q.done(), reliability: rel.done(), risk: rk.done(), strategy: st.done() };
}

/** One weighted number for ranking: high quality/reliability/strategy, low risk; dangers cap it. */
export function compositeScore(a: Pick<Mt4Analysis, "scores" | "flags">): number {
  const s = a.scores;
  let v = 0.35 * s.quality.value + 0.25 * s.reliability.value + 0.25 * (100 - s.risk.value) + 0.15 * s.strategy.value;
  if (a.flags.some((f) => f.severity === "danger")) v = Math.min(v, 40);
  return clamp(v);
}

/** Names that mark boilerplate rather than a strategy someone built: never "notable". */
export const BOILERPLATE = /\b(template|sample|example|demo|test|tutorial|learn|hello|my ?first|copier|copy|slave|api|bridge|connector|library|lib|include|framework|skeleton)\b/i;

const REAL_FAMILIES = new Set(["martingale", "grid", "averaging", "hedging", "scalping", "trend-following", "oscillator / mean-reversion", "breakout", "news"]);

/**
 * Worth interrupting the owner for. Deliberately strict — the first live round
 * flagged MetaQuotes' stock "MACD Sample", an EA template, a trade copier and
 * an API bridge, which is exactly the noise a notification must not carry.
 * A notable bot: an actual EA with a recognisable strategy, good
 * quality, controlled risk, a stop loss, no danger flags, and a name that is
 * not boilerplate.
 */
export function isNotable(a: Pick<Mt4Analysis, "scores" | "flags"> & Partial<Pick<Mt4Analysis, "name" | "strategy" | "programKind" | "risk">> & { fileName?: string }): boolean {
  if (a.scores.quality.value < 75 || a.scores.risk.value > 40) return false;
  if (a.flags.some((f) => f.severity === "danger")) return false;
  if (a.programKind && a.programKind !== "expert" && a.programKind !== "unknown") return false;
  if (a.strategy && !a.strategy.some((s) => REAL_FAMILIES.has(s))) return false;
  if (a.risk && !a.risk.hasStopLoss) return false;
  // "TradeCopySlave" → "Trade Copy Slave", "MtApi" → "Mt Api", so the words are found.
  // The bot's own name decides; a file name only when it has none (a mirror called
  // "MACross_copy.mq4" is still MACross).
  const label = `${a.name || a.fileName || ""}`.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ");
  if (BOILERPLATE.test(label)) return false;
  return true;
}

function verdictOf(a: Mt4Analysis): string {
  const fam = a.strategy.filter((s) => s !== "unclassified");
  const what = fam.length ? fam.slice(0, 3).join(" + ") : "unclassified";
  const kind = a.programKind === "expert" || a.programKind === "unknown" ? "EA" : a.programKind;
  const dangers = a.flags.filter((f) => f.severity === "danger");
  const riskWord = a.scores.risk.value >= 70 ? "high" : a.scores.risk.value >= 45 ? "elevated" : "moderate";
  const head = `${what} ${kind}, ${riskWord} risk (${a.scores.risk.value}/100), quality ${a.scores.quality.value}/100`;
  const worst = dangers.length ? ` — ${dangers.map((d) => d.label.split(/[(—:]/)[0].trim().toLowerCase()).slice(0, 2).join("; ")}` : "";
  return `${head}${worst}. Static analysis only; profitability unverified.`;
}

/** The record for a compiled .ex4/.ex5 with no source: nothing can be checked, so nothing is trusted. */
export function compiledOnlyAnalysis(fileName: string): Mt4Analysis {
  const why = ["0 compiled file only — no source to inspect, treated as worst case"];
  const risk: Mt4Risk = {
    orderCalls: 0, hasStopLoss: false, ordersWithoutStopLoss: 0, stopLossDefaultOff: false, hasTakeProfit: false,
    hasTrailingStop: false, hasEquityGuard: false, hasMaxOrders: false, lotSizing: "unknown", hasSpreadCheck: false,
    hasSlippage: false, hasMagicNumber: false, hasErrorHandling: false, hasNewBarCheck: false, usesDll: false,
    networkAccess: false, accountLock: false, brokerLock: false, timeBomb: false, testerDetection: false,
    obfuscated: false, decompiled: false,
  };
  return {
    language: "compiled",
    programKind: "unknown",
    lines: 0,
    strategy: ["unknown"],
    indicators: [],
    flags: [{ id: "compiled-only", severity: "danger", label: "Compiled .ex4/.ex5 only — cannot be verified; never run it", evidence: [] }],
    risk,
    scores: {
      quality: { value: 0, why },
      reliability: { value: 0, why },
      risk: { value: 100, why: ["100 compiled file only — unknown risk treated as worst case"] },
      strategy: { value: 0, why },
    },
    verdict: `Compiled-only file (${baseName(fileName) ?? fileName}): no source, nothing verifiable. Not analysed, never executed.`,
    fingerprint: "",
    lineage: lineageOf(baseName(fileName), []),
    name: baseName(fileName),
    version: null,
    copyright: null,
    link: null,
    description: null,
    inputs: [],
  };
}

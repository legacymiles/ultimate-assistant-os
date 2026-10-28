// ---------------------------------------------------------------------------
// Opportunity Radar — Money Agent Studio's market side (owner's ask, Oct 2026).
//
// "An app for the most lucrative opportunities right now, and the reasoning
// why": once-in-a-lifetime IPOs, the monthly CPI/jobs/Fed releases that move
// gold and stocks, adoption news (XRP-style), and smart companies — huge
// margins, real dividends, speculated growth — plus a bot that catches big
// moves when they happen.
//
// Felix: the end goal is not "more headlines"; it is the owner seeing a real
// opportunity EARLY, knowing why it could pay, what could go wrong and how a
// regular person actually gets in — and finding out whether the bot's catches
// would have made money (the paper scorecard is the outside judge).
//
// Scholar (40-year desk trader + behavioural-finance master) baked into the
// rules here and in the AI prompt:
//   - Scheduled catalysts (CPI, jobs, FOMC, earnings, IPO day) are where the
//     big, PREDICTABLE moves cluster; surprise news moves first and asks later.
//   - "Late or early": FOMO buys after the move. Every play shows how far the
//     price already ran in the last month, so a 60% run is labelled late.
//   - IPOs: day-one pops are mostly for insiders; lock-up expiry (~180 days)
//     often brings the cheaper entry.
//   - Every play needs "how a regular person gets in" — a story you can't buy
//     (an NGX-only listing, a private company) says so plainly.
//
// Everything in this file is pure and tested (radar.test.ts). Nothing here
// buys or sells anything; it is ideas, reasoning and alerts.
// ---------------------------------------------------------------------------

export type OppKind = "ipo" | "macro" | "gold" | "crypto" | "stock" | "dividend" | "policy";
export type Horizon = "today" | "weeks" | "months" | "years";

export const OPP_KINDS: { id: OppKind; label: string }[] = [
  { id: "ipo", label: "IPO" },
  { id: "macro", label: "CPI / Fed" },
  { id: "gold", label: "Gold & metals" },
  { id: "crypto", label: "Crypto" },
  { id: "stock", label: "Stocks" },
  { id: "dividend", label: "Dividends" },
  { id: "policy", label: "Gov & adoption" },
];

export const HORIZON_LABEL: Record<Horizon, string> = {
  today: "Today",
  weeks: "Weeks",
  months: "Months",
  years: "1–2 years",
};

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string; // ISO, "" when unknown
}

export interface Opportunity {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  kind: OppKind;
  /** 0–100: size of the possible move × how likely × how soon. */
  score: number;
  horizon: Horizon;
  why: string;
  risk: string;
  /** How a regular person gets exposure — or that they can't. */
  howToGetIn: string;
  /** Yahoo-style symbols worth watching for it. */
  watch: string[];
  /** YYYY-MM-DD of the next dated catalyst, when there is one. */
  catalystDate: string;
  by: "ai" | "rules";
}

export type CatalystKind = "cpi" | "jobs" | "fomc" | "pce" | "earnings" | "ipo" | "other";

export interface Catalyst {
  id: string;
  /** ISO with offset (e.g. 2026-11-10T08:30:00-05:00); date-only when no time is known. */
  at: string;
  name: string;
  kind: CatalystKind;
  watch: string[];
  note: string;
  source: string;
  /** Not yet confirmed by the organiser. */
  tentative?: boolean;
}

export type Bucket = "margin" | "dividend" | "growth";

export const BUCKETS: { id: Bucket; label: string; blurb: string }[] = [
  { id: "margin", label: "Profit machines", blurb: "Keep an unusual share of every dollar as profit." },
  { id: "dividend", label: "Dividend payers", blurb: "Pay you cash every quarter and keep raising it." },
  { id: "growth", label: "Growth bets", blurb: "Priced on what they might become — bigger upside, bigger swings." },
];

export interface Company {
  ticker: string; // Yahoo symbol
  name: string;
  bucket: Bucket;
  metric: string; // "Net margin ~56% (FY2026)"
  why: string;
  asOf: string; // YYYY-MM-DD
  source: string;
  custom?: boolean;
}

export interface Quote {
  symbol: string;
  price: number;
  prevClose: number;
  /** % change vs previous close. */
  changePct: number;
  /** % change over ~1 month (first close in range → now); NaN when unknown. */
  monthPct: number;
  /** Recent closes, oldest first (for a sparkline). */
  closes: number[];
  currency: string;
  at: string;
  by: "yahoo" | "stooq" | "coingecko";
}

export interface WatchRule {
  id: string;
  symbol: string;
  label: string;
  /** Alert when today's move reaches this % either way (0 = off). */
  movePct: number;
  /** Price levels (0 = off). */
  above: number;
  below: number;
  /** During a catalyst window (release → +2 h) a smaller move counts. */
  eventPct: number;
  on: boolean;
}

export interface Catch {
  id: string;
  ruleId: string;
  symbol: string;
  label: string;
  at: string;
  price: number;
  changePct: number;
  dir: "up" | "down";
  reason: string;
  /** Day key so one rule fires once per reason per day. */
  key: string;
}

export interface RadarState {
  rules: WatchRule[];
  /** Newest first, capped. */
  catches: Catch[];
  /** Companies the owner added. */
  companies: Company[];
  /** Plays the owner starred (kept even when they fall out of the feed). */
  saved: Opportunity[];
  /** Plays the owner dismissed (ids). */
  hidden: string[];
  updatedAt: string;
}

export const MAX_CATCHES = 200;
export const EVENT_WINDOW_MS = 2 * 60 * 60 * 1000;

// --------------------------------------------------------------------------
// Symbols — friendly names for the markets people actually talk about.
// --------------------------------------------------------------------------

export const MARKETS: { symbol: string; label: string; kind: "metal" | "index" | "crypto" | "fx" | "stock" }[] = [
  { symbol: "GC=F", label: "Gold", kind: "metal" },
  { symbol: "SI=F", label: "Silver", kind: "metal" },
  { symbol: "^GSPC", label: "S&P 500", kind: "index" },
  { symbol: "^IXIC", label: "Nasdaq", kind: "index" },
  { symbol: "BTC-USD", label: "Bitcoin", kind: "crypto" },
  { symbol: "XRP-USD", label: "XRP", kind: "crypto" },
  { symbol: "ETH-USD", label: "Ethereum", kind: "crypto" },
  { symbol: "DX-Y.NYB", label: "US Dollar", kind: "fx" },
];

const ALIASES: Record<string, string> = {
  GOLD: "GC=F",
  XAU: "GC=F",
  XAUUSD: "GC=F",
  SILVER: "SI=F",
  XAG: "SI=F",
  SPX: "^GSPC",
  "S&P": "^GSPC",
  "S&P500": "^GSPC",
  SP500: "^GSPC",
  NASDAQ: "^IXIC",
  NDX: "^IXIC",
  BTC: "BTC-USD",
  BITCOIN: "BTC-USD",
  XRP: "XRP-USD",
  RIPPLE: "XRP-USD",
  ETH: "ETH-USD",
  ETHEREUM: "ETH-USD",
  DXY: "DX-Y.NYB",
  DOLLAR: "DX-Y.NYB",
};

/** Whatever the owner types ("gold", "xrp", "mu", "$NVDA") → a Yahoo symbol. */
export function toSymbol(raw: string): string {
  const s = raw.trim().replace(/^\$/, "").toUpperCase().replace(/\s+/g, "");
  if (!s) return "";
  if (ALIASES[s]) return ALIASES[s];
  if (/^[A-Z0-9^.=\-]{1,15}$/.test(s)) return s;
  return "";
}

export function labelFor(symbol: string, companies: Company[] = []): string {
  const m = MARKETS.find((x) => x.symbol === symbol);
  if (m) return m.label;
  const c = companies.find((x) => x.ticker === symbol);
  return c ? c.name : symbol;
}

export function isCrypto(symbol: string): boolean {
  return /-USD$/.test(symbol);
}

const COINGECKO: Record<string, string> = {
  "BTC-USD": "bitcoin",
  "XRP-USD": "ripple",
  "ETH-USD": "ethereum",
  "SOL-USD": "solana",
  "DOGE-USD": "dogecoin",
  "ADA-USD": "cardano",
};

export function coingeckoId(symbol: string): string | null {
  return COINGECKO[symbol] ?? null;
}

/** Stooq only has plain US tickers ("mu.us"); indices/futures go elsewhere. */
export function stooqSymbol(symbol: string): string | null {
  if (/^[A-Z]{1,5}$/.test(symbol)) return `${symbol.toLowerCase()}.us`;
  return null;
}

// --------------------------------------------------------------------------
// News — Google News RSS in, clean items out.
// --------------------------------------------------------------------------

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
}

export function parseRss(xml: string, max = 30): NewsItem[] {
  const out: NewsItem[] = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of items) {
    let title = tag(block, "title");
    const url = tag(block, "link");
    let source = tag(block, "source");
    const pub = tag(block, "pubDate");
    if (!title || !/^https?:\/\//i.test(url)) continue;
    // Google News titles end with " - Source".
    const dash = title.lastIndexOf(" - ");
    if (dash > 20) {
      if (!source) source = title.slice(dash + 3);
      title = title.slice(0, dash);
    }
    const d = pub ? new Date(pub) : null;
    out.push({ title, url, source, publishedAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : "" });
    if (out.length >= max) break;
  }
  return out;
}

function titleKey(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .join(" ");
}

/** Same story from five outlets → one item, the newest. Newest first. */
export function dedupeNews(items: NewsItem[]): NewsItem[] {
  const byKey = new Map<string, NewsItem>();
  for (const it of items) {
    const k = titleKey(it.title) || it.url;
    const prev = byKey.get(k);
    if (!prev || (it.publishedAt && it.publishedAt > prev.publishedAt)) byKey.set(k, it);
  }
  return [...byKey.values()].sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
}

// --------------------------------------------------------------------------
// The rules scorer — what the radar does with no AI key. Keyword-driven,
// honest about being rough, and never invents numbers.
// --------------------------------------------------------------------------

const KIND_WORDS: { kind: OppKind; words: RegExp; watch: string[] }[] = [
  { kind: "ipo", words: /\b(ipo|initial public offering|goes public|going public|listing|debut|s-1|f-1)\b/i, watch: [] },
  { kind: "macro", words: /\b(cpi|inflation|fed|fomc|powell|rate cut|rate hike|jobs report|payrolls|pce|treasury yields?)\b/i, watch: ["^GSPC", "GC=F", "DX-Y.NYB"] },
  { kind: "gold", words: /\b(gold|silver|bullion|precious metals?)\b/i, watch: ["GC=F", "SI=F"] },
  { kind: "policy", words: /\b(sec|congress|senate|bill|executive order|regulat\w*|approval|approved|reserve|government|adopt\w*)\b/i, watch: [] },
  { kind: "crypto", words: /\b(xrp|ripple|bitcoin|btc|ethereum|crypto\w*|stablecoin|etf)\b/i, watch: [] },
  { kind: "dividend", words: /\b(dividend|payout|yield|buyback)\b/i, watch: [] },
  { kind: "stock", words: /\b(earnings|profit|margin|revenue|guidance|shares|stock|record)\b/i, watch: [] },
];

const BOOST: { re: RegExp; pts: number }[] = [
  { re: /\b(biggest|largest|record|historic|first[- ]ever|once in a)\b/i, pts: 14 },
  { re: /\b(approv\w*|wins?|clears?|green ?light|signs?)\b/i, pts: 10 },
  { re: /\b(surges?|soars?|jumps?|rall(y|ies)|skyrockets?|doubles?)\b/i, pts: 8 },
  { re: /\b(beats?|tops? estimates|raises? guidance|turnaround)\b/i, pts: 8 },
  { re: /\b(etf)\b/i, pts: 6 },
  { re: /\$\s?\d+(\.\d+)?\s?(b|bn|billion|t|trillion)\b/i, pts: 6 },
];

const DRAG: { re: RegExp; pts: number }[] = [
  { re: /\b(lawsuit|fraud|probe|investigation|delay\w*|postpone\w*|halt\w*|bankrupt\w*)\b/i, pts: 10 },
  // Markets a US investor can't easily buy (owner invests from the US).
  { re: /₹|\b(lakh|crore|rs\.?\s?\d|sensex|nifty|bse|nse)\b/i, pts: 25 },
  { re: /\b(rumou?r|could|might|may)\b/i, pts: 4 },
];

const CRYPTO_SYMBOLS: [RegExp, string][] = [
  [/\b(xrp|ripple)\b/i, "XRP-USD"],
  [/\b(bitcoin|btc)\b/i, "BTC-USD"],
  [/\b(ethereum|ether|eth)\b/i, "ETH-USD"],
];

export function oppId(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0;
  return `o${(h >>> 0).toString(36)}`;
}

export function ruleScore(item: NewsItem, now = new Date()): Opportunity {
  const t = item.title;
  const hit = KIND_WORDS.find((k) => k.words.test(t));
  let kind: OppKind = hit?.kind ?? "stock";
  // A crypto story about regulation is still a crypto play to the owner.
  if (kind === "policy" && /\b(xrp|ripple|bitcoin|crypto|stablecoin)\b/i.test(t)) kind = "crypto";

  let score = 40;
  for (const b of BOOST) if (b.re.test(t)) score += b.pts;
  for (const d of DRAG) if (d.re.test(t)) score -= d.pts;
  if (item.publishedAt) {
    const hours = (now.getTime() - new Date(item.publishedAt).getTime()) / 3_600_000;
    if (hours < 24) score += 8;
    else if (hours > 24 * 5) score -= 8;
  }
  score = Math.max(5, Math.min(85, score)); // rules never claim certainty

  const watch = new Set<string>(hit?.watch ?? []);
  for (const [re, sym] of CRYPTO_SYMBOLS) if (re.test(t)) watch.add(sym);
  const tickers = t.match(/\((?:NYSE|NASDAQ|Nasdaq|NYSE American)?:?\s?([A-Z]{1,5})\)/g) ?? [];
  for (const m of tickers) {
    const s = m.replace(/[()]/g, "").split(/:\s?/).pop()!.trim();
    if (s) watch.add(s);
  }

  const horizon: Horizon = kind === "macro" ? "today" : kind === "ipo" || kind === "policy" ? "months" : kind === "crypto" ? "months" : "weeks";

  return {
    id: oppId(item.url),
    title: t,
    url: item.url,
    source: item.source,
    publishedAt: item.publishedAt,
    kind,
    score,
    horizon,
    why: "Picked by keywords (no AI key set) — open the story and judge it yourself.",
    risk: "Not analysed. Headlines move fast and are often already priced in.",
    howToGetIn: "",
    watch: [...watch].slice(0, 4),
    catalystDate: "",
    by: "rules",
  };
}

/**
 * A reply cut off mid-list still holds every play written before the cut.
 * Walk the "plays" array and keep each object that closes properly.
 */
export function salvagePlays(text: string): { plays: unknown[] } {
  const start = text.indexOf("[", Math.max(0, text.indexOf('"plays"')));
  const plays: unknown[] = [];
  if (start < 0) return { plays };
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          plays.push(JSON.parse(text.slice(objStart, i + 1)));
        } catch {
          /* a broken object is skipped, the rest still count */
        }
        objStart = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return { plays };
}

// --------------------------------------------------------------------------
// The AI's answer, checked. Only URLs that were in the news it was shown.
// --------------------------------------------------------------------------

function str(v: unknown, max = 400): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

const KIND_IDS = new Set(OPP_KINDS.map((k) => k.id));
const HORIZONS = new Set<Horizon>(["today", "weeks", "months", "years"]);

export function normalizeOpportunities(raw: unknown, news: NewsItem[]): Opportunity[] {
  const list = Array.isArray((raw as { plays?: unknown })?.plays) ? (raw as { plays: unknown[] }).plays : Array.isArray(raw) ? raw : [];
  const byUrl = new Map(news.map((n) => [n.url, n]));
  const out: Opportunity[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const url = str(o.url, 2000);
    const src = byUrl.get(url);
    if (!src || seen.has(url)) continue;
    seen.add(url);
    const kind = (KIND_IDS.has(o.kind as OppKind) ? o.kind : "stock") as OppKind;
    const horizon = (HORIZONS.has(o.horizon as Horizon) ? o.horizon : "months") as Horizon;
    const score = Math.round(Math.max(0, Math.min(100, Number(o.score) || 0)));
    const watch = (Array.isArray(o.watch) ? o.watch : [])
      .map((w) => toSymbol(String(w)))
      .filter(Boolean)
      .slice(0, 4);
    const date = str(o.catalystDate, 10);
    out.push({
      id: oppId(url),
      title: str(o.title, 200) || src.title,
      url,
      source: src.source,
      publishedAt: src.publishedAt,
      kind,
      score,
      horizon,
      why: str(o.why, 500),
      risk: str(o.risk, 400),
      howToGetIn: str(o.howToGetIn, 300),
      watch,
      catalystDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      by: "ai",
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

// --------------------------------------------------------------------------
// Quotes — Yahoo's chart JSON, Stooq's CSV, CoinGecko's simple price.
// --------------------------------------------------------------------------

function pct(a: number, b: number): number {
  return b ? ((a - b) / b) * 100 : NaN;
}

export function parseYahooChart(json: unknown, now = new Date()): Quote | null {
  const r = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | { meta?: Record<string, unknown>; indicators?: { quote?: { close?: (number | null)[] }[] } }
    | undefined;
  const meta = r?.meta;
  if (!meta) return null;
  const price = Number(meta.regularMarketPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const closes = (r?.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  // The day's reference is the previous session's close, not the start of the range.
  const prev = Number(meta.previousClose) || (closes.length >= 2 ? closes[closes.length - 2] : Number(meta.chartPreviousClose)) || 0;
  const first = closes[0] ?? Number(meta.chartPreviousClose);
  return {
    symbol: String(meta.symbol ?? ""),
    price,
    prevClose: prev,
    changePct: pct(price, prev),
    monthPct: pct(price, first),
    closes: closes.slice(-30),
    currency: String(meta.currency ?? "USD"),
    at: now.toISOString(),
    by: "yahoo",
  };
}

/** Stooq daily history CSV: Date,Open,High,Low,Close,Volume (oldest first). */
export function parseStooqHistory(symbol: string, csv: string, now = new Date()): Quote | null {
  const rows = csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(","))
    .filter((c) => c.length >= 5 && Number.isFinite(Number(c[4])));
  if (!rows.length) return null;
  const closes = rows.map((c) => Number(c[4])).slice(-23);
  const price = closes[closes.length - 1];
  const prev = closes.length >= 2 ? closes[closes.length - 2] : price;
  return {
    symbol,
    price,
    prevClose: prev,
    changePct: pct(price, prev),
    monthPct: pct(price, closes[0]),
    closes,
    currency: "USD",
    at: now.toISOString(),
    by: "stooq",
  };
}

/** CoinGecko market_chart (?days=30&interval=daily) → prices [[ms, price], …]. */
export function parseCoingeckoChart(symbol: string, json: unknown, now = new Date()): Quote | null {
  const prices = (json as { prices?: unknown[] })?.prices;
  if (!Array.isArray(prices) || prices.length < 2) return null;
  const closes = prices.map((p) => (Array.isArray(p) ? Number(p[1]) : NaN)).filter((n) => Number.isFinite(n) && n > 0);
  if (closes.length < 2) return null;
  const price = closes[closes.length - 1];
  // Crypto never closes — "today" is the last 24 h, which the daily series' second-to-last point is.
  const prev = closes[closes.length - 2];
  return {
    symbol,
    price,
    prevClose: prev,
    changePct: pct(price, prev),
    monthPct: pct(price, closes[0]),
    closes: closes.slice(-31),
    currency: "USD",
    at: now.toISOString(),
    by: "coingecko",
  };
}

// --------------------------------------------------------------------------
// Late or early — the FOMO check every play gets.
// --------------------------------------------------------------------------

export type Timing = "early" | "moving" | "late" | "beaten" | "unknown";

export function timing(q: Quote | undefined | null): { state: Timing; text: string } {
  if (!q || !Number.isFinite(q.monthPct)) return { state: "unknown", text: "No price yet" };
  const m = q.monthPct;
  const s = `${m >= 0 ? "+" : ""}${m.toFixed(m > -10 && m < 10 ? 1 : 0)}% in a month`;
  if (m >= 25) return { state: "late", text: `Late — already ${s}` };
  if (m >= 8) return { state: "moving", text: `Moving — ${s}` };
  if (m <= -15) return { state: "beaten", text: `Beaten down — ${s}` };
  return { state: "early", text: `Hasn't run yet — ${s}` };
}

// --------------------------------------------------------------------------
// Catalysts — the calendar.
// --------------------------------------------------------------------------

export function catalystTime(c: Catalyst): number {
  const t = Date.parse(c.at.length === 10 ? `${c.at}T12:00:00Z` : c.at);
  return Number.isFinite(t) ? t : NaN;
}

/** Upcoming first; anything still inside its 2-hour window counts as upcoming. */
export function upcoming(list: Catalyst[], now = new Date(), days = 120): Catalyst[] {
  const from = now.getTime() - EVENT_WINDOW_MS;
  const to = now.getTime() + days * 86_400_000;
  return list
    .filter((c) => {
      const t = catalystTime(c);
      return Number.isFinite(t) && t >= from && t <= to;
    })
    .sort((a, b) => catalystTime(a) - catalystTime(b));
}

export function inWindow(c: Catalyst, now = new Date()): boolean {
  if (c.at.length === 10) return false; // no release time → no window
  const t = catalystTime(c);
  return now.getTime() >= t && now.getTime() <= t + EVENT_WINDOW_MS;
}

export function countdown(c: Catalyst, now = new Date()): string {
  const ms = catalystTime(c) - now.getTime();
  if (inWindow(c, now)) return "Live now";
  if (ms <= 0) return "Just happened";
  const h = ms / 3_600_000;
  if (h < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 36) return `in ${Math.round(h)} h`;
  return `in ${Math.round(h / 24)} days`;
}

/** Catalysts in their window right now that touch this symbol. */
export function liveCatalystsFor(symbol: string, list: Catalyst[], now = new Date()): Catalyst[] {
  return list.filter((c) => inWindow(c, now) && (c.watch.includes(symbol) || c.watch.includes("*")));
}

// --------------------------------------------------------------------------
// The move bot — rules against live quotes. Fires once per rule, reason, day.
// --------------------------------------------------------------------------

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function newRule(symbol: string, label: string, over: Partial<WatchRule> = {}): WatchRule {
  return {
    id: `r${Math.random().toString(36).slice(2, 9)}`,
    symbol,
    label,
    movePct: isCrypto(symbol) ? 5 : symbol.startsWith("^") || symbol.endsWith("=F") ? 1.5 : 4,
    above: 0,
    below: 0,
    eventPct: isCrypto(symbol) ? 2 : 0.6,
    on: true,
    ...over,
  };
}

export function checkRule(
  rule: WatchRule,
  q: Quote,
  catches: Catch[],
  catalysts: Catalyst[],
  now = new Date(),
): Catch | null {
  if (!rule.on || !Number.isFinite(q.price) || q.price <= 0) return null;
  const day = dayKey(now);
  const fired = (key: string) => catches.some((c) => c.ruleId === rule.id && c.key === key);
  const make = (why: string, keyPart: string, dir: "up" | "down"): Catch | null => {
    const key = `${day}:${keyPart}`;
    if (fired(key)) return null;
    return {
      id: `c${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ruleId: rule.id,
      symbol: rule.symbol,
      label: rule.label,
      at: now.toISOString(),
      price: q.price,
      changePct: q.changePct,
      dir,
      reason: why,
      key,
    };
  };
  const ch = q.changePct;
  const dir: "up" | "down" = ch >= 0 ? "up" : "down";
  const sign = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

  if (rule.above > 0 && q.price >= rule.above) {
    const c = make(`Crossed above ${rule.above}`, `above:${rule.above}`, "up");
    if (c) return c;
  }
  if (rule.below > 0 && q.price <= rule.below) {
    const c = make(`Fell below ${rule.below}`, `below:${rule.below}`, "down");
    if (c) return c;
  }
  const live = liveCatalystsFor(rule.symbol, catalysts, now);
  if (live.length && rule.eventPct > 0 && Number.isFinite(ch) && Math.abs(ch) >= rule.eventPct) {
    const c = make(`${sign(ch)} during ${live[0].name}`, `event:${live[0].id}:${dir}`, dir);
    if (c) return c;
  }
  if (rule.movePct > 0 && Number.isFinite(ch) && Math.abs(ch) >= rule.movePct) {
    const c = make(`Big move: ${sign(ch)} today`, `move:${dir}`, dir);
    if (c) return c;
  }
  return null;
}

/**
 * The scorecard — Felix's outside judge. If you had followed each catch in its
 * direction (bought an up-move, sold a down-move), where would you be now?
 */
export function paperResult(c: Catch, q: Quote | undefined | null): number {
  if (!q || !Number.isFinite(q.price) || !c.price) return NaN;
  const raw = ((q.price - c.price) / c.price) * 100;
  return c.dir === "up" ? raw : -raw;
}

export function scorecard(catches: Catch[], quotes: Record<string, Quote>): { n: number; wins: number; avg: number } {
  const rs = catches.map((c) => paperResult(c, quotes[c.symbol])).filter((n) => Number.isFinite(n));
  if (!rs.length) return { n: 0, wins: 0, avg: NaN };
  return { n: rs.length, wins: rs.filter((r) => r > 0).length, avg: rs.reduce((a, b) => a + b, 0) / rs.length };
}

// --------------------------------------------------------------------------
// State — synced per account like every hub app.
// --------------------------------------------------------------------------

export const DEFAULT_RULES: WatchRule[] = [
  newRule("GC=F", "Gold", { id: "r-gold" }),
  newRule("^GSPC", "S&P 500", { id: "r-spx" }),
  newRule("BTC-USD", "Bitcoin", { id: "r-btc" }),
  newRule("XRP-USD", "XRP", { id: "r-xrp", movePct: 8, eventPct: 3 }),
  newRule("MU", "Micron", { id: "r-mu" }),
];

export const EMPTY_RADAR: RadarState = {
  rules: DEFAULT_RULES,
  catches: [],
  companies: [],
  saved: [],
  hidden: [],
  updatedAt: "",
};

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
}

export function normalizeRadar(raw: unknown): RadarState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<RadarState>;
  const rules = Array.isArray(r.rules)
    ? r.rules
        .filter((x): x is WatchRule => !!x && typeof x.symbol === "string" && !!x.symbol)
        .map((x) => ({
          id: String(x.id || `r${Math.random().toString(36).slice(2, 9)}`),
          symbol: x.symbol,
          label: String(x.label || x.symbol),
          movePct: num(x.movePct),
          above: num(x.above),
          below: num(x.below),
          eventPct: num(x.eventPct),
          on: x.on !== false,
        }))
    : DEFAULT_RULES;
  const seenRule = new Set<string>();
  const uniqRules = rules.filter((x) => (seenRule.has(x.symbol) ? false : (seenRule.add(x.symbol), true)));
  const catches = (Array.isArray(r.catches) ? r.catches : [])
    .filter((c): c is Catch => !!c && typeof c.symbol === "string" && typeof c.at === "string")
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_CATCHES);
  const companies = (Array.isArray(r.companies) ? r.companies : []).filter(
    (c): c is Company => !!c && typeof c.ticker === "string" && !!c.ticker,
  );
  const saved = (Array.isArray(r.saved) ? r.saved : []).filter((o): o is Opportunity => !!o && typeof o.url === "string");
  const hidden = (Array.isArray(r.hidden) ? r.hidden : []).filter((h): h is string => typeof h === "string").slice(-400);
  return { rules: uniqRules, catches, companies, saved, hidden, updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "" };
}

export function addCatches(state: RadarState, add: Catch[]): RadarState {
  if (!add.length) return state;
  const keys = new Set(state.catches.map((c) => `${c.ruleId}|${c.key}`));
  const fresh = add.filter((c) => !keys.has(`${c.ruleId}|${c.key}`));
  if (!fresh.length) return state;
  return { ...state, catches: [...fresh, ...state.catches].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_CATCHES) };
}

export function upsertRule(state: RadarState, rule: WatchRule): RadarState {
  const i = state.rules.findIndex((x) => x.id === rule.id);
  if (i >= 0) return { ...state, rules: state.rules.map((x, j) => (j === i ? rule : x)) };
  if (state.rules.some((x) => x.symbol === rule.symbol)) return state; // one rule per symbol
  return { ...state, rules: [rule, ...state.rules] };
}

export function toggleSaved(state: RadarState, o: Opportunity): RadarState {
  const has = state.saved.some((x) => x.id === o.id);
  return { ...state, saved: has ? state.saved.filter((x) => x.id !== o.id) : [o, ...state.saved] };
}

/** The feed the owner sees: saved first (if still around), hidden gone, best first. */
export function visiblePlays(feed: Opportunity[], state: RadarState, kind: OppKind | "all" = "all"): Opportunity[] {
  const hidden = new Set(state.hidden);
  const saved = new Set(state.saved.map((s) => s.id));
  return feed
    .filter((o) => !hidden.has(o.id) && (kind === "all" || o.kind === kind))
    .sort((a, b) => Number(saved.has(b.id)) - Number(saved.has(a.id)) || b.score - a.score);
}

/** Every symbol the radar needs a price for — rules, plays, companies — once each. */
export function symbolsToQuote(state: RadarState, feed: Opportunity[], companies: Company[], max = 40): string[] {
  const out = new Set<string>();
  for (const r of state.rules) if (r.on) out.add(r.symbol);
  for (const m of MARKETS.slice(0, 6)) out.add(m.symbol);
  for (const c of companies) out.add(c.ticker);
  for (const o of feed.slice(0, 15)) for (const w of o.watch) out.add(w);
  return [...out].slice(0, max);
}

/** What Claude Code gets when the owner asks for a real trading bot for a play. */
export function botBrief(o: Pick<Opportunity, "title" | "url" | "watch" | "why" | "catalystDate">): string {
  return [
    `Build and backtest a bot for this opportunity in Trading Studio (Replay), owner's ask from Money Agent Studio › Radar.`,
    `Story: ${o.title}`,
    `Link: ${o.url}`,
    o.watch.length ? `Markets: ${o.watch.join(", ")}` : "",
    o.catalystDate ? `Catalyst date: ${o.catalystDate}` : "",
    o.why ? `Why it could move: ${o.why}` : "",
    `Goal: catch the big move around the catalyst with a fixed stop-loss; report the backtest on the last 12 releases/events with win rate, average win/loss and max drawdown. Paper only — never place live trades.`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3800);
}

import {
  coingeckoId,
  parseCoingeckoChart,
  parseStooqHistory,
  parseYahooChart,
  stooqSymbol,
  type Quote,
} from "@/lib/money-agents/radar";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET ?s=GC=F,MU,XRP-USD → { quotes: { [symbol]: Quote }, missing: string[] }
//
// Prices for the radar and the move bot, no key needed: Yahoo's chart API
// first (stocks, indices, gold futures, crypto), then Stooq for plain US
// tickers and CoinGecko for coins when Yahoo refuses. Each symbol is cached
// for 45 seconds so a page polling every minute stays light.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TTL = 45_000;
const cache = new Map<string, { at: number; q: Quote }>();

async function yahoo(symbol: string): Promise<Quote | null> {
  for (const host of ["query1", "query2"]) {
    try {
      const res = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) continue;
      const q = parseYahooChart(await res.json());
      if (q) return { ...q, symbol };
    } catch {
      /* try the next host */
    }
  }
  return null;
}

async function stooq(symbol: string): Promise<Quote | null> {
  const s = stooqSymbol(symbol);
  if (!s) return null;
  try {
    const d2 = new Date();
    const d1 = new Date(d2.getTime() - 35 * 86_400_000);
    const f = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const res = await fetch(`https://stooq.com/q/d/l/?s=${s}&i=d&d1=${f(d1)}&d2=${f(d2)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(6_000),
    });
    return res.ok ? parseStooqHistory(symbol, await res.text()) : null;
  } catch {
    return null;
  }
}

async function coingecko(symbol: string): Promise<Quote | null> {
  const id = coingeckoId(symbol);
  if (!id) return null;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30&interval=daily`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    return res.ok ? parseCoingeckoChart(symbol, await res.json()) : null;
  } catch {
    return null;
  }
}

async function quote(symbol: string): Promise<Quote | null> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL) return hit.q;
  const q = (await yahoo(symbol)) ?? (await coingecko(symbol)) ?? (await stooq(symbol));
  if (q) cache.set(symbol, { at: Date.now(), q });
  return q ?? hit?.q ?? null; // a stale price beats no price
}

export async function GET(req: Request) {
  const symbols = [
    ...new Set(
      (new URL(req.url).searchParams.get("s") ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9^.=\-]{1,15}$/.test(s)),
    ),
  ].slice(0, 40);
  if (!symbols.length) return Response.json({ quotes: {}, missing: [] });

  const out: Record<string, Quote> = {};
  const missing: string[] = [];
  // A few at a time — Yahoo throttles bursts.
  for (let i = 0; i < symbols.length; i += 8) {
    const batch = symbols.slice(i, i + 8);
    const got = await Promise.all(batch.map(quote));
    got.forEach((q, j) => (q ? (out[batch[j]] = q) : missing.push(batch[j])));
  }
  return Response.json({ quotes: out, missing }, { headers: { "Cache-Control": "no-store" } });
}

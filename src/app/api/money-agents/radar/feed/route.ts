import { dedupeNews, normalizeOpportunities, parseRss, ruleScore, type NewsItem, type Opportunity } from "@/lib/money-agents/radar";
import { aiReady, askJson } from "@/lib/money-agents/server/ai";
import { parseDdgResults } from "@/lib/new-jarvis/web";

export const runtime = "nodejs";
// 300 matches other routes so Vercel groups it into an existing function (Hobby plan: max 12).
export const maxDuration = 300;

// GET ?fresh=1 → { plays, news, by, at, warning? }
//
// The Opportunity Radar's feed: the last week's market news from Google News
// (DuckDuckGo if that fails), read by the AI with a 40-year desk trader's rules
// (scholar skill): why it could pay, what could go wrong, how a regular person
// gets in, and when the dated catalyst is. No AI key → a keyword scorer, still
// useful, clearly labelled. Cached 20 minutes per server instance so a phone
// and a laptop opening the tab at once don't double the AI bill.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const QUERIES = [
  "biggest IPO filing",
  "IPO date set valuation",
  "CPI inflation report stocks gold",
  "Federal Reserve rate decision markets",
  "gold price record",
  "XRP ETF SEC",
  "crypto bill government adoption",
  "record profit margin earnings beat",
  "dividend increase raises payout",
  "stock soars approval contract",
];

const TTL = 20 * 60 * 1000;
let cache: { at: number; body: Record<string, unknown> } | null = null;

async function googleNews(q: string): Promise<NewsItem[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:7d`)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? parseRss(await res.text(), 12) : [];
  } catch {
    return [];
  }
}

async function ddgNews(q: string): Promise<NewsItem[]> {
  try {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ q: `${q} news`, df: "w" }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    return parseDdgResults(await res.text(), 6).map((h) => ({ title: h.title, url: h.url, source: new URL(h.url).hostname.replace(/^www\./, ""), publishedAt: "" }));
  } catch {
    return [];
  }
}

const SYSTEM = [
  "You are the Opportunity Radar's analyst: a 40-year Wall Street desk trader and behavioural-finance expert who explains plays to a smart regular person in plain words.",
  "From the news list, pick the 10 stories with the biggest realistic money opportunity in the next days to 2 years: once-in-a-lifetime IPOs, scheduled macro releases (CPI, jobs, Fed) that move gold/stocks, adoption or regulation news (e.g. crypto ETFs, government use), companies with standout margins, dividends or growth.",
  "Your rules: (1) Separate scheduled catalysts (known date — where the predictable big moves cluster) from surprise news. (2) Ask whether it is already priced in — a story after a big run is usually late. (3) For IPOs, say day-one pops mostly go to insiders and the ~180-day lock-up expiry often gives a cheaper entry. (4) Say exactly how a US regular person gets exposure (the ticker, an ETF, a broker that offers it) — or plainly that they can't yet (private company, foreign-only listing). (5) Name the main way it loses money. (6) Never invent a number, date or ticker; leave a field empty when the story doesn't support it. (7) Score 0–100 = size of the possible move × likelihood × how soon; hype without substance scores low.",
  "This is education and reasoning, not financial advice. Respond ONLY with minified JSON.",
].join(" ");

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (!fresh && cache && Date.now() - cache.at < TTL) return Response.json({ ...cache.body, cached: true });

  let lists = await Promise.all(QUERIES.map(googleNews));
  if (!lists.flat().length) lists = await Promise.all(QUERIES.slice(0, 6).map(ddgNews));
  const news = dedupeNews(lists.flat()).slice(0, 70);

  if (!news.length) {
    return Response.json({
      plays: [],
      news: [],
      by: "none",
      at: new Date().toISOString(),
      warning: "The news sources didn't answer just now. Try Refresh in a minute.",
    });
  }

  const byRules = (): Opportunity[] => news.map((n) => ruleScore(n)).sort((a, b) => b.score - a.score).slice(0, 20);

  if (!aiReady()) {
    const body = {
      plays: byRules(),
      news: news.slice(0, 40),
      by: "rules",
      at: new Date().toISOString(),
      warning: "No AI key is set, so plays are ranked by keywords only. Add one in Jarvis › Profile › Connections for the full reasoning.",
    };
    cache = { at: Date.now(), body };
    return Response.json(body);
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = await askJson(
      SYSTEM,
      [
        `Today is ${today}.`,
        "News (newest first):",
        ...news.map((n, i) => `${i + 1}. ${n.title} — ${n.source}${n.publishedAt ? ` (${n.publishedAt.slice(0, 10)})` : ""}\n   ${n.url}`),
        "",
        'Return {"plays":[{"url":"exact url from the list","title":"short plain-words headline","kind":"ipo|macro|gold|crypto|stock|dividend|policy","score":0,"horizon":"today|weeks|months|years","why":"2 sentences: why it could pay","risk":"1 sentence: how it loses money","howToGetIn":"ticker/ETF/broker, or why you can\'t yet","watch":["Yahoo symbols e.g. GC=F, ^GSPC, XRP-USD, MU"],"catalystDate":"YYYY-MM-DD or empty"}]}',
      ].join("\n"),
      0.3,
    );
    let plays = normalizeOpportunities(raw, news);
    if (plays.length < 4) plays = [...plays, ...byRules().filter((r) => !plays.some((p) => p.url === r.url))].slice(0, 16);
    const body = { plays, news: news.slice(0, 40), by: "ai", at: new Date().toISOString() };
    cache = { at: Date.now(), body };
    return Response.json(body);
  } catch (err) {
    console.error("[money-agents/radar/feed] AI failed:", err);
    return Response.json({
      plays: byRules(),
      news: news.slice(0, 40),
      by: "rules",
      at: new Date().toISOString(),
      warning: "The AI step didn't answer, so plays are ranked by keywords for now. Refresh in a minute for the full reasoning.",
    });
  }
}

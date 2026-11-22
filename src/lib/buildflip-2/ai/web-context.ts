// ---------------------------------------------------------------------------
// The web half of a plan, gathered BEFORE the model is asked anything.
//
// This app used to let the model search for itself, mid-generation, through
// OpenRouter's web plugin. That worked, but it meant BuildFlip held its own
// private search path: no cache, no provider chain, no rate limit, nothing in
// the hub's usage log, and a hard dependency on OpenRouter being the endpoint
// in use. The rule on this hub is that web search belongs to one service
// (`src/lib/search`), so pricing and comps now run search-then-generate:
//
//   1. search here, through the hub's service, with the pages READ (`extract`)
//   2. hand the model those pages as context
//   3. the model reads prices and sales off them — it never browses
//
// Two things get better in the trade, and both matter to this app's honesty:
//
//   URLs are real. The old prompt had to beg the model not to invent a
//   plausible-looking product URL, because only the model knew what it had
//   seen. Now every citable URL came out of a search response, and
//   `allowedUrl` below rejects anything else outright — a buy link on a plan
//   either resolves or is not shown.
//
//   A search that finds nothing says so. `research` throws when every
//   provider fails; everything here catches that and returns an empty context
//   instead, so a dead search service degrades the plan to labelled estimates
//   rather than failing the generation.
//
// Server-only, via `@/lib/search/client`.
// ---------------------------------------------------------------------------

import { asPrompt, research, type SearchResponse, type SearchResult } from "@/lib/search/client";

import { log } from "../log";

/** How many materials get their own search. Beyond this the list is the cost. */
const MAX_PRICE_SEARCHES = 16;
/** Characters of search context for the whole pricing prompt. */
const PRICE_CONTEXT_CHARS = 18_000;
/** Characters of search context for the comps prompt. */
const COMPS_CONTEXT_CHARS = 14_000;
/** Searches in flight at once. The service caches and rate-limits per app. */
const CONCURRENCY = 4;
/**
 * Wall-clock the whole gathering step may spend before it stops starting new
 * searches.
 *
 * A plan is promised in about a minute, and the model pass after this one takes
 * most of it. Sixteen searches against a healthy SearXNG cost a few seconds
 * each and finish well inside this; the budget exists for the bad day, when
 * every provider is slow and the circuit breaker has not opened yet. Materials
 * that miss the budget arrive with no context and are priced as estimates,
 * which is a worse plan but still a plan.
 */
const BUDGET_MS = 45_000;

export interface WebContext {
  /** Numbered result blocks, ready to drop into a prompt. "" when nothing came back. */
  text: string;
  /** Results that carried a URL — the number the caller decides "live or estimate" on. */
  found: number;
  /** Every URL the model is allowed to cite. */
  urls: string[];
  /** True when the search service answered with nothing, or did not answer. */
  empty: boolean;
}

const emptyContext = (): WebContext => ({ text: "", found: 0, urls: [], empty: true });

/**
 * Run several searches without running them all at once.
 *
 * Twelve materials firing twelve searches and twenty-four page reads in one
 * burst is how a free SearXNG instance starts refusing, and the breaker in the
 * search service would then skip it for a minute — for every other app too.
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * One search that cannot fail the generation.
 *
 * Every reason a search dies — no provider configured, all providers down,
 * rate limit, a 500 from the VPS — arrives as a thrown SearchError. None of
 * them is a reason to lose the plan, so they all become "no results".
 */
async function safeResearch(
  query: string,
  options: { app: string; limit: number; extract: number },
): Promise<SearchResponse | null> {
  try {
    return await research(query, options);
  } catch (err) {
    await log({
      level: "warn",
      event: "search_failed",
      message: (err as Error)?.message,
      meta: { query, app: options.app },
    });
    return null;
  }
}

/**
 * Hosts that hand back a redirect or an ad rather than a page.
 *
 * Found the hard way: with only DuckDuckGo in the chain, the top result for
 * "2x4x8 pressure treated lumber price buy" was
 * `duckduckgo.com/y.js?ad_domain=amazon.com&…`, a 1,200-character sponsored
 * click-through. Two things go wrong if that reaches the model. It becomes a
 * "buy link" on someone's plan, which is the one thing this app must not ship.
 * And it eats the per-item character budget, so the real listings underneath it
 * get truncated away.
 */
const REDIRECT_HOSTS =
  /(^|\.)(duckduckgo\.com|bing\.com|google\.[a-z.]+|r\.search\.yahoo\.com|doubleclick\.net|googleadservices\.com|googlesyndication\.com)$/i;

/**
 * A result worth showing the model: a real page, at a length a URL can be.
 *
 * Exported for its test — it is the filter that keeps an ad redirect from
 * becoming a buy link, which is worth pinning down.
 */
export function usable(result: SearchResult): boolean {
  // No product URL is 400 characters. Anything that long is tracking payload.
  if (result.url.length > 400) return false;
  try {
    const u = new URL(result.url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return !REDIRECT_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

/** The same response with the junk dropped, ready for `asPrompt`. */
function cleaned(response: SearchResponse): SearchResponse {
  return { ...response, results: response.results.filter(usable) };
}

/** A searchable query for one material: what it is, at the size a store sells. */
function priceQuery(material: { name: string; spec?: string }): string {
  // A spec field is a sentence ("3/4 in birch ply, 4x8 sheet, includes 10%
  // waste") and the tail of it is about quantity, not about the product. The
  // first clause is the size; the rest only makes the query worse.
  const clause = (material.spec ?? "").split(/[.;(]/)[0].trim();
  const base = clause && clause.length <= 48 ? `${material.name} ${clause}` : material.name;
  return `${base.replace(/\s+/g, " ").slice(0, 140)} price buy`;
}

/**
 * Live listing pages for each material, one search per item.
 *
 * Per-item rather than one big query because a price is a property of a product
 * page: "price these twelve things" returns twelve category pages and no
 * figures. `extract` is on for the same reason — a 160-character snippet is
 * where a human decides what to click, and the price is usually inside the
 * page, not in the snippet.
 */
export async function priceContext(
  materials: { name: string; spec?: string; unit: string }[],
): Promise<WebContext> {
  const subjects = materials.slice(0, MAX_PRICE_SEARCHES);
  if (!subjects.length) return emptyContext();

  const startedAt = Date.now();
  const responses = await mapLimit(subjects, CONCURRENCY, (material) =>
    Date.now() - startedAt > BUDGET_MS
      ? Promise.resolve(null)
      : safeResearch(priceQuery(material), {
          app: "buildflip-2/price",
          limit: 5,
          extract: 2,
        }),
  );

  const perItem = Math.max(700, Math.floor(PRICE_CONTEXT_CHARS / subjects.length));
  const urls: string[] = [];
  const blocks: string[] = [];
  let found = 0;

  subjects.forEach((material, i) => {
    const raw = responses[i];
    const res = raw ? cleaned(raw) : null;
    const label = `ITEM ${i + 1}: ${material.name} (price per 1 ${material.unit})`;
    if (!res?.results.length) {
      blocks.push(`${label}\nNo listings came back for this one.`);
      return;
    }
    for (const result of res.results) urls.push(result.url);
    found += res.results.length;
    blocks.push(`${label}\n${asPrompt(res, { maxChars: perItem })}`);
  });

  return { text: blocks.join("\n\n---\n\n"), found, urls, empty: found === 0 };
}

/** The queries that find COMPLETED sales rather than things currently for sale. */
function compsQueries(title: string): string[] {
  const item = title.replace(/\s+/g, " ").trim().slice(0, 120);
  return [
    `${item} sold price ebay sold listings completed`,
    `${item} sold handmade etsy price second hand`,
  ];
}

/**
 * Sold-listing pages for one build.
 *
 * Two queries, not one: eBay's sold filter and the handmade marketplaces are
 * different slices of the same market, and a single query reliably returns only
 * the first. Results are merged and de-duplicated by URL, so the model sees one
 * list and cannot count the same sale twice.
 */
export async function compsContext(spec: { title: string; summary?: string }): Promise<WebContext> {
  const queries = compsQueries(spec.title);
  const responses = await mapLimit(queries, CONCURRENCY, (query) =>
    safeResearch(query, { app: "buildflip-2/comps", limit: 10, extract: 4 }),
  );

  const merged: SearchResult[] = [];
  const seen = new Set<string>();
  for (const res of responses) {
    for (const result of res ? cleaned(res).results : []) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      merged.push(result);
    }
  }
  if (!merged.length) return emptyContext();

  const base = responses.find((r) => r) as SearchResponse;
  const text = asPrompt({ ...base, answer: null, results: merged }, { maxChars: COMPS_CONTEXT_CHARS });
  return { text, found: merged.length, urls: [...seen], empty: false };
}

/**
 * The URL the model gave back, but only if it is one it was shown.
 *
 * A model copying twenty URLs out of a prompt will occasionally produce one
 * that is close rather than identical, and a near-miss product URL is a dead
 * buy link on a plan someone is about to act on. Compared without the query
 * string, because tracking parameters get dropped and re-added by everybody,
 * and the page is the same page.
 */
export function allowedUrl(url: string | null | undefined, allowed: Iterable<string>): string | null {
  if (!url) return null;
  const key = normalizeUrl(url);
  if (!key) return null;
  for (const candidate of allowed) {
    if (normalizeUrl(candidate) === key) return url;
  }
  return null;
}

/**
 * Every priced material, with any unverifiable buy link removed.
 *
 * A dropped link also drops the confidence to "low" and says why in the note,
 * because the alternative is a row that reads "high confidence, Home Depot"
 * with nothing to tap — which is exactly the kind of number this app exists to
 * stop people trusting.
 */
export function keepRealLinks<
  T extends { url: string | null; note?: string; confidence?: "high" | "medium" | "low" },
>(items: T[], allowed: Iterable<string>): T[] {
  const urls = [...allowed];
  return items.map((item) => {
    const url = allowedUrl(item.url, urls);
    if (url || !item.url) return { ...item, url };
    return {
      ...item,
      url: null,
      confidence: "low" as const,
      note: `${item.note ? `${item.note} ` : ""}Listing link couldn't be verified, so this is treated as an estimate.`.slice(
        0,
        240,
      ),
    };
  });
}

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
  } catch {
    return null;
  }
}

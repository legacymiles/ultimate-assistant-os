// ---------------------------------------------------------------------------
// What a provider has to be able to do.
//
// Adding a fourth provider later is writing one file that exports this
// interface and one line in ./index.ts. Nothing else in the service, and
// nothing in any app, learns its name.
// ---------------------------------------------------------------------------

import type { ProviderEndpoint, ProviderId } from "../config";
import type { SearchKind, SearchRequest, SearchResult } from "../types";

export interface ProviderQuery {
  query: string;
  kind: SearchKind;
  limit: number;
  freshness: NonNullable<SearchRequest["freshness"]>;
  language: string;
  safe: boolean;
}

export interface ProviderOutcome {
  results: SearchResult[];
  /** A direct answer the provider volunteered, if any. */
  answer: string | null;
}

export interface SearchProviderAdapter {
  id: ProviderId;
  label: string;
  /** Which kinds it can serve. A provider that cannot do news is skipped for news. */
  kinds: SearchKind[];
  /** The env var that turns it on, for the dashboard's "what's missing" list. */
  envVar: string;
  search(endpoint: ProviderEndpoint, query: ProviderQuery, signal: AbortSignal): Promise<ProviderOutcome>;
  /** Cheap liveness probe. Resolves on healthy, throws with a plain-English reason otherwise. */
  health(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<void>;
}

/** Hostname as a person would name the source: lowercase, no `www.`. */
export function sourceOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Anything a provider calls a date, as ISO 8601 or null.
 *
 * Upstream engines hand back every format there is, including empty strings,
 * `None` from a Python serializer, and relative text like "2 days ago" that
 * carries no absolute instant. Only a value that parses to a real, sane date
 * survives; a wrong date is worse than a missing one, because a caller will
 * sort by it.
 */
export function toIso(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!raw || raw === "None" || raw === "null") return null;
  const parsed = new Date(raw);
  const ms = parsed.getTime();
  if (!Number.isFinite(ms)) return null;
  const year = parsed.getUTCFullYear();
  // Before the web existed, or more than a day into the future: not a date, a
  // parsing accident.
  if (year < 1990 || ms > Date.now() + 86_400_000) return null;
  return parsed.toISOString();
}

/** Collapse whitespace and trim — snippets arrive full of newlines and tabs. */
export function tidy(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Hosts that hand back a click-through rather than a page.
 *
 * A search engine's own redirect and an ad network's tracker are not results.
 * They are kept out here, at the provider layer, rather than in each app,
 * because every caller has the same problem and only one of them would
 * remember to solve it: an app that puts a result URL in front of a person —
 * BuildFlip's buy links, Jarvis citing a source — needs the URL to be a page.
 *
 * SearXNG is included deliberately. It proxies the same engines, so when one of
 * them returns a sponsored row the wrapper comes through its JSON unchanged;
 * this is not a DuckDuckGo quirk being patched in the wrong place.
 */
const CLICK_THROUGH_HOSTS =
  /(^|\.)(duckduckgo\.com|bing\.com|google\.[a-z.]{2,8}|r\.search\.yahoo\.com|doubleclick\.net|googleadservices\.com|googlesyndication\.com|adclick\.g\.doubleclick\.net)$/i;

/** No real page has a URL this long. Past it, the address IS tracking payload. */
const MAX_URL_CHARS = 400;

/**
 * True for a URL worth handing to a caller: an http(s) address, on a host that
 * serves pages, short enough to be one.
 */
export function serveableUrl(url: string): boolean {
  if (!url || url.length > MAX_URL_CHARS) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return !CLICK_THROUGH_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Drop rows that are not usable, and the same URL twice.
 *
 * Deduping is on the URL without its fragment, because `#section` links to the
 * same page and an agent reading both wastes a fetch on a duplicate.
 *
 * Every adapter returns through here, which is why the ad and redirect filter
 * lives here too: one gate, applied before anything in the service caches a
 * result, logs it or hands it to an app.
 */
export function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const result of results) {
    if (!result.url || !result.title) continue;
    if (!serveableUrl(result.url)) continue;
    let key = result.url;
    try {
      const url = new URL(result.url);
      url.hash = "";
      key = url.toString();
    } catch {
      continue; // Not a URL we can hand to anyone.
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result);
  }
  return out;
}

/** How many days back a freshness window reaches. Null means no constraint. */
export function freshnessDays(freshness: string): number | null {
  switch (freshness) {
    case "day":
      return 1;
    case "week":
      return 7;
    case "month":
      return 31;
    case "year":
      return 366;
    default:
      return null;
  }
}

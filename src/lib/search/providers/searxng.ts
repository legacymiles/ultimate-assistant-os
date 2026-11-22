// ---------------------------------------------------------------------------
// SearXNG — the primary provider.
//
// A metasearch engine the owner runs themselves: it queries Google, Bing,
// Brave, DuckDuckGo, Wikipedia and ~70 others, strips the tracking and hands
// back JSON. No API key, no quota, no per-call cost, and the queries never
// carry an account.
//
// The one thing that catches everybody: a stock SearXNG serves HTML only.
// `format=json` returns **403** until `formats: [html, json]` is added under
// `search:` in settings.yml. The health probe below tells you that in those
// words rather than letting it read as "the VPS is down", because the owner
// will hit it exactly once and should not have to go looking.
//
// Docs: https://docs.searxng.org/dev/search_api.html
// ---------------------------------------------------------------------------

import type { ProviderEndpoint } from "../config";
import type { SearchResult } from "../types";
import {
  type ProviderOutcome,
  type ProviderQuery,
  type SearchProviderAdapter,
  dedupe,
  sourceOf,
  tidy,
  toIso,
} from "./base";

/** One row as SearXNG's JSON API writes it. Every field is optional in practice. */
interface SearxResult {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
  engines?: string[];
  score?: number;
  publishedDate?: string | null;
  pretty_url?: string;
}

interface SearxPayload {
  query?: string;
  number_of_results?: number;
  results?: SearxResult[];
  answers?: unknown;
  infoboxes?: { content?: string }[];
  unresponsive_engines?: unknown[];
}

/** SearXNG's time_range accepts exactly these. Anything else must be omitted. */
function timeRange(freshness: string): string | null {
  return freshness === "day" || freshness === "week" || freshness === "month" || freshness === "year"
    ? freshness
    : null;
}

/**
 * `news` maps to SearXNG's news category, which is what makes dates appear.
 * `research` stays on general but asks for two pages, because breadth is the
 * whole difference between a research query and a web query here.
 */
function categoriesFor(kind: string): string {
  return kind === "news" ? "news" : "general";
}

function pagesFor(kind: string, limit: number): number {
  if (kind !== "research") return 1;
  // SearXNG returns roughly 10–20 merged rows per page depending on engines.
  return Math.min(3, Math.max(1, Math.ceil(limit / 12)));
}

/**
 * SearXNG scores are unbounded sums of per-engine weights — a row agreed on by
 * six engines can score 12 while a single-engine row scores 0.5. Dividing by
 * the top score in the same response puts them on the 0–1 scale the contract
 * promises, and keeps the ordering the engine intended.
 */
function normalizeScores(rows: SearxResult[]): (number | null)[] {
  const scores = rows.map((r) => (typeof r.score === "number" && r.score > 0 ? r.score : null));
  const top = scores.reduce<number>((max, s) => (s !== null && s > max ? s : max), 0);
  if (top <= 0) return scores.map(() => null);
  return scores.map((s) => (s === null ? null : Math.min(1, Number((s / top).toFixed(4)))));
}

/**
 * An instant answer, when one of the answer engines had it.
 *
 * SearXNG changed this shape: it used to be `string[]`, and is now a list of
 * `{ answer, url }` objects. Both are handled because an owner-run instance
 * can be any version, and a version bump should not quietly stop surfacing
 * answers.
 */
function answerFrom(payload: SearxPayload): string | null {
  const answers = payload.answers;
  if (Array.isArray(answers)) {
    for (const entry of answers) {
      if (typeof entry === "string" && entry.trim()) return tidy(entry);
      if (entry && typeof entry === "object") {
        const text = (entry as { answer?: unknown }).answer;
        if (typeof text === "string" && text.trim()) return tidy(text);
      }
    }
  }
  const infobox = payload.infoboxes?.find((box) => tidy(box?.content).length > 40);
  return infobox ? tidy(infobox.content) : null;
}

function buildUrl(endpoint: ProviderEndpoint, query: ProviderQuery, page: number): string {
  const params = new URLSearchParams({
    q: query.query,
    format: "json",
    categories: categoriesFor(query.kind),
    language: query.language || "en",
    safesearch: query.safe ? "1" : "0",
    pageno: String(page),
  });
  const range = timeRange(query.freshness);
  if (range) params.set("time_range", range);
  return `${endpoint.url}/search?${params.toString()}`;
}

function headers(endpoint: ProviderEndpoint): Record<string, string> {
  const out: Record<string, string> = {
    Accept: "application/json",
    // A generic client name on purpose: this is the owner's own instance, and
    // nothing about them belongs in an outbound header.
    "User-Agent": "jarvis-search/1.0",
  };
  if (endpoint.token) out.Authorization = `Bearer ${endpoint.token}`;
  return out;
}

/** Turn a non-200 into the sentence that actually explains it. */
async function explain(response: Response, endpoint: ProviderEndpoint): Promise<string> {
  const host = endpoint.url ?? "the instance";
  if (response.status === 403) {
    return `${host} refused the JSON API (403). SearXNG serves HTML only until you add "json" to the formats list: in settings.yml, under search:, set formats: [html, json] — then restart it.`;
  }
  if (response.status === 404) {
    return `${host} has no /search endpoint (404). Check the URL points at SearXNG's root, not at a path inside it.`;
  }
  if (response.status === 429) {
    return `${host} is rate-limiting this caller (429). Its limiter plugin counts by IP — if the hub and SearXNG share a host, turn the limiter off in settings.yml.`;
  }
  if (response.status >= 500) {
    return `${host} returned a server error (${response.status}). Check its container logs.`;
  }
  const body = await response.text().catch(() => "");
  const hint = body.slice(0, 160).replace(/\s+/g, " ").trim();
  return `${host} returned ${response.status}${hint ? `: ${hint}` : ""}.`;
}

export const searxngProvider: SearchProviderAdapter = {
  id: "searxng",
  label: "SearXNG",
  kinds: ["web", "news", "research"],
  envVar: "SEARXNG_URL",

  async search(endpoint, query, signal): Promise<ProviderOutcome> {
    const pages = pagesFor(query.kind, query.limit);
    const collected: SearchResult[] = [];
    let answer: string | null = null;

    for (let page = 1; page <= pages; page += 1) {
      const response = await fetch(buildUrl(endpoint, query, page), {
        headers: headers(endpoint),
        signal,
        cache: "no-store",
      });
      if (!response.ok) {
        // Page 1 failing is a provider failure. A later page failing is not —
        // we already have results, and a partial research set beats none.
        if (page === 1) throw new Error(await explain(response, endpoint));
        break;
      }

      const payload = (await response.json()) as SearxPayload;
      const rows = Array.isArray(payload.results) ? payload.results : [];
      const scores = normalizeScores(rows);

      rows.forEach((row, i) => {
        const url = typeof row.url === "string" ? row.url : "";
        const title = tidy(row.title);
        if (!url || !title) return;
        collected.push({
          title,
          url,
          description: tidy(row.content),
          source: sourceOf(url),
          publishedAt: toIso(row.publishedDate),
          score: scores[i],
          provider: "searxng",
        });
      });

      if (page === 1) answer = answerFrom(payload);
      if (rows.length === 0) break;
    }

    // An instance that answers 200 with nothing at all, repeatedly, is broken
    // in a way a 200 hides — every engine unresponsive, or the bot-detection
    // of all 70 upstreams tripped at once. Treating it as a failure is what
    // lets the chain fall through to Tavily instead of returning an empty list
    // that a caller reads as "no such thing exists".
    if (collected.length === 0) {
      throw new Error(
        `${endpoint.url} answered but returned no results. Usually every upstream engine is blocked or the instance has just started — check its logs for "unresponsive engines".`,
      );
    }

    return { results: dedupe(collected).slice(0, query.limit), answer };
  },

  async health(endpoint, signal) {
    // /healthz is the container's own check and says nothing about the JSON
    // API, which is the part that actually breaks. One real one-word search is
    // the probe that catches the 403, so that is the probe.
    const url = `${endpoint.url}/search?q=ping&format=json`;
    const response = await fetch(url, { headers: headers(endpoint), signal, cache: "no-store" });
    if (!response.ok) throw new Error(await explain(response, endpoint));
    const payload = (await response.json()) as SearxPayload;
    if (!Array.isArray(payload.results)) {
      throw new Error(`${endpoint.url} replied, but not with SearXNG JSON. Check the URL points at SearXNG.`);
    }
  },
};

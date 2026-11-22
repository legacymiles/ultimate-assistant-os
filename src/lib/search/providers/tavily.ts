// ---------------------------------------------------------------------------
// Tavily — the fallback, and the better engine for deep research.
//
// Paid per call, so it is last in the chain and the dashboard counts its calls
// separately from the free ones. Two things it has that SearXNG does not: a
// generated `answer`, and `search_depth: "advanced"`, which is worth the extra
// credit on a research query and is wasted on a web query.
//
// Auth is `Authorization: Bearer tvly-…`. The older `api_key` body field still
// works on their side but is deprecated, and sending a key in a JSON body is a
// worse habit than sending it in a header — it lands in request logs more
// often.
//
// Docs: https://docs.tavily.com/api-reference/endpoint/search
// ---------------------------------------------------------------------------

import { SEARCH_LIMITS, tavilyKey } from "../config";
import type { SearchResult } from "../types";
import {
  type ProviderOutcome,
  type ProviderQuery,
  type SearchProviderAdapter,
  dedupe,
  freshnessDays,
  sourceOf,
  tidy,
  toIso,
} from "./base";

interface TavilyRow {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string | null;
}

interface TavilyPayload {
  answer?: string | null;
  results?: TavilyRow[];
  detail?: unknown;
  error?: unknown;
}

const BASE = "https://api.tavily.com";

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${tavilyKey()}`,
    "Content-Type": "application/json",
    "User-Agent": "jarvis-search/1.0",
  };
}

/** Tavily's own words for a failure, or ours when it sent none. */
async function explain(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    return "Tavily rejected the API key. Check TAVILY_API_KEY is the current key and starts with tvly-.";
  }
  if (response.status === 429) {
    return "Tavily is out of credit or rate-limiting the key. Check the usage on your Tavily dashboard.";
  }
  let detail = "";
  try {
    const body = (await response.json()) as TavilyPayload;
    const raw = body.detail ?? body.error;
    if (typeof raw === "string") detail = raw;
    else if (raw && typeof raw === "object") {
      const error = (raw as { error?: unknown }).error;
      if (typeof error === "string") detail = error;
    }
  } catch {
    /* No JSON body — the status is all there is. */
  }
  return `Tavily returned ${response.status}${detail ? `: ${tidy(detail)}` : "."}`;
}

/**
 * `research` buys advanced depth and an answer; `web` and `news` stay basic.
 *
 * This is the only place in the service where a choice costs money, so it is
 * the only place that comment is worth making: basic is 1 credit, advanced is
 * 2, and a web search does not get measurably better for the second one.
 */
function body(query: ProviderQuery): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    query: query.query,
    topic: query.kind === "news" ? "news" : "general",
    search_depth: query.kind === "research" ? "advanced" : "basic",
    max_results: Math.min(50, Math.max(1, query.limit)),
    include_answer: query.kind === "research",
    include_raw_content: false,
    include_images: false,
  };
  const days = freshnessDays(query.freshness);
  // `days` is only honoured on the news topic; on general, Tavily ignores it
  // rather than erroring, so sending it anyway is harmless and keeps one path.
  if (days !== null) payload.days = days;
  return payload;
}

export const tavilyProvider: SearchProviderAdapter = {
  id: "tavily",
  label: "Tavily",
  kinds: ["web", "news", "research"],
  envVar: "TAVILY_API_KEY",

  async search(_endpoint, query, signal): Promise<ProviderOutcome> {
    const response = await fetch(`${BASE}/search`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body(query)),
      signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await explain(response));

    const payload = (await response.json()) as TavilyPayload;
    const rows = Array.isArray(payload.results) ? payload.results : [];
    const results: SearchResult[] = [];

    for (const row of rows) {
      const url = typeof row.url === "string" ? row.url : "";
      const title = tidy(row.title);
      if (!url || !title) continue;
      results.push({
        title,
        url,
        description: tidy(row.content),
        source: sourceOf(url),
        publishedAt: toIso(row.published_date),
        // Tavily's score is already 0–1 relevance, so it needs no normalizing.
        score: typeof row.score === "number" ? Number(Math.min(1, Math.max(0, row.score)).toFixed(4)) : null,
        provider: "tavily",
      });
    }

    if (results.length === 0) {
      throw new Error("Tavily returned no results for that query.");
    }

    return {
      results: dedupe(results).slice(0, query.limit),
      answer: typeof payload.answer === "string" && payload.answer.trim() ? tidy(payload.answer) : null,
    };
  },

  async health(_endpoint, signal) {
    if (!tavilyKey()) throw new Error("TAVILY_API_KEY is not set.");
    // The cheapest call that proves the key works. Tavily has no free health
    // endpoint, so this costs one credit — which is why the dashboard probes
    // Tavily only when asked, never on a page load.
    const response = await fetch(`${BASE}/search`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query: "ping", max_results: 1, search_depth: "basic" }),
      signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await explain(response));
  },
};

/**
 * Tavily's own extractor, used as the fallback when reading a page ourselves
 * fails — a JS-rendered page, or one that blocks a plain fetch. It renders and
 * cleans server-side, so it gets text out of pages a fetch cannot.
 *
 * Returns null rather than throwing: this is already the second attempt, and a
 * page that cannot be read is a normal outcome that belongs in the result as a
 * message, not an exception that loses the other nine results.
 */
export async function tavilyExtract(url: string): Promise<{ text: string; title: string | null } | null> {
  if (!tavilyKey()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_LIMITS.extractTimeoutMs);
  try {
    const response = await fetch(`${BASE}/extract`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ urls: [url], extract_depth: "basic" }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      results?: { url?: string; raw_content?: string }[];
    };
    const raw = payload.results?.[0]?.raw_content;
    if (typeof raw !== "string" || raw.trim().length < 80) return null;
    return { text: raw.trim().slice(0, SEARCH_LIMITS.extractMaxChars), title: null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

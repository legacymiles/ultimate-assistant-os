// ---------------------------------------------------------------------------
// DuckDuckGo's HTML endpoint — the keyless floor.
//
// It was here before this service was: the hub searched the web by scraping
// html.duckduckgo.com, and Jarvis's web tools and the Profiles chat both used
// it. Rather than leave that as a fourth path with its own provider baked into
// it, it is registered here as a provider like any other. Two things follow
// from that: lib/web/fetchPublic.ts became a delegation instead of an
// implementation, and this adapter is proof that adding a provider is one file
// and one line in ./index.ts.
//
// Where it sits in the chain: after the self-hosted instances, BEFORE Tavily.
// It needs no key and costs nothing, so it should be tried before anything
// that spends money — but it is scraped HTML with no API contract behind it,
// so it ranks below a SearXNG the owner controls. It turns cloud servers away
// fairly often, which is exactly the failure the breaker is for.
//
// The parsing is lib/new-jarvis/web.ts, which is unit-tested and shared. This
// file deliberately does not re-implement it.
// ---------------------------------------------------------------------------

import { parseDdgResults } from "@/lib/new-jarvis/web";
import type { ProviderEndpoint } from "../config";
import type { SearchResult } from "../types";
import {
  type ProviderOutcome,
  type ProviderQuery,
  type SearchProviderAdapter,
  dedupe,
  sourceOf,
  tidy,
} from "./base";

/** A desktop UA: the HTML endpoint serves a stripped layout to unknown clients. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const MAX_BYTES = 2_000_000;

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
    if (size >= MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

/**
 * DuckDuckGo's HTML endpoint has no date, no score and no news mode, so this
 * adapter declares only `web` and `research`. The registry skips it for news
 * rather than returning dateless rows a caller asked for dates on.
 */
export const duckduckgoProvider: SearchProviderAdapter = {
  id: "duckduckgo",
  label: "DuckDuckGo",
  kinds: ["web", "research"],
  envVar: "SEARCH_ENABLE_DUCKDUCKGO",

  async search(_endpoint, query, signal): Promise<ProviderOutcome> {
    const q = query.query.slice(0, 300);
    const attempts = [
      { url: "https://html.duckduckgo.com/html/", body: new URLSearchParams({ q }).toString() },
      { url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, body: undefined },
    ];

    let lastReason = "DuckDuckGo did not answer.";
    for (const attempt of attempts) {
      try {
        const response = await fetch(attempt.url, {
          method: attempt.body ? "POST" : "GET",
          body: attempt.body,
          signal,
          cache: "no-store",
          headers: {
            "User-Agent": UA,
            "Accept-Language": "en-US,en;q=0.9",
            ...(attempt.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          },
        });
        if (!response.ok) {
          lastReason =
            response.status === 403 || response.status === 429
              ? "DuckDuckGo turned this server away — it rate-limits datacentre addresses. A self-hosted SearXNG is the fix."
              : `DuckDuckGo returned ${response.status}.`;
          continue;
        }

        const hits = parseDdgResults(await readCapped(response), query.limit);
        if (hits.length === 0) {
          lastReason = "DuckDuckGo answered but the page held no results — its HTML layout may have changed.";
          continue;
        }

        const results: SearchResult[] = hits.map((hit) => ({
          title: tidy(hit.title),
          url: hit.url,
          description: tidy(hit.snippet),
          source: sourceOf(hit.url),
          // Neither of these exists in scraped HTML. Null is the honest answer,
          // and the contract says a caller must cope with it.
          publishedAt: null,
          score: null,
          provider: "duckduckgo",
        }));

        return { results: dedupe(results).slice(0, query.limit), answer: null };
      } catch (error) {
        lastReason = error instanceof Error ? error.message : lastReason;
      }
    }

    throw new Error(lastReason);
  },

  async health(endpoint, signal) {
    await duckduckgoProvider.search(
      endpoint,
      { query: "ping", kind: "web", limit: 1, freshness: "any", language: "en", safe: true },
      signal,
    );
  },
};

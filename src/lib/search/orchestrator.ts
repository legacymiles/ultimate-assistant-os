// ---------------------------------------------------------------------------
// The one function every search goes through.
//
// Cache → rate limit → provider chain with a breaker → optional extraction →
// usage row. Every API route is a thin wrapper over this, and so is the
// in-process client the hub's other apps import. There is exactly one place
// that decides which provider serves a query, and this is it.
// ---------------------------------------------------------------------------

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { SEARCH_LIMITS, chainFor, defaultLimit } from "./config";
import { extractPages } from "./extract";
import { halfOpen, isOpen, recordFailure, recordSuccess, toMessage } from "./health";
import { providerById } from "./providers";
import { cacheGet, cacheSet, rateCheck, recordUsage } from "./store";
import {
  type Caller,
  type ProviderAttempt,
  SEARCH_KINDS,
  SearchError,
  type SearchKind,
  type SearchRequest,
  type SearchResponse,
} from "./types";

/** A request with every default filled in, so nothing downstream guesses. */
export interface Normalized {
  query: string;
  kind: SearchKind;
  limit: number;
  freshness: NonNullable<SearchRequest["freshness"]>;
  language: string;
  safe: boolean;
  extractCount: number;
  provider?: string;
  noCache: boolean;
  label: string | null;
}

export function normalize(request: SearchRequest): Normalized {
  const query = (request.query ?? "").replace(/\s+/g, " ").trim();
  if (!query) {
    throw new SearchError("A search needs a query.", { status: 400, code: "no_query" });
  }
  if (query.length > 500) {
    throw new SearchError("That query is longer than 500 characters.", { status: 400, code: "query_too_long" });
  }

  const kind: SearchKind = SEARCH_KINDS.includes(request.kind as SearchKind)
    ? (request.kind as SearchKind)
    : "web";

  const requested = Number(request.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(50, Math.round(requested)) : defaultLimit(kind);

  const extractCount =
    request.extract === true
      ? 3
      : typeof request.extract === "number" && request.extract > 0
        ? Math.min(10, Math.round(request.extract))
        : 0;

  return {
    query,
    kind,
    limit,
    freshness: request.freshness ?? "any",
    language: (request.language ?? "en").slice(0, 12),
    safe: request.safe !== false,
    extractCount,
    provider: request.provider,
    noCache: request.noCache === true,
    label: request.label ? request.label.slice(0, 60) : null,
  };
}

/**
 * The cache key.
 *
 * Everything that changes the ANSWER is in it; nothing that doesn't is. So the
 * calling app's label is out (two apps asking the same question share a hit),
 * and the extraction count is in but quantised — asking for 3 pages and then 5
 * should not re-run the search, so the key carries whether extraction was
 * wanted at all and the orchestrator tops up the pages it is missing.
 */
export function cacheKeyFor(n: Normalized): string {
  const parts = [
    n.query.toLowerCase(),
    n.kind,
    n.limit,
    n.freshness,
    n.language.toLowerCase(),
    n.safe ? "safe" : "unsafe",
    n.provider ?? "auto",
    n.extractCount > 0 ? "extract" : "plain",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 48);
}

/**
 * Run a search.
 *
 * `caller` is already resolved and authorised by the route — this function
 * trusts it, counts against it, and bills the usage row to it.
 */
export async function runSearch(request: SearchRequest, caller: Caller): Promise<SearchResponse> {
  const started = Date.now();
  const requestId = randomUUID();
  const n = normalize(request);
  const key = cacheKeyFor(n);

  // ----- Rate limit, before anything is spent -----------------------------
  const verdict = await rateCheck(caller);
  if (!verdict.allowed) {
    recordUsage({
      callerId: caller.id,
      callerKind: caller.kind,
      callerLabel: caller.label,
      app: n.label,
      kind: n.kind,
      query: n.query,
      provider: null,
      location: null,
      cached: false,
      degraded: false,
      ms: Date.now() - started,
      resultCount: 0,
      extracted: 0,
      ok: false,
      error: "rate limited",
    });
    throw new SearchError(verdict.message ?? "Rate limit reached.", {
      status: 429,
      code: "rate_limited",
    });
  }

  // ----- Cache ------------------------------------------------------------
  if (!n.noCache) {
    const hit = await cacheGet(key, SEARCH_LIMITS.cacheTtlSeconds);
    if (hit) {
      const payload: SearchResponse = {
        ...hit.payload,
        cached: true,
        cacheAge: hit.ageSeconds,
        ms: Date.now() - started,
        requestId,
      };
      recordUsage({
        callerId: caller.id,
        callerKind: caller.kind,
        callerLabel: caller.label,
        app: n.label,
        kind: n.kind,
        query: n.query,
        provider: payload.provider,
        location: payload.location,
        cached: true,
        degraded: payload.degraded,
        ms: payload.ms,
        resultCount: payload.results.length,
        extracted: payload.results.filter((r) => r.content).length,
        ok: true,
        error: null,
      });
      return payload;
    }
  }

  // ----- The provider chain ----------------------------------------------
  const chain = chainFor(n.kind, n.provider);
  if (chain.length === 0) {
    throw new SearchError(
      n.provider
        ? `No provider called "${n.provider}" is configured on this host.`
        : "No search provider is configured. Set SEARXNG_URL to your SearXNG instance, or TAVILY_API_KEY, and try again.",
      { status: 503, code: "no_provider" },
    );
  }

  const attempts: ProviderAttempt[] = [];
  let served: SearchResponse | null = null;

  for (const endpoint of chain) {
    const adapter = providerById(endpoint.provider);
    if (!adapter || !adapter.kinds.includes(n.kind)) continue;

    // A tripped breaker is skipped — except for the LAST endpoint in the
    // chain, which is tried anyway. Skipping the last one would mean returning
    // a failure while a provider that might work sat untouched, which is a
    // worse outcome than one slow request.
    const isLast = endpoint === chain[chain.length - 1];
    if (isOpen(endpoint)) {
      if (!isLast) {
        attempts.push({
          provider: endpoint.provider,
          endpoint: endpoint.url,
          location: endpoint.location,
          ok: false,
          ms: 0,
          resultCount: 0,
          skipped: true,
          error: "Skipped — recent failures tripped its breaker.",
        });
        continue;
      }
      halfOpen(endpoint);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_LIMITS.providerTimeoutMs);
    const attemptStarted = Date.now();
    try {
      const outcome = await adapter.search(
        endpoint,
        {
          query: n.query,
          kind: n.kind,
          limit: n.limit,
          freshness: n.freshness,
          language: n.language,
          safe: n.safe,
        },
        controller.signal,
      );
      const ms = Date.now() - attemptStarted;
      recordSuccess(endpoint, ms);
      attempts.push({
        provider: endpoint.provider,
        endpoint: endpoint.url,
        location: endpoint.location,
        ok: true,
        ms,
        resultCount: outcome.results.length,
      });
      served = {
        query: n.query,
        kind: n.kind,
        results: outcome.results,
        answer: outcome.answer,
        provider: endpoint.provider,
        endpoint: endpoint.url,
        location: endpoint.location,
        cached: false,
        cacheAge: null,
        ms: 0,
        attempts,
        // Degraded means "not the first thing we tried", which is exactly the
        // signal worth surfacing: results are fine, something upstream isn't.
        degraded: attempts.filter((a) => !a.ok).length > 0,
        requestId,
      };
      break;
    } catch (error) {
      const ms = Date.now() - attemptStarted;
      const message = toMessage(error, endpoint);
      recordFailure(endpoint, message);
      attempts.push({
        provider: endpoint.provider,
        endpoint: endpoint.url,
        location: endpoint.location,
        ok: false,
        ms,
        resultCount: 0,
        error: message,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  if (!served) {
    // Nothing was even tried: every provider in the chain refused this KIND.
    // Only reachable when a provider is pinned — DuckDuckGo has no news mode,
    // so pinning it and asking for news lands here. "Every provider failed"
    // would be a lie, and an unhelpful one.
    if (attempts.length === 0) {
      const names = chain.map((endpoint) => endpoint.provider).join(", ");
      throw new SearchError(
        `No configured provider can serve a ${n.kind} search${n.provider ? ` — ${names} can't` : ""}. Try kind "web".`,
        { status: 400, code: "kind_unsupported" },
      );
    }

    const reasons = attempts
      .filter((a) => a.error)
      .map((a) => `${a.provider}${a.endpoint ? ` (${a.endpoint})` : ""}: ${a.error}`)
      .join(" · ");
    recordUsage({
      callerId: caller.id,
      callerKind: caller.kind,
      callerLabel: caller.label,
      app: n.label,
      kind: n.kind,
      query: n.query,
      provider: null,
      location: null,
      cached: false,
      degraded: true,
      ms: Date.now() - started,
      resultCount: 0,
      extracted: 0,
      ok: false,
      error: reasons.slice(0, 500) || "every provider failed",
    });
    throw new SearchError(
      `Every search provider failed. ${reasons || "No provider gave a reason."}`,
      { status: 502, code: "all_providers_failed", attempts },
    );
  }

  // ----- Extraction -------------------------------------------------------
  if (n.extractCount > 0 && served.results.length > 0) {
    const targets = served.results.slice(0, n.extractCount);
    const pages = await extractPages(targets.map((result) => result.url));
    served.results = served.results.map((result, index) =>
      index < pages.length ? { ...result, content: pages[index] } : result,
    );
  }

  served.ms = Date.now() - started;

  // Cache the search, extraction and all. Storing the extracted text is the
  // point: it is the expensive half, and an agent re-asking the same question a
  // minute later should not re-fetch ten pages.
  if (!n.noCache) await cacheSet(key, served);

  recordUsage({
    callerId: caller.id,
    callerKind: caller.kind,
    callerLabel: caller.label,
    app: n.label,
    kind: n.kind,
    query: n.query,
    provider: served.provider,
    location: served.location,
    cached: false,
    degraded: served.degraded,
    ms: served.ms,
    resultCount: served.results.length,
    extracted: served.results.filter((result) => result.content).length,
    ok: true,
    error: null,
  });

  return served;
}

// ---------------------------------------------------------------------------
// What the hub's other apps import.
//
// This is the whole point of the exercise: an app that needs to search calls
// `searchWeb("...")` and never learns that SearXNG exists, never holds a key,
// and never breaks when a provider is swapped. Server-side only — a browser
// component calls `/api/search` instead, so no key is ever near the client.
//
//   import { searchWeb, searchNews, research, readPage } from "@/lib/search/client";
//
//   const { results } = await searchWeb("best sourdough hydration", { app: "cookbook" });
//   const brief = await research("EU AI Act timeline", { extract: 5, app: "jarvis-agent" });
//
// Always pass `app` — it is what makes the dashboard able to say which app is
// spending the quota. It is one string and it costs nothing.
// ---------------------------------------------------------------------------

import "server-only";

import { SEARCH_LIMITS } from "./config";
import { runSearch } from "./orchestrator";
import type { Caller, ExtractedPage, Freshness, SearchRequest, SearchResponse } from "./types";
import { extractPage } from "./extract";

export interface InternalSearchOptions {
  /** The app or agent doing the asking, e.g. `cookbook`, `jarvis-agent`. */
  app?: string;
  limit?: number;
  freshness?: Freshness;
  language?: string;
  safe?: boolean;
  /** `true` reads the top 3 pages; a number reads the top N. */
  extract?: boolean | number;
  noCache?: boolean;
}

/**
 * Server code inside the hub is already past the door — middleware put it
 * there — so it searches as the hub itself rather than as a user. It still
 * gets a rate-limit bucket and still lands in the usage log, under the app
 * name it gave, so one runaway app is visible and containable.
 */
function internalCaller(app: string | undefined): Caller {
  const name = (app ?? "hub").slice(0, 60);
  return {
    kind: "key",
    id: `internal:${name}`,
    label: `${name} (in-process)`,
    // Generous, because this is the owner's own server calling its own
    // service, and a per-app bucket means a loop in one app cannot starve the
    // others.
    perMinute: Math.max(SEARCH_LIMITS.perMinute, 120),
    perDay: Math.max(SEARCH_LIMITS.perDay, 5000),
    scopes: ["search", "extract"],
    // The hub calling its own service on its own providers: the owner's plan,
    // and no person to bill it to.
    plan: "owner",
    ownerEmail: null,
  };
}

/**
 * One place that turns these options into a SearchRequest.
 *
 * Defaults are applied AFTER the caller's options are spread, never before: a
 * caller that passes `{ extract: undefined }` explicitly — which happens the
 * moment someone writes `{ extract: cfg.extract }` — would otherwise overwrite
 * the default with undefined and silently lose it.
 */
function toRequest(
  query: string,
  kind: NonNullable<SearchRequest["kind"]>,
  options: InternalSearchOptions,
  defaults: Partial<Pick<SearchRequest, "limit" | "extract" | "freshness">> = {},
): SearchRequest {
  const { app, ...rest } = options;
  return {
    ...rest,
    query,
    kind,
    limit: rest.limit ?? defaults.limit,
    extract: rest.extract ?? defaults.extract,
    freshness: rest.freshness ?? defaults.freshness,
    label: app,
  };
}

export function searchWeb(query: string, options: InternalSearchOptions = {}): Promise<SearchResponse> {
  return runSearch(toRequest(query, "web", options), internalCaller(options.app));
}

export function searchNews(query: string, options: InternalSearchOptions = {}): Promise<SearchResponse> {
  return runSearch(
    toRequest(query, "news", options, { freshness: "week" }),
    internalCaller(options.app),
  );
}

/**
 * A research query: more results, both pages of them, and the pages read.
 *
 * The defaults are the difference between "a list of links" and "something a
 * model can answer from", which is why extraction defaults ON here and off
 * everywhere else.
 */
export function research(query: string, options: InternalSearchOptions = {}): Promise<SearchResponse> {
  return runSearch(
    toRequest(query, "research", options, { limit: 20, extract: 5 }),
    internalCaller(options.app),
  );
}

/** Read one page. Returns an ExtractedPage with `error` set rather than throwing. */
export function readPage(url: string): Promise<ExtractedPage> {
  return extractPage(url);
}

/**
 * Results flattened to the lines a model reads well.
 *
 * Every app that hands search results to an LLM was going to write this, and
 * three of them would have written it differently. One numbered block per
 * result, source and date on the same line as the title, extracted text when
 * there is some.
 */
export function asPrompt(response: SearchResponse, options: { maxChars?: number } = {}): string {
  const maxChars = options.maxChars ?? 12_000;
  const head = response.answer ? `Direct answer: ${response.answer}\n\n` : "";
  const blocks = response.results.map((result, index) => {
    const date = result.publishedAt ? ` · ${result.publishedAt.slice(0, 10)}` : "";
    const body = result.content?.text
      ? `\n${result.content.text.slice(0, 2400)}`
      : result.description
        ? `\n${result.description}`
        : "";
    return `[${index + 1}] ${result.title}\n${result.url} (${result.source}${date})${body}`;
  });

  let out = head;
  for (const block of blocks) {
    if (out.length + block.length + 2 > maxChars) break;
    out += `${block}\n\n`;
  }
  return out.trim();
}

export type { SearchResponse, SearchResult, ExtractedPage } from "./types";

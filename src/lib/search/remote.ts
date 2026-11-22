// ---------------------------------------------------------------------------
// The client for everything OUTSIDE this repo.
//
// Another repo, a cron, an MCP server, the Jarvis harness, a Node script on
// the VPS — anything that cannot `import` the hub's internals talks to the
// service over HTTP, and this is that client. One file, no dependencies, no
// `server-only`, so it can be copied into any project as-is.
//
//   const search = createSearchClient({
//     baseUrl: process.env.JARVIS_SEARCH_URL,  // https://your-hub/api/search
//     apiKey:  process.env.JARVIS_SEARCH_KEY,  // jsk_…
//     app:     "my-agent",
//   });
//   const { results } = await search.web("who won the 2026 F1 opener");
//
// It retries once on a 5xx or a network blip and never on a 4xx, because a 4xx
// means the request was wrong and sending it again just burns the rate limit.
// ---------------------------------------------------------------------------

import type { ExtractedPage, Freshness, SearchKind, SearchResponse } from "./types";

export interface SearchClientOptions {
  /** The service root, e.g. `https://your-hub.vercel.app/api/search`. */
  baseUrl: string;
  /** A service key (`jsk_…`), or the value of SEARCH_SERVICE_KEY. */
  apiKey: string;
  /** Who is calling — shows up in the dashboard's per-app breakdown. */
  app?: string;
  /** Whole-request timeout. Default 30s: a research call with extraction is slow by nature. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RemoteSearchOptions {
  limit?: number;
  freshness?: Freshness;
  language?: string;
  safe?: boolean;
  extract?: boolean | number;
  noCache?: boolean;
}

export class SearchClientError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "SearchClientError";
    this.status = status;
    this.code = code;
  }
}

export interface SearchClient {
  web(query: string, options?: RemoteSearchOptions): Promise<SearchResponse>;
  news(query: string, options?: RemoteSearchOptions): Promise<SearchResponse>;
  research(query: string, options?: RemoteSearchOptions): Promise<SearchResponse>;
  extract(urls: string[]): Promise<ExtractedPage[]>;
  providers(): Promise<unknown>;
}

export function createSearchClient(options: SearchClientOptions): SearchClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function call<T>(path: string, body: unknown, attempt = 0): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        let message = `The search service returned ${response.status}.`;
        let code = "http_error";
        try {
          const payload = (await response.json()) as { error?: string; code?: string };
          if (payload.error) message = payload.error;
          if (payload.code) code = payload.code;
        } catch {
          /* Not JSON — the status line is all we have. */
        }
        // 5xx is worth one more try; 4xx never is.
        if (response.status >= 500 && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          return call<T>(path, body, 1);
        }
        throw new SearchClientError(message, response.status, code);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof SearchClientError) throw error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return call<T>(path, body, 1);
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new SearchClientError(`Couldn't reach the search service at ${base}: ${reason}`, 0, "unreachable");
    } finally {
      clearTimeout(timer);
    }
  }

  const search = (kind: SearchKind, query: string, opts: RemoteSearchOptions = {}) =>
    call<SearchResponse>(kind === "web" ? "" : `/${kind}`, { query, ...opts, label: options.app });

  return {
    web: (query, opts) => search("web", query, opts),
    news: (query, opts) => search("news", query, opts),
    research: (query, opts) => search("research", query, opts),
    extract: (urls) => call<{ pages: ExtractedPage[] }>("/extract", { urls, label: options.app }).then((r) => r.pages),
    providers: () => call<unknown>("/providers", undefined),
  };
}

export type { SearchResponse, SearchResult, ExtractedPage } from "./types";

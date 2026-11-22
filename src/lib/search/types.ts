// ---------------------------------------------------------------------------
// The shapes every caller of the central search service sees.
//
// This file is the contract. An app or agent asking for a search gets a
// SearchResponse whose `results` are SearchResult — the same five fields in the
// same order whether SearXNG on the laptop answered, SearXNG on the VPS
// answered, or Tavily picked up after both were down. Adding a provider later
// means writing an adapter that fills these in; it never means changing a
// caller.
//
// Nothing in here is provider-shaped on purpose. There is no `engines` on
// SearchResult because Tavily has no engines, no `score` semantics borrowed
// from one provider, and no raw payload passed through. What a provider knows
// that the others don't lands in `raw` on the attempt, which is diagnostic
// only and never what an app reads.
// ---------------------------------------------------------------------------

/** The three questions callers actually ask. */
export type SearchKind = "web" | "news" | "research";

export const SEARCH_KINDS: SearchKind[] = ["web", "news", "research"];

/** How fresh a result has to be. `any` means don't constrain it. */
export type Freshness = "day" | "week" | "month" | "year" | "any";

/**
 * One result, standardized.
 *
 * `publishedAt` is null far more often than it is set — most of the open web
 * does not say when a page was written, and SearXNG only has a date when the
 * upstream engine gave it one. A caller that needs dates should ask for
 * `kind: "news"`, where they are near-universal, rather than filtering web
 * results and finding most of them dropped.
 */
export interface SearchResult {
  title: string;
  url: string;
  /** The snippet. Called `description` because that is what it is to a caller. */
  description: string;
  /** Hostname, lowercased, `www.` stripped — what a human calls the source. */
  source: string;
  /** ISO 8601, or null when the page never said. */
  publishedAt: string | null;
  /** 0–1, normalized across providers. Null when the provider gave no ranking. */
  score: number | null;
  /** Which provider served this row — `searxng` or `tavily`. */
  provider: string;
  /** Set only when the request asked for extraction. */
  content?: ExtractedPage | null;
}

/** A page read and reduced to text an agent can reason over. */
export interface ExtractedPage {
  url: string;
  /** The URL actually read, after redirects. */
  finalUrl: string;
  title: string | null;
  /** Readable body text, whitespace-collapsed, scripts and chrome removed. */
  text: string;
  /** Words in `text` — the cheap way for a caller to judge whether it got a page or a cookie wall. */
  words: number;
  /** ISO 8601 from meta tags or JSON-LD, or null. */
  publishedAt: string | null;
  author: string | null;
  siteName: string | null;
  lang: string | null;
  /** True when the body was cut at the byte cap. */
  truncated: boolean;
  /** Set instead of `text` when the page could not be read. Plain English. */
  error?: string;
}

/** What a caller sends. Everything but `query` has a sane default. */
export interface SearchRequest {
  query: string;
  kind?: SearchKind;
  /** 1–50. Default 10 for web/news, 20 for research. */
  limit?: number;
  freshness?: Freshness;
  /** BCP-47-ish, e.g. `en`, `en-GB`, or `all`. Default `en`. */
  language?: string;
  /** Safe search. Default true. */
  safe?: boolean;
  /**
   * Read the pages, not just the snippets. `true` reads the top 3; a number
   * reads the top N (capped at 10). This is what makes a result set usable by
   * an agent that has to actually answer something.
   */
  extract?: boolean | number;
  /** Force one provider by id. Used by the dashboard's test bench, not by apps. */
  provider?: string;
  /** Skip the cache for this one call. */
  noCache?: boolean;
  /** Free-text label for usage tracking, e.g. `cook-connect`, `jarvis-agent`. */
  label?: string;
}

/** One provider's turn at a request — the record of what happened, win or lose. */
export interface ProviderAttempt {
  provider: string;
  /** Which instance, for providers that have more than one. */
  endpoint: string | null;
  /** Human label for the endpoint: `laptop`, `vps`, or `cloud`. */
  location: EndpointLocation | null;
  ok: boolean;
  ms: number;
  resultCount: number;
  /** Plain English when `ok` is false. */
  error?: string;
  /** True when this provider was skipped because its breaker was open. */
  skipped?: boolean;
}

export type EndpointLocation = "laptop" | "vps" | "cloud";

/** What every caller gets back. */
export interface SearchResponse {
  query: string;
  kind: SearchKind;
  results: SearchResult[];
  /**
   * A direct answer, when the serving provider had one. SearXNG surfaces these
   * from its instant-answer engines; Tavily generates one. Null is normal.
   */
  answer: string | null;
  /** The provider that actually served it. */
  provider: string;
  endpoint: string | null;
  location: EndpointLocation | null;
  cached: boolean;
  /** Seconds since the cached copy was stored. Null when not cached. */
  cacheAge: number | null;
  /** Wall-clock milliseconds for the whole call, cache and extraction included. */
  ms: number;
  /** Every provider's turn, in order. The dashboard reads this. */
  attempts: ProviderAttempt[];
  /**
   * True when the preferred provider did not serve it — a fallback did. The
   * results are still good; this is the signal that something upstream needs
   * looking at, and it is why the dashboard can show a problem before anyone
   * notices one.
   */
  degraded: boolean;
  requestId: string;
}

/** A failure a caller can show a person without translating it. */
export class SearchError extends Error {
  readonly status: number;
  readonly attempts: ProviderAttempt[];
  readonly code: string;

  constructor(
    message: string,
    options: { status?: number; code?: string; attempts?: ProviderAttempt[] } = {},
  ) {
    super(message);
    this.name = "SearchError";
    this.status = options.status ?? 502;
    this.code = options.code ?? "search_failed";
    this.attempts = options.attempts ?? [];
  }
}

/** Who is calling, resolved before anything is spent on their behalf. */
export interface Caller {
  /** `key` for a service key, `session` for a signed-in person in a browser. */
  kind: "key" | "session";
  /** Stable id used for rate-limit buckets and usage rows. */
  id: string;
  /** Shown in the dashboard: the key's name, or the person's email. */
  label: string;
  perMinute: number;
  perDay: number;
  /** What this caller may do. A key can be read-only on extraction, say. */
  scopes: Scope[];
  /**
   * Which plan's ceiling applies. `owner` is the hub owner's own agents;
   * `member` and `trial` are people the owner has given access to.
   */
  plan: Plan;
  /**
   * The person a key was issued to, when it was issued to someone. Null for
   * the owner's own keys. Carried onto every usage row so "what is this member
   * costing me" survives the key being revoked and replaced.
   */
  ownerEmail: string | null;
}

export type Plan = "owner" | "member" | "trial";

export type Scope = "search" | "extract" | "admin";

export const ALL_SCOPES: Scope[] = ["search", "extract", "admin"];

/** Live state of one provider instance, as the dashboard shows it. */
export interface ProviderStatus {
  provider: string;
  label: string;
  endpoint: string | null;
  location: EndpointLocation | null;
  configured: boolean;
  /** `up`, `down`, `open` (breaker tripped), or `unconfigured`. */
  state: "up" | "down" | "open" | "unconfigured";
  /** Milliseconds for the health probe, or null when it was not probed. */
  latencyMs: number | null;
  /** Plain English when the state is not `up`. */
  detail: string | null;
  /** Consecutive failures counted by the breaker. */
  failures: number;
  /** ISO when the breaker lets traffic through again. */
  openUntil: string | null;
  /** Where this instance sits in the fallback chain. Lower goes first. */
  priority: number;
  kinds: SearchKind[];
  /** The env var that turns it on, so the dashboard can say what is missing. */
  envVar: string;
}

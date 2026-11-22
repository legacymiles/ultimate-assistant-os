// ---------------------------------------------------------------------------
// Where the search service looks, and in what order.
//
// The ordering rule the owner asked for, stated once so it is not re-derived
// in three places: a SearXNG on this machine is preferred, a SearXNG on the
// VPS is next, and Tavily is the floor. So the laptop answers while the laptop
// is on, the VPS answers the rest of the time, and a paid provider is only
// touched when both self-hosted instances are unreachable.
//
// The honest caveat, because it changes how this gets deployed: a laptop
// instance is only preferred for code RUNNING on the laptop. The hub deployed
// on Vercel cannot reach 127.0.0.1 on a laptop in another country, and
// pretending otherwise would mean every production search waiting out a
// connect timeout before falling through. That is not a special case in the
// code — it falls out of a localhost endpoint simply failing fast from
// anywhere else — but it does mean the production chain is VPS then Tavily,
// and the dev chain is laptop then VPS then Tavily. `SEARXNG_LOCAL_URL` is
// read in every environment so a tunnelled laptop can be put first on purpose.
//
// Everything here is read from the environment at call time, never at module
// load, so a key added in Vercel takes effect on the next request in dev and
// on the next deploy in production without a code change.
// ---------------------------------------------------------------------------

import type { EndpointLocation, SearchKind } from "./types";

/** Every provider the service knows how to speak to. */
export type ProviderId = "searxng" | "duckduckgo" | "tavily";

/** One SearXNG instance, or the single endpoint of a hosted provider. */
export interface ProviderEndpoint {
  provider: ProviderId;
  /** Base URL, no trailing slash. Null for Tavily, which has a fixed host. */
  url: string | null;
  location: EndpointLocation;
  /** Lower goes first in the fallback chain. */
  priority: number;
  /** Optional shared secret sent as a bearer token — for a SearXNG behind a gate. */
  token: string | null;
  label: string;
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function num(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Strip the trailing slash so `${url}/search` never doubles up. */
function clean(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * A URL pointing at this machine. These are the ones that are free, instant
 * and only reachable from here.
 */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host === "host.docker.internal" ||
      host.endsWith(".local") ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

/**
 * Every configured SearXNG instance, laptop first.
 *
 * Three env vars feed this, and they compose:
 *   SEARXNG_LOCAL_URL   one instance on this machine      (priority 10)
 *   SEARXNG_URL         the main instance, usually the VPS (priority 20)
 *   SEARXNG_URLS        comma-separated extras, in order   (priority 30+)
 *
 * A URL that looks local is always promoted to the laptop tier whichever var
 * it arrived in, because the ordering should follow what the URL *is* rather
 * than which name someone happened to put it under.
 */
export function searxngEndpoints(): ProviderEndpoint[] {
  const seen = new Set<string>();
  const out: ProviderEndpoint[] = [];
  const token = env("SEARXNG_TOKEN") || null;

  const add = (raw: string, basePriority: number) => {
    const url = clean(raw.trim());
    if (!url || seen.has(url)) return;
    seen.add(url);
    const local = isLocalUrl(url);
    out.push({
      provider: "searxng",
      url,
      location: local ? "laptop" : "vps",
      priority: local ? 10 : basePriority,
      token,
      label: local ? "SearXNG · this machine" : `SearXNG · ${hostLabel(url)}`,
    });
  };

  add(env("SEARXNG_LOCAL_URL"), 10);
  add(env("SEARXNG_URL"), 20);
  env("SEARXNG_URLS")
    .split(",")
    .filter(Boolean)
    .forEach((raw, i) => add(raw, 30 + i));

  return out.sort((a, b) => a.priority - b.priority);
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * DuckDuckGo is on unless it is turned off.
 *
 * It needs no key, and the hub searched the web through it before this service
 * existed, so defaulting it off would be a regression for a deployment with no
 * SearXNG yet. Set SEARCH_ENABLE_DUCKDUCKGO=false to drop it from the chain.
 */
export function duckduckgoConfigured(): boolean {
  return env("SEARCH_ENABLE_DUCKDUCKGO").toLowerCase() !== "false";
}

export function duckduckgoEndpoint(): ProviderEndpoint {
  return {
    provider: "duckduckgo",
    url: "https://html.duckduckgo.com",
    location: "cloud",
    // Free, so ahead of Tavily; scraped HTML with no contract, so behind a
    // SearXNG the owner runs.
    priority: 50,
    token: null,
    label: "DuckDuckGo · cloud",
  };
}

export function tavilyConfigured(): boolean {
  return Boolean(env("TAVILY_API_KEY"));
}

export function tavilyKey(): string {
  return env("TAVILY_API_KEY");
}

export function tavilyEndpoint(): ProviderEndpoint {
  return {
    provider: "tavily",
    url: "https://api.tavily.com",
    location: "cloud",
    priority: 100,
    token: null,
    label: "Tavily · cloud",
  };
}

/**
 * The full chain for a request, best first.
 *
 * `forced` is the dashboard's test bench pinning one provider so a person can
 * see whether the VPS really is up, rather than watching the chain quietly
 * route around it.
 */
export function chainFor(kind: SearchKind, forced?: string): ProviderEndpoint[] {
  const chain = allEndpoints();

  // `kind` does not reorder the chain: a research request wants breadth, and it
  // gets it from the orchestrator asking for more pages, not from preferring a
  // paid provider. A provider that cannot serve a kind at all is dropped by the
  // orchestrator against the adapter's own `kinds` — DuckDuckGo has no news
  // mode, so a news request skips straight past it.
  void kind;

  return forced ? chain.filter((e) => e.provider === forced) : chain;
}

/**
 * Every configured endpoint, best first. The one list the chain, the dashboard
 * and the health page all read, so they can never disagree about what exists.
 */
export function allEndpoints(): ProviderEndpoint[] {
  const chain: ProviderEndpoint[] = [...searxngEndpoints()];
  if (duckduckgoConfigured()) chain.push(duckduckgoEndpoint());
  if (tavilyConfigured()) chain.push(tavilyEndpoint());
  return chain.sort((a, b) => a.priority - b.priority);
}

/** Nothing is configured at all — the dashboard says so rather than failing oddly. */
export function anyProviderConfigured(): boolean {
  return allEndpoints().length > 0;
}

export const SEARCH_LIMITS = {
  /** Cache lifetime for a repeated identical search. */
  get cacheTtlSeconds(): number {
    return num("SEARCH_CACHE_TTL_SECONDS", 3600);
  },
  /** Cache lifetime for an extracted page — pages change slower than rankings. */
  get extractTtlSeconds(): number {
    return num("SEARCH_EXTRACT_TTL_SECONDS", 86400);
  },
  /** Default per-caller ceilings. A service key may carry its own instead. */
  get perMinute(): number {
    return num("SEARCH_RATE_PER_MINUTE", 60);
  },
  get perDay(): number {
    return num("SEARCH_RATE_PER_DAY", 2000);
  },
  /** How long one provider gets before the chain moves on. */
  get providerTimeoutMs(): number {
    return num("SEARCH_PROVIDER_TIMEOUT_MS", 8000);
  },
  /** How long one page fetch gets during extraction. */
  get extractTimeoutMs(): number {
    return num("SEARCH_EXTRACT_TIMEOUT_MS", 12000);
  },
  /** Hard cap on bytes read from a page, so one PDF-sized HTML file can't blow memory. */
  get extractMaxBytes(): number {
    return num("SEARCH_EXTRACT_MAX_BYTES", 1_500_000);
  },
  /** Characters of extracted text handed back per page. */
  get extractMaxChars(): number {
    return num("SEARCH_EXTRACT_MAX_CHARS", 24_000);
  },
  /** Consecutive failures before an endpoint is skipped for a while. */
  get breakerThreshold(): number {
    return num("SEARCH_BREAKER_THRESHOLD", 3);
  },
  /** How long a tripped endpoint stays skipped. */
  get breakerCooldownMs(): number {
    return num("SEARCH_BREAKER_COOLDOWN_MS", 60_000);
  },
  /** Pages extracted in parallel. Politeness, and a cap on burst memory. */
  get extractConcurrency(): number {
    return num("SEARCH_EXTRACT_CONCURRENCY", 3);
  },
} as const;

/** Default result count per kind. */
export function defaultLimit(kind: SearchKind): number {
  return kind === "research" ? 20 : 10;
}

/**
 * What the dashboard needs to tell the owner which env var to set, and what
 * setting it buys them. Checklist rule R4: never leave a missing key as a
 * silent dead end.
 */
export const ENV_GUIDE: { name: string; unlocks: string; required: boolean }[] = [
  {
    name: "SEARXNG_URL",
    unlocks: "The always-on SearXNG on your VPS. This is the primary provider — set this one first.",
    required: true,
  },
  {
    name: "SEARXNG_LOCAL_URL",
    unlocks: "A SearXNG on this machine, preferred over the VPS while you're at the desk. Usually http://127.0.0.1:8080.",
    required: false,
  },
  {
    name: "TAVILY_API_KEY",
    unlocks: "The fallback that answers when both self-hosted instances are unreachable, and the better engine for deep research.",
    required: false,
  },
  {
    name: "SEARCH_ENABLE_DUCKDUCKGO",
    unlocks:
      "On by default, and the keyless floor the hub used before this service existed. Set it to false to drop DuckDuckGo from the chain — worth doing once your SearXNG is reliable, since it rate-limits datacentre addresses.",
    required: false,
  },
  {
    name: "SEARXNG_TOKEN",
    unlocks: "A bearer token sent to your SearXNG instances, if you put them behind a gate rather than leaving them open.",
    required: false,
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    unlocks: "Shared cache, service keys, rate limits and usage history. Without it the service still searches, but counts reset on every cold start and keys can't be issued.",
    required: false,
  },
];

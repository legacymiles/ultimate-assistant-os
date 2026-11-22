# The search API

One endpoint every Jarvis app and agent uses to search the web. No app holds a
provider, a key, or a fallback of its own.

- **Dashboard** — [`/apps/search-infrastructure`](../src/app/apps/search-infrastructure/page.tsx)
- **Code** — [`src/lib/search/`](../src/lib/search)
- **Routes** — [`src/app/api/search/`](../src/app/api/search)
- **SearXNG setup** — [`infra/searxng/README.md`](../infra/searxng/README.md)

---

## The chain

A request walks this list and stops at the first provider that answers:

| # | Provider | Where | Cost | Notes |
|---|---|---|---|---|
| 1 | SearXNG | this machine (`SEARXNG_LOCAL_URL`) | free | only reachable by code running on the laptop |
| 2 | SearXNG | the VPS (`SEARXNG_URL`) | free | the one that matters in production |
| 3 | DuckDuckGo | cloud | free | keyless floor; rate-limits datacentre IPs |
| 4 | Tavily | cloud (`TAVILY_API_KEY`) | paid per call | the fallback, and the better engine for research |

Three things make that list behave rather than just exist:

- **A circuit breaker.** Three consecutive failures and an endpoint is skipped
  for a minute. Without it, a sleeping laptop adds its full connect timeout to
  *every* search. The last provider in the chain is tried even with its breaker
  open — half-open — because returning a failure while something untried might
  have worked is worse than one slow request.
- **`degraded`** comes back `true` whenever the first choice did not serve it.
  The results are still good; it is the signal that something upstream needs
  looking at, and it is why the dashboard can show a problem before anyone
  notices one.
- **A provider that cannot serve a kind is skipped for it.** DuckDuckGo's HTML
  endpoint has no news mode and no dates, so `kind: "news"` goes straight past
  it rather than returning dateless rows.

## Auth

Two kinds of caller, because there are genuinely two.

**A service key** — an agent, a cron, the Jarvis harness, another repo. Not a
browser, has no session, never will:

```bash
curl -s https://your-hub/api/search -H "Authorization: Bearer jsk_…" -H "Content-Type: application/json" --data '{"query":"hello","app":"my-agent"}'
```

Issue one in the dashboard. It is shown once and stored only as a SHA-256 hash,
so a database dump is not a set of working credentials. Keys carry their own
rate limits and get their own row in the usage breakdown.

`X-Search-Key: jsk_…` also works, for callers that cannot set `Authorization`.

**The signed-in owner** — a hub page in the browser rides the Supabase session
cookie middleware already maintains. Nothing extra to do.

**No database?** Set `SEARCH_SERVICE_KEY` to any long random string on both
ends and use it as the bearer token. One shared key with the default limits —
enough for the owner's own machines, which is all it is for.

`/api/search/keys` and `/api/search/cache` are **owner-session only**: a
service key cannot mint another service key, and one caller cannot throw away
every other caller's cache.

## Endpoints

Every search endpoint takes the same body on `POST`, or the same fields as
query parameters on `GET` (`q` or `query`).

| Endpoint | What it is |
|---|---|
| `GET POST /api/search` | general web search |
| `GET POST /api/search/news` | news — results carry publication dates |
| `GET POST /api/search/research` | 20 results, several pages, advanced depth on Tavily |
| `GET POST /api/search/extract` | read pages, no search — up to 10 URLs |
| `GET /api/search/providers` | provider status, free, from what the last real searches learned |
| `POST /api/search/providers` | probe them for real (`{"probeTavily": true}` to spend a credit on Tavily too) |
| `GET /api/search/usage?hours=24` | totals, cache hit rate, latency percentiles, breakdowns |
| `GET POST DELETE /api/search/keys` | list, mint, revoke — owner only |
| `DELETE /api/search/cache` | empty it — owner only |

### Request

```json
{
  "query": "EU AI Act compliance deadlines",
  "limit": 10,
  "freshness": "month",
  "language": "en",
  "safe": true,
  "extract": 3,
  "noCache": false,
  "app": "jarvis-agent"
}
```

| Field | Default | Notes |
|---|---|---|
| `query` | — | required, up to 500 characters |
| `limit` | 10 (20 for research) | capped at 50 |
| `freshness` | `any` | `day` · `week` · `month` · `year` · `any` |
| `language` | `en` | or `all` |
| `safe` | `true` | |
| `extract` | off | `true` reads the top 3, a number reads the top N (max 10) |
| `provider` | auto | pin one by id — the dashboard's test bench, not for apps |
| `noCache` | `false` | skip the cache for this one call |
| `app` | — | **always send it.** It is what makes the dashboard able to say which app is spending the quota |

### Response

```json
{
  "query": "EU AI Act compliance deadlines",
  "kind": "web",
  "results": [
    {
      "title": "…",
      "url": "https://…",
      "description": "…",
      "source": "europa.eu",
      "publishedAt": "2026-02-02T00:00:00.000Z",
      "score": 0.91,
      "provider": "searxng",
      "content": null
    }
  ],
  "answer": null,
  "provider": "searxng",
  "endpoint": "https://search.example.com",
  "location": "vps",
  "cached": false,
  "cacheAge": null,
  "ms": 742,
  "degraded": false,
  "attempts": [
    { "provider": "searxng", "endpoint": "http://127.0.0.1:8080", "location": "laptop", "ok": false, "ms": 12, "resultCount": 0, "error": "Nothing is listening at http://127.0.0.1:8080. Is SearXNG running, and on that port?" },
    { "provider": "searxng", "endpoint": "https://search.example.com", "location": "vps", "ok": true, "ms": 712, "resultCount": 10 }
  ],
  "requestId": "…"
}
```

`publishedAt` is `null` more often than not on web results — most of the open
web does not say when a page was written. Ask for `kind: "news"` when you need
dates rather than filtering web results and losing most of them.

`score` is normalized to 0–1 across providers. SearXNG's native score is an
unbounded sum of per-engine weights, so it is divided by the top score in the
same response; Tavily's is already relevance.

### Extraction

`extract` is what makes the service usable by an agent rather than a person. A
160-character snippet is enough for a human deciding what to click, and nowhere
near enough for a model answering a question.

```json
"content": {
  "url": "https://…",
  "finalUrl": "https://…",
  "title": "…",
  "text": "the readable body, whitespace-collapsed…",
  "words": 1840,
  "publishedAt": "2026-02-02T00:00:00.000Z",
  "author": "…",
  "siteName": "…",
  "lang": "en",
  "truncated": false
}
```

A page that cannot be read comes back with `error` set and empty text, never as
a thrown exception — losing the other nine results to one paywall is the wrong
trade. Pages that only render with JavaScript fall back to Tavily's renderer
when a key is set.

**Private network addresses are refused.** This endpoint takes a URL from a
caller and fetches it server-side, which is the exact shape of an SSRF, so
every hostname is resolved and *all* its addresses checked against the private
ranges — loopback, RFC1918, link-local (including `169.254.169.254`, the cloud
metadata endpoint that hands out credentials), CGNAT, and IPv4-mapped IPv6 —
before and after redirects.

### Errors

Always `{ "error": "<a sentence>", "code": "<slug>" }`, and the sentence is
meant to be shown to a person as-is.

| Status | `code` | Means |
|---|---|---|
| 400 | `no_query`, `query_too_long`, `bad_body`, `too_many_urls` | the request was wrong |
| 401 | `no_auth`, `bad_key` | no credential, or an unrecognised one |
| 403 | `not_owner`, `not_admin`, `missing_scope` | authenticated, not allowed |
| 429 | `rate_limited` | over the minute or day ceiling; carries `Retry-After` |
| 502 | `all_providers_failed` | carries `attempts`, each with its own reason |
| 503 | `no_provider`, `no_storage` | nothing configured to serve it |

---

## Calling it

### From inside this hub — no key, no HTTP

```ts
import { searchWeb, searchNews, research, readPage, asPrompt } from "@/lib/search/client";

const { results } = await searchWeb("best sourdough hydration", { app: "cookbook" });
const headlines = await searchNews("gold price", { freshness: "week", app: "finance" });

// Research defaults to 20 results with the top 5 pages read — the difference
// between a list of links and something a model can answer from.
const brief = await research("EU AI Act timeline", { app: "jarvis-agent" });
const context = asPrompt(brief);            // numbered blocks, ready for a prompt

const page = await readPage("https://example.com/post");
```

Server-side only (it is `server-only`). A browser component calls `/api/search`
instead, so no key is ever near the client.

### From another repo, an agent or a cron

Copy [`src/lib/search/remote.ts`](../src/lib/search/remote.ts) — one file, no
dependencies — or write the three lines of `fetch` yourself.

```ts
import { createSearchClient } from "./search-client";

const search = createSearchClient({
  baseUrl: process.env.JARVIS_SEARCH_URL!,   // https://your-hub/api/search
  apiKey:  process.env.JARVIS_SEARCH_KEY!,   // jsk_…
  app:     "my-agent",
});

const { results } = await search.web("who won the 2026 F1 opener");
const pages = await search.extract(results.slice(0, 3).map((r) => r.url));
```

It retries once on a 5xx or a network blip and never on a 4xx — a 4xx means the
request was wrong, and sending it again just burns the rate limit.

### From a shell

```bash
curl -s "https://your-hub/api/search?q=hello&limit=5&app=shell" -H "Authorization: Bearer $JARVIS_SEARCH_KEY" | jq '.results[] | {title, url}'
```

---

## Environment variables

On the **hub** (`.env.local` locally, Vercel in production):

| Variable | Required | What it buys |
|---|---|---|
| `SEARXNG_URL` | **yes** | the always-on VPS instance — the primary provider |
| `SEARXNG_TOKEN` | with a public instance | the bearer token Caddy demands |
| `SEARXNG_LOCAL_URL` | no | an instance on this machine, preferred while you are at the desk |
| `SEARXNG_URLS` | no | extra instances, comma-separated, in order |
| `TAVILY_API_KEY` | no | the paid fallback, and advanced depth for research |
| `SEARCH_ENABLE_DUCKDUCKGO` | no | on by default; `false` drops it from the chain |
| `SEARCH_SERVICE_KEY` | no | one shared bearer token, for when there is no database yet |
| `SUPABASE_SERVICE_ROLE_KEY` | no | shared cache, service keys, rate limits, usage history |

Tunables, all with sane defaults — `SEARCH_CACHE_TTL_SECONDS` (3600),
`SEARCH_EXTRACT_TTL_SECONDS` (86400), `SEARCH_RATE_PER_MINUTE` (60),
`SEARCH_RATE_PER_DAY` (2000), `SEARCH_PROVIDER_TIMEOUT_MS` (8000),
`SEARCH_EXTRACT_TIMEOUT_MS` (12000), `SEARCH_EXTRACT_MAX_BYTES` (1500000),
`SEARCH_EXTRACT_MAX_CHARS` (24000), `SEARCH_EXTRACT_CONCURRENCY` (3),
`SEARCH_BREAKER_THRESHOLD` (3), `SEARCH_BREAKER_COOLDOWN_MS` (60000).

Nothing here is read at module load, so a value changed in Vercel takes effect
on the next deploy without a code change — and in dev, on the next request.

**Without `SUPABASE_SERVICE_ROLE_KEY` the service still searches.** What you
lose is everything that has to be *shared*: the cache stops being shared
between serverless instances, rate counters count per-instance, usage history
dies with the process, and service keys cannot be issued. The dashboard says
which mode it is in rather than pretending.

## Storage

Four tables, created by
[`supabase/migrations/20261122090000_search_infrastructure.sql`](../supabase/migrations/20261122090000_search_infrastructure.sql).
Every one is RLS-on with **no policy**, so the anon key in a browser reads
nothing at all and only the server, holding the service-role key, touches them.

| Table | Holds |
|---|---|
| `search_cache` | one row per distinct search, payload and all |
| `search_api_keys` | name, prefix, SHA-256 hash, scopes, limits, call count |
| `search_rate_counters` | one row per caller per window, bumped atomically by `search_rate_bump()` |
| `search_usage` | one row per call — caller, app, provider, cached, ms, result count, error |

The rate limiter is a Postgres function rather than a read-then-write from the
app, because ten parallel searches from one agent would otherwise all read the
same count and all pass a limit of one.

## Adding a provider

1. Write `src/lib/search/providers/<name>.ts` exporting a `SearchProviderAdapter`.
2. Add it to the map in `src/lib/search/providers/index.ts`.
3. Give it an id in `ProviderId` and an endpoint in `src/lib/search/config.ts`,
   with a `priority` that puts it in the right place in the chain (free before
   paid, owner-run before third-party).

Nothing else changes. No app learns its name. The DuckDuckGo adapter exists
partly as proof: it was a hardcoded scrape inside `lib/web/fetchPublic.ts`
before, and becoming a provider is all it took.

## Who uses it

| Caller | Through |
|---|---|
| Jarvis's `web_search` / `web_read` tools | `/api/new-jarvis/web` → `lib/search/client` |
| Profiles research | `lib/web/fetchPublic` → `lib/search/client` |
| Money Agents — campaign finder | `lib/search/client` (`searchWeb`) |
| Money Agents — Opportunity Radar | `lib/search/client` (`searchNews`), as the backup when the RSS feed fails |
| the dashboard's test bench | `/api/search` — the same public endpoint an app uses |

Two apps still have the model do their searching inline, through OpenRouter's
web plugin rather than this service: **Buildflip 2** (live prices and sold
comps) and **TikTok Dances** (the daily dance). That is a model feature rather
than a search call — the model searches mid-generation and cites what it found
— so moving them means restructuring the generation itself, which is a separate
change with real behaviour risk. They are the remaining two, and they are
deliberate.

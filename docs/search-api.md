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

## Giving someone else access

The service is multi-tenant. A key is issued **to an email address**, carries
its own ceiling, and can be set to expire.

| Plan | Per minute | Per day | For |
|---|---|---|---|
| `owner` | 60 | 2000 | your own agents, crons and repos |
| `member` | 20 | 500 | someone you have given access to |
| `trial` | 5 | 50 | someone trying it out |

A member's ceiling is deliberately not "slightly less than yours" — it is small
enough that one person cannot empty a paid provider's balance on their own. All
six numbers are overridable (`SEARCH_MEMBER_PER_DAY` and friends), and the owner
can also set an explicit `perMinute`/`perDay` on one key to lift one person
above their plan without inventing a fourth plan for them.

**Issuing one.** In the console's Service keys panel, switch *For* from **me**
to **member** or **trial**, give the address, optionally set an expiry, and
Issue. The key is shown once; send it to them.

A key issued to someone else can never land on the `owner` plan, even if the
request asks for it — far more likely a mistake than an intention, and the cost
of honouring it is your whole Tavily balance. That rule is
`planForRecipient()` and it has its own test.

**Keyed on the address, not the account.** You issue a key before the person
has signed in — that is the normal order. The key attaches itself to their
account the first time they sign in with that address, and never moves between
accounts afterwards, so a second sign-up on the same address cannot take one
over.

**What they see.** `/apps/search-access` — reachable without the owner gate,
because the people it exists for are by definition not the owner. Signed out it
shows a sign-in prompt; signed in it shows what they hold, their ceiling, what
they have used, and the lines that call the API. It never shows a key (there is
nothing to show — keys are stored as hashes), never names a provider, and never
hints that anyone else exists. A signed-in account with no key gets told to ask
you for one; having a hub account is not the same as having been given access.

**What you see.** The console's People panel: one row per person, their plan,
their calls, their failures and when they last called. Usage rows carry the
address, so that survives the key being revoked and replaced.

**Revoking.** Revoke in the console and it stops working immediately. An
expired key is treated as revoked at the moment it expires, not whenever a
sweep next runs.

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
| `GET POST DELETE /api/search/keys` | list, issue, revoke — owner only |
| `GET /api/search/account` | what the signed-in person holds — any account, not just the owner |
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
| `SEARCH_MEMBER_PER_MINUTE` / `_PER_DAY` | no | the `member` ceiling (20 / 500) |
| `SEARCH_TRIAL_PER_MINUTE` / `_PER_DAY` | no | the `trial` ceiling (5 / 50) |
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
| `search_usage` | one row per call — caller, the person it belongs to, app, provider, cached, ms, result count, error |

`20261122140000_search_members.sql` adds the multi-tenant half: `owner_email`,
`owner_user_id`, `plan` and `expires_at` on keys, the same two on usage rows, and
`search_key_claim()` / `search_keys_expire()`. **Both migrations have to be applied
before a key can be issued** — until then the console says so and disables the form
rather than failing on submit.

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

## A result is a page

Every adapter returns through `dedupe` in
[`providers/base.ts`](../src/lib/search/providers/base.ts), and that is where
`serveableUrl` drops a row whose URL is not a page: a search engine's own
click-through (`duckduckgo.com/y.js`, `bing.com/aclick`, `google.*/url`,
`r.search.yahoo.com`), an ad network's tracker (`doubleclick.net`,
`googleadservices.com`), anything that is not `http(s)`, and anything over 400
characters — past that the address *is* tracking payload. Host matching is
anchored, so `notduckduckgo.com` is an ordinary result.

It is here rather than in each app because every caller has the same problem
and only one of them would remember to solve it. An app that puts a result URL
in front of a person — BuildFlip's buy links, Jarvis citing a source — needs
that URL to resolve. SearXNG is on the host list deliberately: it proxies the
same engines, so a sponsored row comes through its JSON unchanged. This is not
a DuckDuckGo quirk patched in the wrong place.

**What found it.** BuildFlip's first live pricing run came back with
`duckduckgo.com/y.js?ad_domain=amazon.com&…` as the top result for "2x4x8
pressure treated lumber price buy" — 1,200 characters of tracking, titled
"Amazon Official Site", on its way to becoming a buy link on someone's build
plan. The DuckDuckGo adapter *had* refused ads since October, which is what
made it worth chasing rather than patching over: `unwrapDdgLink` dropped a bare
`y.js` href but followed DuckDuckGo's ordinary `/l/?uddg=` redirect straight
onto one, because it unwrapped a layer without judging what it unwrapped to.
The parser in [`lib/new-jarvis/web.ts`](../src/lib/new-jarvis/web.ts) now
applies the same rule to the target, with a bound on nested redirects — which
fixes it for Jarvis's `web_search` and for Profiles research too, since all
three share that parser. `serveableUrl` is the second line of defence, at the
layer where this stops being one provider's problem.

## Who uses it

| Caller | Through |
|---|---|
| Jarvis's `web_search` / `web_read` tools | `/api/new-jarvis/web` → `lib/search/client` |
| Profiles research | `lib/web/fetchPublic` → `lib/search/client` |
| Money Agents — campaign finder | `lib/search/client` (`searchWeb`) |
| Money Agents — Opportunity Radar | `lib/search/client` (`searchNews`), as the backup when the RSS feed fails |
| BuildFlip 2 — material prices | `lib/buildflip-2/ai/web-context` → `research` (`extract: 2`), one search per material, `app: "buildflip-2/price"` |
| BuildFlip 2 — sold comps | `lib/buildflip-2/ai/web-context` → `research` (`extract: 4`), two sold-listing queries, `app: "buildflip-2/comps"` |
| TikTok Dances — the daily dance | `lib/dances/daily` → `searchNews` (`freshness: "week"`, web at a month as the floor), `app: "dances/daily"` |
| the dashboard's test bench | `/api/search` — the same public endpoint an app uses |

Nothing on this hub searches the web any other way. Both of the apps that used
to — BuildFlip 2 and TikTok Dances, which passed OpenRouter's web plugin and a
`:online` model id and let the MODEL search mid-generation — were restructured
into search-then-generate on 2026-11-22: search here, read the pages, hand the
model the text. A grep for `plugins: [{ id: "web"` or `:online` over `src/`
returns nothing but the comments explaining their absence.

### What the restructure changed, measured honestly

Worth writing down, because "the model searches for itself" is a real feature
and giving it up has to buy something.

**BuildFlip 2 came out better**, for one reason that matters more than the rest:
the URLs. Its prompts used to have to *beg* the model not to produce a
plausible-looking product URL it had never seen, because only the model knew
what it had looked at and nothing could check. Now every citable URL came out of
a search response, and `allowedUrl` drops anything that is not one — so a buy
link on a plan either resolves or is not shown, which is the whole promise of
the app. A price is also a figure that lives *inside* a product page rather than
in a snippet, so `extract` on the top two results per material reads better than
the plugin's result list did. It costs more searches (one per material, capped
at 16, four at a time) but they are free on SearXNG, shared through the cache,
and the model call drops from a search-premium model to a plain completion that
any provider in the hub's retry ladder can serve — the old body carried an
OpenRouter-only field, so a retry onto the gateway failed the plan outright.

**TikTok Dances is roughly even**, and the one place to watch. One model that
searches as it answers is genuinely good at "what is trending this week", and a
news search plus a cheap reader is a slightly blunter instrument: it depends on
a dance having been *written about*, where the model's own search could surface
a video or a post. What makes it acceptable is that the app never trusted the
model's answer anyway — every name goes through `resolveVideo`, the same gate
the seed passed, so a bad name dies before it reaches the vault — and the
keyless YouTube path is still there underneath, which is a different slice of
the internet and needs no key at all. It is cheaper, it is cached, and it is in
the usage log. If a month of picks come back thin, the honest fix is a better
query or Tavily's news depth, not a search model back inside the generation.

**Two things the first live run taught us.** The first turned out to be this
service's bug rather than BuildFlip's — see *A result is a page* above. The
second: a model asked to *explain* an estimate writes long, and a 300-character
`note` and a 700-character `marketNote` each threw a ZodError that cost the
whole pass its answer, so BuildFlip's `schema.ts` now trims those fields
instead of rejecting them. One chatty sentence must not cost a plan its
prices.

**On a machine with no SearXNG, expect the degrade path.** DuckDuckGo
rate-limits after a handful of queries — sixteen material searches is well past
that — and its answer is then an empty page, which the chain reports as every
provider having failed. That is the whole argument for `SEARXNG_URL` being the
one required variable: without it these two apps work, but mostly by degrading.

**Both degrade instead of throwing.** `research` and `searchNews` raise on a
dead provider chain; every call site here catches that and carries on with an
empty context. BuildFlip then prices from market knowledge with every row
marked low-confidence, no URL, and a line on the plan saying these are
estimates rather than today's shelf prices — it does not fall to the demo
catalog, because the spec is real. Comps come back empty with a market note,
and the existing rule that an empty answer never overwrites comps already held
does the rest. Dances hands the day to the keyless YouTube path.

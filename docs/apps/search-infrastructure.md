# Search Infrastructure

Route: `/apps/search-infrastructure` · Category: Utilities · Live

Record reviewed: 2026-11-22

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- search-infrastructure "what to change"`.

## What it does

The web search every other app in this hub calls, so none of them holds a provider or a key. A
request walks a chain: SearXNG on this machine first, SearXNG on the VPS next, DuckDuckGo, then
Tavily — so searches are free and private while the laptop is on, keep working from the VPS when
it isn't, and only reach a paid provider when nothing self-hosted is reachable. Three typed
questions come out of it — web, news and research — and every answer has the same five fields
whichever provider served it: title, URL, description, source, and a publication date when the
page gave one.

The part that makes it usable by an agent rather than a person is extraction: ask for it and the
top results come back with the pages actually read and reduced to text, which is the difference
between a list of links and something a model can answer from. Identical searches are cached,
every caller has a per-minute and per-day ceiling, and an endpoint that fails three times in a row
is skipped for a minute rather than being waited out on every request — which is what stops a
sleeping laptop adding eight seconds to everything.

The console shows the chain as a rail with the path a request actually took lit up, the
hour-by-hour traffic split into live and cached calls, which app is spending the quota, and the
plain-English reason any instance is down — including the one everybody hits, where SearXNG serves
HTML until `json` is added to its formats list. Agents, crons and other repos authenticate with a
service key issued here, shown once and stored only as a hash; nothing but the server ever holds a
provider credential.

Full API reference: [`docs/search-api.md`](../search-api.md). SearXNG install:
[`infra/searxng/README.md`](../../infra/searxng/README.md).

## Features

- **The provider chain, ordered by cost and control** — laptop SearXNG (free, private, local-only),
  VPS SearXNG (free, always on), DuckDuckGo (free, keyless), Tavily (paid). A localhost endpoint
  fails fast from anywhere else, so the dev chain and the production chain differ without a branch
  in the code.
- **Circuit breaker, half-open on the last hop** — three consecutive failures and an endpoint is
  skipped for a minute; the final provider in the chain is tried even with its breaker open, so a
  failure is never returned while something untried might have worked.
- **Three typed questions** — `web`, `news` (news category, dates on most rows), `research` (20
  results, several SearXNG pages, Tavily's advanced depth and a generated answer).
- **Standardized results** — title, URL, description, source, `publishedAt`, and a `score`
  normalized to 0–1 across providers. SearXNG's native score is an unbounded sum of engine
  weights, so it is divided by the top score in the same response.
- **Page extraction** — `extract: 3` reads the top three results and returns the readable body,
  word count, author, site name and published date. Dependency-free (prefer `<article>`/`<main>`,
  then score blocks by paragraph density), with Tavily's renderer as the fallback for pages that
  only work with JavaScript. A page that cannot be read comes back with a sentence, not an
  exception.
- **Caching with hit accounting** — in-process plus Supabase, keyed on everything that changes the
  answer and nothing that doesn't, so two different apps asking the same question share one hit.
  Extracted text is cached too, since it is the expensive half.
- **Rate limits and usage tracking** — per-caller minute and day ceilings, counted atomically in
  Postgres so parallel calls cannot slip past, and one usage row per call carrying the caller, the
  app, the provider, whether it was cached, the latency and any error.
- **Service keys** — minted in the dashboard, shown once, stored as SHA-256. Own limits, own
  scopes, own usage row. A key can never mint another key.
- **The routing rail** — the page's one standout: the chain drawn as stations with the path a
  request took lit in indigo, failed hops struck in red, open breakers dimmed with their cooldown,
  and a pulse that replays the last test search along the path it travelled.
- **Test bench** — runs a real search against the same public endpoint an app uses, with the
  provider pinnable and the cache skippable, and shows the attempts that drive the rail.
- **Demo mode that is honest** — with no Supabase service-role key the service still searches and
  still caches; the dashboard says the cache and counters are per-instance and keys cannot be
  issued, rather than failing oddly.

## Must keep working

- **Every app keeps searching when a provider dies.** The chain plus the breaker is the whole
  point; a single provider's outage must never surface to an app as "no results".
- **`lib/web/fetchPublic.ts` keeps its two exported shapes** (`searchWeb` → `SearchHit[]`,
  `readPage` → `PageRead`). Jarvis's web tools and Profiles research depend on them and must not
  have to know the engine underneath moved.
- **A provider credential never reaches a browser.** Keys are read server-side only; the dashboard
  is a client of the public endpoints, never a privileged view.
- **The extract endpoint refuses private network addresses**, on every hostname's every resolved
  address and again after redirects. It takes a URL from a caller and fetches it server-side, so
  this is the control that keeps it from being an SSRF.
- **A service key cannot mint a service key.** `/api/search/keys` and `/api/search/cache` stay
  owner-session only, and stay out of middleware's token-auth list.
- **`searchWeb` in `fetchPublic` never throws.** Both callers are AI tool loops where a thrown
  error fails a whole turn but an empty result lets the model try another way.
- **The SearXNG 403 keeps its own message.** "Add json to the formats list" rather than "the VPS is
  down" — it is the mistake everybody makes once, and naming it is worth a branch.

## Requested, not built yet

- **Buildflip 2 and TikTok Dances still search through OpenRouter's web plugin**, inline in a model
  call, rather than through this service. That is a model feature rather than a search call — the
  model searches mid-generation and cites what it found — so moving them means restructuring the
  generation. Deliberately left.
- **Embeddings / semantic recall over past searches.** The usage table already holds every query;
  nothing reads it back as a corpus yet.
- **A per-app quota rather than a per-caller one.** Today an app's ceiling is the ceiling of
  whichever key or session called it; the `app` label is tracked but not enforced against.

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/search-infrastructure` — owner's sign-in
- `src/app/api/search/`
- `src/components/search-infra/`
- `src/lib/search/`

### Sign-in & who can use it

- Needs a signed-in user (requireUser / auth.getUser) — `src/lib/search/auth.ts`
- Owner-only check (requireOwner / isOwner) — `src/lib/search/auth.ts`

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET POST | `/api/search` | per-account key (no session) |
| POST DELETE | `/api/search/cache` | owner's sign-in |
| GET POST | `/api/search/extract` | per-account key (no session) |
| GET POST DELETE | `/api/search/keys` | owner's sign-in |
| GET POST | `/api/search/news` | per-account key (no session) |
| GET POST | `/api/search/providers` | per-account key (no session) |
| GET POST | `/api/search/research` | per-account key (no session) |
| GET | `/api/search/usage` | per-account key (no session) |

### Data & database rules

- Table `search_api_keys` (public.search_api_keys) · RLS on — used in `src/lib/search/store.ts`
- Table `search_cache` (public.search_cache) · RLS on — used in `src/lib/search/store.ts`
- Table `search_usage` (public.search_usage) · RLS on — used in `src/lib/search/store.ts`
- Database function `search_key_touch` — `src/lib/search/store.ts`
- Database function `search_rate_bump` — `src/lib/search/store.ts`

### Keys & outside services

- `HUB_OWNER_EMAILS` — `src/lib/search/auth.ts`
- `JARVIS_SEARCH_KEY` — `src/components/search-infra/KeysPanel.tsx`, `src/lib/search/remote.ts`
- `JARVIS_SEARCH_URL` — `src/lib/search/remote.ts`
- `NEXT_PUBLIC_SUPABASE_URL` — `src/lib/search/store.ts`
- `SEARCH_SERVICE_KEY` — `src/lib/search/auth.ts`
- `SUPABASE_SERVICE_ROLE_KEY` — `src/lib/search/store.ts`

### Tests

- `src/lib/search/limits.test.ts`
- `src/lib/search/search.test.ts`
<!-- code:end -->

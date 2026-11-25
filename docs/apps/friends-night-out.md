# Friends Night Out

Route: `/apps/friends-night-out` · Category: Apps · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- friends-night-out "what to change"`.

## What it does

An event finder built around the events you never hear about. Set a point on the map and a radius, and it works two sides at once. One side is what's happening: concerts, festivals, church gatherings, farmers markets and block parties, grouped into this weekend, this week, this month. The other is what you can go do — the standing and seasonal stuff that has no date because it's always there: ice rinks, climbing walls, stables, zip lines, kayak launches, drive-ins. Free, paid and donation are colour-coded on every card, and "price unknown" stays its own honest grey rather than being guessed at. The part that makes it worth having is the obscurity score: after results from every source are merged, an event carried by one church bulletin's calendar outranks the stadium tour that six sites already told you about, so hidden gems sort to the top instead of the bottom. Sources are a ticket API, any RSS or iCal calendar you point it at, an AI sweep of your area, and an inbox where a pasted Instagram link or a photographed flyer becomes a real event. A date-night generator pairs an activity, an event and a food stop into a whole evening with a price estimate. Local-first, and genuinely usable with no API keys at all.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Add Friends Night Out — local event finder biased toward what nobody hears about** — Two sides on one radius. Upcoming merges Ticketmaster, community RSS/iCal/ JSON-LD calendars, followed organizers and a verified AI web sweep. Always On builds a standing-and-seasonal board from Open…
- **Survive busy map servers and an empty AI account** — map batches that fail in the first burst are retried once (Columbus came back with 28 places instead of ~460 without it) - a failed map check retries after the big search and is reported as a failure…
- **Log the provider's reason when an AI call fails**
- **Any-city builder with web discovery, map verification and AI stars** — /api/fno/areas/build streams progress; reuses a covering area or builds one - perplexity/sonar finds food, gems, parks, kids, fun; every find must match a named OSM element in the radius (one alterna…
- **Section mapping, star rubric, discovery parsing, OSM name verification**
- **Sections, blended AI + community stars, shared city area reuse**
- **AI sweep and link/flyer import only for signed-in visitors**
- **Fix the bugs gauntlet round two found in Friends Night Out** — Events — the ranking was mathematically backwards. Confidence rises with corroboration and obscurity falls with it, so obscurity x confidence peaked in the middle and pushed the single-source local f…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/friends-night-out` — public
- `src/app/api/fno/`
- `src/components/friends-night-out/`
- `src/lib/friends-night-out/`

### Sign-in & who can use it

- Needs a signed-in user (requireUser / auth.getUser) — `src/lib/friends-night-out/aiAccess.ts`

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET | `/api/fno/areas/[id]/places` | public |
| POST | `/api/fno/areas/[id]/rate` | public |
| POST | `/api/fno/areas/build` | public |
| POST | `/api/fno/discover` | public |
| POST | `/api/fno/extract` | public |
| GET | `/api/fno/geocode` | public |
| POST | `/api/fno/places` | public |
| POST | `/api/fno/search` | public |

### Data & database rules

- Table `fno_areas` (public.fno_areas) · RLS on — used in `src/app/api/fno/areas/[id]/places/route.ts`, `src/lib/friends-night-out/catalog/store.ts`
  - policy public.fno_areas · fno_areas_read — for select using (true)
- Table `fno_place_stats` (not created in supabase/migrations) · RLS unknown — used in `src/app/api/fno/areas/[id]/places/route.ts`
- Table `fno_places` (public.fno_places) · RLS on — used in `src/app/api/fno/areas/[id]/places/route.ts`, `src/lib/friends-night-out/catalog/store.ts`
  - policy public.fno_places · fno_places_read — for select using (true)
- Saved data `friends-night-out:v1` — `src/lib/friends-night-out/store.ts`

### Keys & outside services

- `AI_GATEWAY_API_KEY` — `src/app/api/fno/extract/route.ts`
- `AI_MODEL` — `src/lib/friends-night-out/sources/aiSweep.ts`, `src/lib/friends-night-out/sources/social.ts`
- `EVENTBRITE_TOKEN` — `src/lib/friends-night-out/sources/organizers.ts`
- `FNO_DISCOVERY_MODEL` — `src/lib/friends-night-out/catalog/ai.ts`
- `NEXT_PUBLIC_SUPABASE_URL` — `src/lib/friends-night-out/catalog/store.ts`
- `SUPABASE_SERVICE_ROLE_KEY` — `src/lib/friends-night-out/catalog/store.ts`
- `TICKETMASTER_API_KEY` — `src/lib/friends-night-out/sources/ticketmaster.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/lib/friends-night-out/catalog/ai.ts`, `src/lib/friends-night-out/sources/aiSweep.ts`, `src/lib/friends-night-out/sources/social.ts`

### Tests

- `src/lib/friends-night-out/areas.test.ts`
- `src/lib/friends-night-out/catalog/rubric.test.ts`
- `src/lib/friends-night-out/catalog/sectionMap.test.ts`
- `src/lib/friends-night-out/catalog/verify.test.ts`
- `src/lib/friends-night-out/sections.test.ts`
- `src/lib/friends-night-out/stars.test.ts`
<!-- code:end -->

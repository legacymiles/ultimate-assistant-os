---
name: friends-night-out-app
description: Local event finder at /apps/friends-night-out — obscurity-ranked events + rarity-ranked OSM places; built via gauntlet loop
metadata: 
  node_type: memory
  type: project
  originSessionId: f5be1298-23c4-48e7-88ba-7004a33f2b64
  modified: 2026-09-19T15:41:18.643Z
---

Event finder in the OS hub at `/apps/friends-night-out`, built 2026-08-30. Two
sides on one user-set radius: **Upcoming** (dated events) and **Always On**
(standing/seasonal places), plus **Date Night** and an **Inbox**. Local-first,
works with zero API keys. Part of [[ultimate-assistant-os-portfolio]].

**v2 in progress (2026-09-19): public social app.** Owner decisions (don't re-ask):
tabs **Explore places** (dense table, sections Parks and outside/Fun/Unique gems/
Kids/Food, 1-5 stars: AI first then community, AI = 3 votes) + **Events**
(frequency sub-tabs One-time/Weekly/Monthly/Yearly); add a place = paste link or
search by name; per-city leaderboard (+1 copy, +0.5 original-finder, +3 follower,
verified emails only); new cities get LABELLED AI guide profiles, never fake
users; hosted as a public door inside the hub (option A), city catalogue built on
first sign-up and shared per area. Spec `docs/superpowers/specs/2026-09-19-friends-night-out-social-design.md`,
plans in `docs/superpowers/plans/2026-09-19-fno-v2-plan-*.md` (plan 1 done on
branch `fno-v2-foundation`; plans 2-4 = city builder+AI stars, screens, social).
Plan 1 = owner gate (`src/lib/hubAccess.ts`, see [[hub-deployment-supabase]]),
`fno_*` tables (`supabase/migrations/20260919000000_fno_social.sql`), AI routes
need sign-in (`aiAccess.ts`). SQL is verifiable locally with PGlite + an auth
stand-in (Docker daemon usually off) — mutation-test RLS, it caught a weak check.

**The hard-won source facts** (verified, don't re-litigate):
- Eventbrite public event *search* died Feb 2020 — only organizer/venue lookup
  survives, and it's worth having (paste one link → follow that organizer forever).
- Meetup retired its REST API; an OAuth consumer now needs paid Meetup Pro.
- Instagram/TikTok/Facebook have **no public event-search endpoint**. They also
  return HTTP 200 with generic OG tags when logged out, so naive extraction
  yields a draft titled "Instagram" — they must be short-circuited by hostname.
- Ticketmaster Discovery is the one good free-key ticket source.
- `overpass.osm.jp` has an expired TLS cert (shows up as opaque "fetch failed").
- Overpass refuses a 40-mile box across ~118 tag clauses with a 500 → the
  Always On radius is hard-capped at 25 mi. Events use the full radius.
- `next: { revalidate }` on a POST does nothing (Next doesn't cache POST) and
  combined with an AbortSignal makes the request fail outright.

**Two design decisions that are load-bearing** — both came from the gauntlet
loop and the app breaks without them:
1. **Confidence is scored separately from obscurity.** A single-source event is
   equally consistent with "genuinely obscure" and "hallucinated". Hidden Gem
   requires both; AI-sweep results are discarded unless their cited URL is
   fetched and confirmed.
2. **Recurring events collapse into one card** with a decaying obscurity
   penalty. Without it, weekly library storytime scores ~90 and fills the
   Hidden Gems view 52 times a year.

Always On ranks by **rarity across the result set**, not distance, and every
card leads with a **hook line** (OSM `description` → Wikipedia summary →
Wikipedia geosearch join). A place shown as name + category + miles produces no
reaction however obscure it is. Measured: 224 places in Asheville at 25 mi in
~20s.

Four OSM tags that sound right but don't exist are documented in-file as
DO-NOT-USE: `sport=zipline`, `leisure=adventure_park`, `attraction=corn_maze`,
`natural=waterfall`.

Spec with the full gauntlet record: `docs/superpowers/specs/2026-08-30-friends-night-out-design.md`.
Built with [[gauntlet-loop-skill]] against ra.co + atlasobscura.com as the bar.

**Plan 2 (city catalogue) facts, measured on Santa Cruz CA 2026-09-19** — code in
`src/lib/friends-night-out/catalog/`, routes `/api/fno/areas/build` (NDJSON) and
`/api/fno/areas/[id]/{places,rate}`:
- Old OSM activity tags miss restaurants, plain parks, cafes, speakeasies → web discovery via
  OpenRouter `perplexity/sonar` (~10 s for 5 sections, returns 3-16 per section), every find
  must match a named OSM element in radius (drops ~40%, some are closed places).
- Overpass: one clause PER NAME = 45 s; one alternation regex = 5.6 s. overpass.private.coffee
  stalls → overpassQuery is now HEDGED (next mirror after 20 s, sick list 10 min).
- "429" during rating was really OpenRouter OUT OF CREDIT (402) → aiFetch fell back to the Vercel gateway free tier, which 429s. Check /api/ai/status (lastError per provider) before blaming rate limits. Still:
  so saved builds return with estimated stars and are rated in rounds of 80 (2 parallel).
- Test builds cost real OpenRouter money (~$0.02 per 30-place rating batch); owner's daily
  usage hit $3.60 during this session — keep test builds few.
- Local verification without Supabase: preview `fno-noauth-3246` (--no-auth) → build runs,
  not saved, rates inline. Scripts can run app TS via
  `node --env-file=.env.local node_modules/vite-node/vite-node.mjs -c <cfg aliasing server-only + @>`.

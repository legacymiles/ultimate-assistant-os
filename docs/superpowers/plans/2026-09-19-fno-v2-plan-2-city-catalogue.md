# Friends Night Out v2 — Plan 2: Any-city catalogue + AI stars

> Executed inline (owner chose option 2). Tests next to code, `npx vitest run src/lib/friends-night-out/catalog`.

**Goal:** A signed-in user picks any city + radius; the server builds a shared, star-rated catalogue of
places in the five sections and stores it in `fno_areas` / `fno_places`, streaming progress.

**Architecture:** `src/lib/friends-night-out/catalog/` — small pure modules (section mapping, rubric +
rating parser, discovery parser, OSM name verification, dedupe) around three I/O steps: the existing
Overpass activity search, a web-search discovery call (OpenRouter `perplexity/sonar`) per section, and a
batched AI rating call. `store.ts` (service role, server-only) persists. One NDJSON-streaming route.

## Decisions

- **Why web-search discovery:** the existing OSM search covers activities (waterfalls, climbing,
  arcades, breweries) but not restaurants, ordinary parks, cafes or speakeasies — exactly the Food and
  Unique gems sections. `perplexity/sonar` searches the live web (already used by Dance Vault).
- **No invented places:** every discovered candidate must match a named OSM element inside the radius
  (one batched Overpass name query). Unmatched candidates are dropped and counted, never shown.
- **Cost guard:** building is sign-in only (`mayUseAi`). Anonymous visitors read built areas.
- **No AI key:** OSM-only catalogue, heuristic stars from the rarity score, flagged `stars_estimated`.
- **No service key (local dev):** the build still runs and returns the catalogue; it just isn't saved.
- **Deferred to plan 3:** events persistence (the live `/api/fno/search` already works for any city)
  and the scheduled refresh.

## What real builds changed (Santa Cruz, CA, 2026-09-19)

| Run | Time | Web finds kept | AI-rated | Fix that followed |
|---|---|---|---|---|
| 1 | 452 s | 5 / 39 | 30 / 427 | One Overpass clause per name took 45 s and timed out → one alternation regex (5.6 s). Exact name beats a containing one. |
| 2 | 324 s | 26 / 49 | 90 / 405 | Rating hit provider 429s at 8-way parallel → retry with backoff. Verification now overlaps the map search. |
| 3 | 279 s | 18 / 32 | 0 / 525 | Every rating batch 429'd even with retries; map search 95–144 s because one Overpass mirror stalls 65 s per attempt → **hedged mirror requests** (ask the next mirror after 20 s, first answer wins, failing mirrors tried last for 10 min: 446 places in 95 s vs 88 in 144 s) and **rating moved out of the build** into rounds. |

So a saved build now returns in ~100 s with estimated stars; `POST /api/fno/areas/:id/rate` rates 80
places per call (40 per AI call, 2 at a time) and the client repeats while `remaining > 0`.

## Tasks

1. `catalog/sectionMap.ts` — default section from the OSM activity category/tag (pure, tested).
2. `catalog/rubric.ts` — owner's star rubric text; `parseRatings()` validates AI output;
   `heuristicStars(obscurity)` fallback (pure, tested).
3. `catalog/discoverParse.ts` — `parseDiscovery()` for the sonar reply (pure, tested).
4. `catalog/verify.ts` — `normName()`, `buildNameQuery()`, `matchByName()` (pure, tested).
5. `catalog/dedupe.ts` — merge by normalized name within 100 m (pure, tested).
6. `catalog/ai.ts` — `discoverSection()` and `rateBatch()` I/O around the pure parsers.
7. `catalog/build.ts` — orchestrator with a progress callback; `extraClauses` for parks/kids/food
   anchors not in the old activity list.
8. `catalog/store.ts` — service-role area/place persistence, null when no key.
9. `src/app/api/fno/areas/build/route.ts` (POST, NDJSON) and
   `src/app/api/fno/areas/[id]/places/route.ts` (GET).
10. Verify: unit tests; a real build of a California city through the preview route; spot-check that
    sections are populated and stars are sensible; commit.

# Friends Night Out — design

**Date:** 2026-08-30
**Route:** `/apps/friends-night-out`
**Category:** Apps
**Status:** approved, ready to plan

---

## 1. What it is

A local event finder deliberately biased toward the events people *do not* hear
about. It answers two different questions on two different sides:

- **"What is happening?"** — dated one-offs inside a radius you set: concerts,
  festivals, church gatherings, farmers markets, block parties, meetups.
- **"What can we go do?"** — the standing and seasonal stuff that has no date
  because it is always there: ice skating, rock climbing, horseback riding,
  zip lining, kayaking, mini golf.

Plus a date-night generator that pairs the two, and an inbox that turns an
Instagram/TikTok/Facebook link or a photographed flyer into a real event.

Local-first. No login. Works with zero API keys.

---

## 2. Source reality (why the architecture looks like this)

Verified 2026-08-30. This section exists because the naive design — "scrape
Meetup, Eventbrite, Instagram, TikTok and Facebook" — cannot be built.

| Source | Status | Consequence |
|---|---|---|
| Ticketmaster Discovery | Free key, 5,000 calls/day, real lat/long + radius search | **Wire it.** Best legitimate ticketed source. |
| Eventbrite | Public event *search* removed Feb 2020. Only by organizer / venue / event id. | Not a discovery source. Out of v1. |
| Meetup | REST retired; GraphQL requires an OAuth consumer, which requires paid Meetup Pro. | Adapter stub only, dark unless a token exists. Out of v1. |
| Instagram / TikTok / Facebook | No public event-search endpoint on any of them. FB Events API removed 2018; IG Graph sees only your own business account; TikTok's data API is gated behind legal review. Scraping violates ToS and is IP-blocked within hours. | **Cannot be a crawler.** Covered instead by the AI sweep (public IG/FB event pages *are* search-indexed) and the paste-a-link inbox. |
| OpenStreetMap Overpass | Free, keyless | **Wire it.** Powers the entire Always On side. |
| RSS / iCal / JSON-LD calendars | Free, keyless, legal. Local papers, city parks and rec, libraries, churches, breweries, universities publish these. | **Wire it.** This is the hidden-gem engine. |

The honest summary: the *goal* behind "search TikTok and Facebook" is reachable;
the *method* is not. Two legal substitutes cover it.

---

## 3. The four views

### 3.1 Upcoming

Dated events inside the radius. Grouped **This Weekend / Next 7 Days /
This Month / Later**. Default sort is *Hidden gems first* (see section 4).
Filters: price tier, category, distance, source, date window.

### 3.2 Always On

Standing and seasonal places from Overpass, mapped to activity categories.
Each carries a season window; out-of-season entries dim and read
"opens in November" rather than disappearing, so they can still be planned for.

### 3.3 Date Night

A generator, not a list. Produces three complete evenings, each one Always On
activity + one dated event + a food stop, all inside the radius, with a summed
price estimate and a total travel distance. Re-roll, lock a slot, save.

### 3.4 Inbox

Paste an Instagram / TikTok / Facebook / any URL, or drop a flyer screenshot.
The server extracts OpenGraph + JSON-LD, then an LLM pass pulls title, date,
venue and price into a draft event you confirm before it joins Upcoming.
Without an AI key the OG/JSON-LD path still works and the rest is manual.

---

## 4. Obscurity score — the core mechanic

Every event gets `obscurity: 0..100`, derived after dedupe:

- **Source count** — an event confirmed by many sources is well known; one seen
  only in a single church bulletin feed is not. Fewer sources means a higher
  score.
- **Source weight** — a major ticketing platform is strong evidence of
  visibility; a community feed, a flyer, or an AI-sweep-only find is evidence of
  the opposite.
- **Venue scale** — arena and stadium capacity signals mass awareness.

`obscurity >= 65` earns a **Hidden Gem** badge. Upcoming defaults to sorting by
it. This is the feature that makes the app worth having: without it, a stadium
tour buries the thing you actually wanted to find.

The score depends on dedupe being correct, so dedupe is load-bearing, not
cosmetic.

---

## 5. Data model

```
PriceTier = "free" | "paid" | "donation" | "unknown"
SourceId  = "ticketmaster" | "overpass" | "feed" | "ai-sweep" | "inbox" | "seed"

FnoEvent {
  id, title, description?
  startsAt: ISO, endsAt?: ISO, allDay: boolean
  venue: { name, address?, lat?, lon? }
  distanceMi?: number            // derived from user origin
  category: EventCategory
  price: { tier: PriceTier, min?: number, max?: number, note?: string }
  url?, imageUrl?
  sources: SourceRef[]           // more than one after a merge
  obscurity: number
  savedAt?: ISO, going?: boolean
}

FnoPlace {                       // Always On
  id, name, category: ActivityCategory
  lat, lon, address?, distanceMi?
  season: "year-round" | { fromMonthDay, toMonthDay }
  price: { tier, note? }
  url?, phone?, osmId?
  savedAt?: ISO
}

UserPrefs { origin: { label, lat, lon }, radiusMi, categories[], updatedAt }
Feed { id, label, url, kind: "rss"|"ical"|"jsonld"|"auto", enabled, lastFetchedAt?, lastError? }
```

**Price honesty:** `unknown` is a first-class state with its own grey treatment.
Feeds rarely state a price; guessing "free" and being wrong is worse than saying
nothing. Colours: free = mint, paid = gold, donation = violet, unknown = slate,
applied to the card's left edge and its price chip, identically in all views.

---

## 6. Source adapter architecture

```ts
interface EventSource {
  id: SourceId;
  label: string;
  available(): { ok: boolean; reason?: string };
  fetch(ctx: SearchCtx): Promise<RawEvent[]>;
}
```

`SearchCtx = { lat, lon, radiusMi, from, to, categories }`

Five implementations, each independently degradable. A **Sources panel** lists
every adapter as live or dark *with the reason* ("needs TICKETMASTER_API_KEY"),
so a thin result set is never mysterious.

Adapters run in parallel; one failing never fails the search. Partial results
are returned alongside a per-source error list.

### Dedupe (`normalize.ts`)

Two events merge when **all** of these hold:

1. Start times within 3 hours.
2. Normalized titles (lowercased, punctuation and stopwords stripped) score at
   least 0.82 on the Dice coefficient over bigrams.
3. Venues match by name similarity of at least 0.7, **or** coordinates within
   0.5 mi.

The merged record keeps the longest description, the first image, the most
specific price (`unknown` always loses), and the union of `sources`.

---

## 7. Files

```
src/lib/friends-night-out/
  types.ts        model above
  store.ts        localStorage, mutators return fresh data (ai-rankings pattern)
  seed.ts         demo area so the app is alive with zero keys and zero network
  geo.ts          haversine, radius filter, Nominatim place lookup (keyless)
  normalize.ts    dedupe + obscurity scoring + price inference
  dateNight.ts    the pairing engine
  categories.ts   category maps including OSM tag to ActivityCategory
  sources/
    index.ts ticketmaster.ts overpass.ts feeds.ts aiSweep.ts social.ts

src/app/api/fno/
  search/route.ts   run enabled adapters, normalize, return events + source status
  places/route.ts   Overpass query for Always On
  feeds/route.ts    fetch and parse one feed URL server-side (avoids CORS)
  sweep/route.ts    AI discovery sweep
  extract/route.ts  paste-a-link / flyer extraction

src/components/friends-night-out/
  FriendsNightOut.tsx  shell + tab switch + radius header
  Onboarding.tsx       first-run location + radius + interests
  EventCard.tsx PlaceCard.tsx
  UpcomingView.tsx AlwaysOnView.tsx DateNightView.tsx InboxView.tsx
  FilterBar.tsx SourcesPanel.tsx FeedManager.tsx

src/app/apps/friends-night-out/page.tsx
src/lib/catalog.ts    plus one PROJECTS entry
.env.example          plus TICKETMASTER_API_KEY
```

---

## 8. Degradation contract

| Configured | Behaviour |
|---|---|
| Nothing | Overpass (keyless) + seeded demo events + inbox OG/JSON-LD parsing. App is genuinely usable. |
| plus `TICKETMASTER_API_KEY` | Real ticketed events in Upcoming. |
| plus feeds added in-app | Community events; hidden-gem quality rises sharply. |
| plus `AI_GATEWAY_API_KEY` | AI discovery sweep plus LLM flyer/link extraction. |

No configuration ever produces a crash or an empty shell — only a thinner result
set, always explained in the Sources panel.

---

## 9. Look

Cinematic night-out: dark canvas on the hub's existing tokens, poster-style
cards with imagery, neon price coding on the card edge, source badges, motion on
hover, and a Hidden Gem badge with a distinct glow. Dense enough to scan fifty
results; styled enough to sit beside Recall and AI Rankings as a portfolio tile.

---

## 10. Out of scope for v1

- Shared friends board with invite links (the data layer is written so it can be
  added later without a rewrite).
- Eventbrite organizer-follow and Meetup Pro adapters (stubs only).
- Native map view — distance is numeric in v1.
- Push notifications and calendar export.

# Friends Night Out — design

**Date:** 2026-08-30
**Route:** `/apps/friends-night-out`
**Category:** Apps
**Status:** built and committed. Revised after two rounds of adversarial review — see section 11 for what changed and why.

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


---

## 11. What the gauntlet changed

The design above was reviewed twice against named references — ra.co for dated
discovery, atlasobscura.com/things-to-do for standing discovery — by critics
given the design blind. Both rounds went against it. These are the changes that
came out, recorded because each one fixes a failure the original design could
not see.

### 11.1 Recurrence would have destroyed the Hidden Gems view

Institutional calendars are mostly weekly: library storytime, Tuesday trivia,
Sunday service. Every instance is single-source, community-weighted and in a
small room — a near-perfect obscurity score, fifty-two times a year. The
original design had no recurrence handling at all, so the marquee view would
have degenerated into the same six recurring things within a week of use.

Fixed by collapsing instances that share a normalized title and venue into one
card with a derived cadence label, and multiplying obscurity by a factor that
decays with occurrence count. Something that happens every week is by definition
not something you are missing.

### 11.2 Obscurity could not tell "obscure" from "invented"

The original score treated a single-source event as maximally obscure. But a
single source is equally consistent with a genuine find and with a hallucinated
one — so the app's most prominent surface would have been fed by its least
verified pipeline.

Split into two scores. `confidence` is independent of `obscurity`, the Hidden
Gem badge requires both, and the AI sweep now has to cite a URL that the server
fetches and confirms actually describes the event. Unverifiable results are
discarded rather than down-ranked.

### 11.3 The Always On board was a directory, not a discovery

The original tag list — ice skating, climbing, horse riding, zip lining,
kayaking, mini golf — is the autocomplete suggestion set. Run against a real
2.5-million-person metro it returns about twenty-seven named venues, all of them
places locals can already name.

Rebuilt around the tags that carry surprise (ruins, lookout towers, lava tubes,
geoglyphs, moored ships, kilns, hot springs, planetariums, drive-ins,
hackerspaces, curling sheets), ranked by rarity computed across the result set
rather than by distance, and each card now leads with a hook line pulled
keylessly from OSM descriptions or Wikipedia. Measured result: 224 places in
Asheville at 25 miles, led by a storm-memorial art installation, a historic
railway car and a public observatory, with the bowling alley scoring 24.

Four tags in the first draft did not exist (`sport=zipline`,
`leisure=adventure_park`, `attraction=corn_maze`, `natural=waterfall`); a
flagship category would have silently returned nothing. Every tag is now
verified, and the dead ones are documented in-file so they cannot be re-added.

### 11.4 Season was being fabricated

OpenStreetMap has no venue-season field, and the obvious per-category table
("ice rink means November to March") is wrong for most US rinks, which are
indoor and run year-round. Dimming a year-round rink and captioning it "opens in
November" is worse than saying nothing: confidently false AND hides a valid
result.

Season is now derived only from evidence — the venue's own `opening_hours`
month range, then indoor tagging, then a short allowlist of inherently seasonal
types with hedged wording. Everything else is `unknown`, and unknown never dims.

### 11.5 The feed registry was the cold-start problem in disguise

"Add your local calendar URLs" is work nobody does, so a new user would have
opened the app to ticketed events only — exactly the events they could already
find. Replaced with keyless auto-discovery: ask OSM which institutions are in
range, read their `website` tags, probe each for a published calendar, and
propose what is found.

### 11.6 Smaller corrections

- Eventbrite was wrongly written off entirely. Public *search* is dead, but
  organizer lookup is not, and it carries a large share of small local events.
  Pasting one link now subscribes to that organizer's whole future calendar.
- Dedupe thresholds were too strict on titles and too loose on time. Now: exact
  short-circuits on iCal UID and canonical URL, a weaker title threshold backed
  by a corroborator, date-level matching for all-day items, and a hard refusal
  to merge across different rooms at one venue.
- Venue size became a real filter. "Something under a hundred people" is an
  actual request that no category or price filter can express.
- Default sort is a blend, not raw obscurity. Sorting purely by obscurity puts
  the least-known thing first whether or not anyone could want it, which
  reliably produces a feed of rummage sales.
- The price chip is omitted rather than greyed on the Always On board, because
  OSM carries a fee tag on about 1.5% of elements and a mostly-grey axis is
  chrome, not information.

### 11.7 Constraints found by building it

- `overpass.osm.jp` has an expired TLS certificate and was removed from the
  mirror pool; it surfaced as an opaque "fetch failed" on every batch.
- `next: { revalidate }` on the Overpass POST did nothing (Next does not cache
  POST) and, combined with an AbortSignal, made the request fail outright. An
  in-process cache replaced it.
- The Always On radius is capped at 25 miles. A 40-mile box across the full tag
  table is refused with a 500 by the public Overpass instances. The alternative
  was cutting the tag table, which trades the whole point of the board for a
  bigger circle. Events are unaffected and still use the full radius.


---

## 12. Round two

Both halves were reviewed again, blind, against the same references.

**Dated events: the implementation won.** RA's supply side is empty in a
mid-size US metro, and its ranking is explicitly weighted toward ticket sales,
paid-over-free, exclusive ticketing and purchasable placement — the opposite of
obscurity. Thirteen correctness bugs came back anyway, and they were the
valuable part:

- **`obscurity x confidence` was backwards.** Confidence rises with
  corroboration and obscurity falls with it, so the product peaked in the middle
  and pushed the single-source local find — the point of the app — away from the
  top, while double-counting corroboration. Confidence is now a gate, not a
  multiplier.
- **Confidence ranked prestige, not evidence.** The AI sweep is the only source
  actually verified (its cited page is fetched and must corroborate), yet it
  started at 0.30 and could never reach the 0.6 badge floor, while Ticketmaster
  scored 0.95 unverified. Rebuilt so evidence obtained drives the score and the
  source is a weak prior; `verifiedAt` now means "fetched and confirmed" and is
  set only where that happened.
- **The AI verification test was an OR.** A date-only match passed a fabricated
  title, and a venue's own `/events` index corroborates anything it lists. Now
  requires title AND date, and rejects index URLs.
- **"This weekend" was off by a week on Fri, Sat and Sun** — the formula
  advanced to the *next* Friday, so on a Saturday tonight's events fell into
  "Next 7 days". It failed exactly when people open a going-out app.
- **No timezone handling.** Community calendars publish floating local times;
  resolving them in the server's zone shifts every event by hours on a UTC host,
  which breaks the day buckets AND pushes true duplicates outside the 3-hour
  dedupe window. The viewer's IANA zone is now sent with each search.
- Containment alone was a dedupe corroborator (merging a series head with its
  own instances); venue coordinate matching was 0.5 mi (dozens of venues
  downtown); unknown price was penalised twice; recurrence decay keyed on window
  occurrences rather than detected cadence; two feeds from one publisher counted
  as corroboration; the watchlist matched substrings, so "Mercury" matched
  everything.

**Standing places: Atlas Obscura won again**, and the diagnosis was exact.

- **Fame was being rewarded.** A Wikipedia article scored +0.35 — the largest
  single term — so the most-visited paid attraction in the state sat in the top
  ten. An article means DOCUMENTED, not unknown.

  Fixed with the best idea in either review: Wikimedia's pageviews API is
  keyless, and the article title is already in hand from building the hook line.
  Fame is now measured directly — under 500 readers a month is +12 obscurity,
  over 20,000 is −25. Verified: Biltmore Estate moves from 75 to 11, while a
  one-of-a-kind ruin with 120 monthly readers takes the top of the board.
- **Rarity was the smallest weighted term** while the category baseline was the
  largest, so the board was really ranked by what KIND of thing something is.
  Rarity now carries the most weight and uses a log curve, because the old
  reciprocal collapsed everything above three into the same value.
- **`tower:type=fire_observation` has zero uses worldwide** — the fire-lookout
  clause was dead, which falsified the "every tag verified" claim. Also removed:
  `craft=cidery` (17 uses), `historic=lime_kiln` (4 in the US), `man_made=kiln`
  (88 in the US).
- **`operator:wikidata` was in the chain test**, so every National Park Service
  and Forest Service feature took the largest penalty in the formula for being
  publicly operated.
- **`memorial=ghost_bike` was in the tag table.** It marks where a cyclist was
  killed, and it is rare enough to score well — it would have surfaced
  full-bleed under "Surprise me" as somewhere to go on a night out. Removed.
- **`access=private` only withheld the price chip**, leaving the place on the
  board with a directions link. Combined with mine adits and shafts that is a
  route to an open vertical shaft on private land. Now excluded outright.
- Free-by-nature asserted free for nature reserves and their viewpoints, which
  charge routinely; narrowed to features nobody gates.

### Corrected from round one

The 25-mile cap was recorded as a hard limit of the free Overpass service. That
was overstated. Under sustained testing the mirrors began returning the same 500
for a single-clause query that had succeeded seconds earlier, so the 500 at 40
miles is indistinguishable from rate limiting. The cap stays because 25 is the
value known to work, but it is conservative, not physics — the code and the UI
copy now say so.

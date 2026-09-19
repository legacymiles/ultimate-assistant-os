# Friends Night Out v2 — any city, Explore places + Events, social leaderboard

Date: 2026-09-19 · Status: design approved in chat, awaiting spec review
Builds on: `2026-08-30-friends-night-out-design.md` (the discovery pipeline and its hard-won source facts stay as-is)

## Goal

Turn Friends Night Out from a single-user, local-first finder into a public social app:

1. **Any city works on day one.** A user signs up, picks a city + radius, and the same discovery
   framework that works for the owner in Ohio runs for that city (e.g. a new city in California).
2. **Two sides:** **Explore places** (star-rated places in sections) and **Events** (split by
   frequency).
3. **Social layer:** public profiles, follow, one-click **Copy into mine**, and a per-city
   leaderboard ranked by copies and follows.

## Decisions (made in the brainstorm — do not re-litigate)

| # | Decision |
|---|---|
| 1 | Explore places uses a **dense sortable table + detail panel** (not card shelves). |
| 2 | Tabs are named **Explore places** and **Events**. |
| 3 | Events uses **frequency sub-tabs**: One-time · Weekly · Monthly · Yearly, with type chips below. |
| 4 | Stars: **AI rates first, community ratings adjust**. |
| 5 | New cities get **clearly labelled AI guide profiles** on the leaderboard. Never fake human users. |
| 6 | Adding a place: **paste a link** or **search by name** (no manual form). |
| 7 | Hosting: **open one door in the hub** — `/apps/friends-night-out` + its API become public; the rest of the hub stays owner-only. |
| 8 | City data: **built on first sign-up, shared per city**, refreshed on a schedule. |

## 1. City setup and data

### Sign-up
- Supabase Auth, **email (magic link or password) + Google**. Same Supabase project as the hub.
- Onboarding: pick home city (geocode, reuses `/api/fno/geocode`) + radius **5–50 mi** (default 15).
  Radius changes filter the existing catalogue client-side by distance; they never trigger a rebuild
  unless the new radius exceeds the built radius.

### City catalogue (shared, server-side)
- One catalogue per **city area** = a center point + built radius. A new user whose center is within
  10 mi of an existing area's center and whose radius fits inside it reuses that area.
- First user in a new area sees a **"Building your city"** progress screen (target 30–60 s),
  streaming stages: places → hook lines → AI sections/stars → events.
- Pipeline (reuses the existing sources in `src/lib/friends-night-out/sources/`):
  - Places: Overpass (OSM) — keep the 25 mi hard cap per query; a 50 mi area is built as tiles.
  - Hook lines: Wikipedia (existing chain).
  - Hidden gems: AI sweep, **kept only if the cited URL is fetched and confirms it** (existing rule).
  - Events: Ticketmaster, auto-discovered local calendars (libraries, papers, venues), Eventbrite
    organizer follows, and user-pasted links (Facebook/Meetup/IG event links import via
    `src/lib/social-import`; those platforms have **no search API** — do not pretend otherwise).
- Refresh: scheduled job — **events daily, places weekly** — per active area (an area with a sign-in
  in the last 30 days).

### Sections
`Parks and outside` · `Fun` · `Unique gems` · `Kids` · `Food`. Defined in one config file so the
owner can add/rename sections. Each place has exactly one primary section.

### Star rubric (AI first pass)
A written rubric file the AI classifier follows, seeded with the owner's examples:
- Best parks with waterfalls / standout scenery → **5**
- Park with rock climbing or a genuinely unusual feature → **at least 4**
- Ordinary neighbourhood park → **2–3**
- The area's biggest amusement park → **5** (Kids)
- Unique gems: cat cafe lounge, speakeasy hidden behind a soda machine in an ice cream shop,
  free-play arcade on top of a food market → **4–5**
- Chains default to ≤ 2 unless genuinely notable.

AI output per place: `section`, `aiStars (1–5)`, one-line `reason`. Batched classification through
`src/lib/ai/provider.ts`.

### Community stars
- `communityStars` = mean of user ratings once ≥ 3 ratings exist.
- **Shown stars** = blend: `(aiStars * 3 + sum(ratings)) / (3 + n)` (AI counts as 3 votes), rounded
  to nearest whole star for filtering, one decimal in the detail panel.

### No keys set
Works with OSM + Wikipedia only (no AI stars → heuristic stars from the existing rarity score,
labelled "estimated"). Missing Ticketmaster key shows a visible "event sources limited" note. Never 500s.

## 2. Screens

### Top bar
`Explore places` · `Events` · `Leaderboard` + **My places** (own list + profile). City + radius
control top-right.

### Explore places
- Filter bar: **Section** chips · **Stars** (min, e.g. 4+) · **Price** (Free/$/$$/$$$) ·
  **Show**: `Not in mine`, `New this week` · search box (names + hook lines) · **Add a place**.
- Table columns: Place · Section · Stars · Miles · Copies. Sortable by stars, miles, copies.
- Detail panel (right on desktop, bottom sheet on phone): photo, hook line, stars (AI + community
  breakdown), address, price, original finder, "in N lists", **Copy into mine**.
- Places in your list get a quick 1–5 **"Been here? Rate it"** control → feeds community stars.

### Events
Same frame. Sub-tabs **One-time · Weekly · Monthly · Yearly**; type chips (Concerts, Car meets,
Fairs, Parties, …). Frequency comes from the existing series collapsing (`SeriesInfo`). The action
is **Save** (not counted toward the leaderboard).

### Add a place
- **Paste a link** (Google Maps, Yelp, IG, TikTok, website) → `src/lib/social-import` extracts →
  AI suggests section + stars → user confirms.
- **Search by name** → matches near the user's city (catalogue first, then geocoder/OSM).
- Dedupe against the catalogue by normalized name + ≤ 100 m distance. If it already exists, the
  user just copies it.
- If new, it's added to the city catalogue and the user becomes **original finder**.

### Leaderboard
Per city. `This month` / `All time`. Columns: rank, finder, copies, followers. Click a row → their
profile.

### Profile (public)
Their places with the same filters, including **Hide ones I have** (on by default), follower count,
badges, **Follow** button, **Copy into mine** per row.

### My places
Your list, your ratings, private notes, profile privacy toggle, and a **New from people you follow**
strip.

## 3. Ranking, profiles, following

### Score (per city, per period)
- **+1** per copy of a place from your list
- **+0.5** extra per copy of a place you originally found (even if copied from someone else's list)
- **+3** per follower

### Anti-gaming
- A copy counts once per (copier, place). Self-copies don't count.
- Only accounts with a **verified email** count toward anyone's score.
- Un-copy / unfollow removes the points.
- Computed from the rows (a view or scheduled rollup), never from a client-sent number.

### Profiles and privacy
- Public by default (required to appear on the leaderboard). Private = off the leaderboard, list hidden.
- Copying copies the **place only**. Personal notes and ratings stay private unless a note is marked public.
- **AI guide profiles** (2–3 per new city, e.g. "Columbus Gems Guide (AI)") are filled from the
  catalogue, carry an "AI guide" label everywhere, rank normally, and never pretend to be people.

## 4. Architecture

### Access (security-critical)
Today `src/middleware.ts` lets **any** signed-in Supabase user through the whole hub. Public sign-up
would expose every private app. Required change:
- Add an **owner check**: env `HUB_OWNER_EMAILS` (or `app_metadata.role = 'owner'`). Every route
  except the public FNO surface requires an owner.
- Public surface (no owner needed): `/apps/friends-night-out`, `/fno/*` auth pages, `/api/fno/*`.
  Anonymous visitors can browse a city; sign-in is required to copy, follow, rate, add.
- Service-role key is **never** used by `/api/fno/*` for user-scoped writes; writes go through the
  user's session so RLS applies.
- `friends-night-out` stays out of `UNPREVIEWABLE` (it's public), but the hub carousel shows the
  logged-out view.

### Data (new Supabase tables, `fno_` prefix, all RLS-on)
| Table | Purpose | RLS |
|---|---|---|
| `fno_profiles` | user_id, handle, display name, home area, radius, is_public, is_ai_guide | read: public rows; write: self |
| `fno_areas` | id, center, built_radius, last_built_at, last_active_at | read: all; write: service (builder) |
| `fno_places` | area_id, name, address, lat/lon, section, ai_stars, ai_reason, hook, price, sources, original_finder_id | read: all; insert: authenticated (via add flow); update: service |
| `fno_events` | area_id, title, starts_at, frequency, type, venue, sources | read: all; write: service |
| `fno_list_items` | user_id, place_id, copied_from_user_id, note, note_public, created_at | read: owner or (profile public); write: self |
| `fno_ratings` | user_id, place_id, stars | read: aggregate only; write: self |
| `fno_follows` | follower_id, followee_id | read: all; write: self as follower |
| `fno_saved_events` | user_id, event_id | self only |

Leaderboard = SQL view/materialized rollup over `fno_list_items` + `fno_follows` joined to
verified users. Migration in `supabase/migrations/`, appended to `supabase/all-schemas.sql`.

### Code layout (existing folders)
- `src/lib/friends-night-out/` — add `sections.ts`, `rubric.ts` (+ AI classifier), `scoring.ts`
  (leaderboard + blended stars, pure + unit-tested), `areas.ts` (area reuse logic), `social.ts`
  (Supabase client calls).
- `src/app/api/fno/` — `areas/build` (streamed progress), `places/add`, `copy`, `follow`, `rate`,
  `leaderboard`, `profile/[handle]`, cron `refresh`.
- `src/components/friends-night-out/` — new `ExplorePlacesView`, `EventsView` (frequency tabs),
  `LeaderboardView`, `ProfileView`, `MyPlacesView`, `CityBuildProgress`, `AddPlaceDialog`,
  `AuthGate`. Existing Upcoming/AlwaysOn/DateNight/Inbox views are replaced by these; the source
  and normalize libs are reused.
- Scheduled refresh via Vercel cron hitting `/api/fno/refresh` (secret header).

### Existing local-first behaviour
Anonymous/no-Supabase mode keeps working: catalogue built per browser, list in localStorage, social
features show "Sign in to copy and follow". Demo data stays labelled as demo.

## 5. Error handling
- City build partial failure (e.g. Overpass 500): keep what succeeded, show which sources failed,
  offer retry; never an empty screen without a reason.
- AI unavailable: heuristic stars labelled "estimated"; hidden-gem sweep skipped with a note.
- Copy/follow while signed out: prompt sign-in, then complete the action.
- Link paste that can't be read (login-walled IG/FB): fall back to search-by-name with the extracted
  caption prefilled.

## 6. Testing
- Unit (vitest, next to code): blended stars, leaderboard scoring + anti-gaming rules, area reuse,
  dedupe, rubric output parsing.
- RLS tests: a second test user cannot read a private list, write another user's list, rate as
  someone else, or reach any non-FNO hub route/API (middleware owner check).
- Real-path verification in the preview: sign up as a new user → pick a California city → build
  completes with places in every section → copy from an AI guide → leaderboard updates.

## Owner actions needed (Claude cannot do these)
- Supabase dashboard: enable public email sign-up + Google provider (Google OAuth client ID/secret).
- `.env.local` / Vercel: `HUB_OWNER_EMAILS`, `CRON_SECRET`; `TICKETMASTER_API_KEY` if not set.

## Out of scope (v2)
Comments, DMs, feeds beyond "New from people you follow", photos uploaded by users, notifications,
separate domain/deployment, Date Night planner (removed from the main tabs; can return later).

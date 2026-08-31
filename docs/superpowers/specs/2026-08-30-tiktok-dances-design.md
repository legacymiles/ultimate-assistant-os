# Dance Vault — design

**Date:** 2026-08-30
**Route:** `/apps/tiktok-dances`
**Status:** designed, not built

## Problem

TikTok dances arrive faster than anyone remembers them. A dance is everywhere
for two weeks, you half-learn it, and three months later the name is gone and
the video is unfindable — TikTok's own history is a firehose with no shelf.
There is nowhere to keep a personal record of which dances mattered, what song
each one was set to, who actually made it, and how much *you* rate it.

This is that record: a wall of dances that is always moving, plays on hover,
and carries a personal 0–100 score. Plus one new dance a day, added on
autopilot, so the vault stays current without being maintained.

## Non-goals

- Not a TikTok client. It never logs in, never reads a feed, never posts.
- Not a tutorial app. No step breakdowns, no mirroring, no slow-motion trainer.
- Not shared or multi-user. One person's vault, like AI Rankings.

## Video sourcing — the decision everything hangs on

TikTok cannot be hover-autoplayed. The official embed is an iframe with a play
button, and raw CDN URLs are signed and expire. A grid of embeds is also
unusably slow. So the app is **hybrid**:

- **Hover plays a local preview.** A short muted mp4 stored under
  `public/dances/<id>.mp4`, fetched by `yt-dlp`.
- **Click opens the real TikTok embed** in a modal, so the creator gets the
  view and the attribution.
- **Poster fallback.** With no local clip, the tile is the oEmbed thumbnail
  saved to `public/dances/<id>.jpg` with a slow drift on hover. The wall still
  reads and moves; it is just not yet alive.

`public/dances/` is gitignored. Media is a local cache, never a repo asset.

## Data model

`src/lib/dances/types.ts`:

```ts
export type DanceSource = "seed" | "manual" | "daily";

export interface Dance {
  id: string;
  /** "Renegade" — the name people actually say. */
  name: string;
  /** Alternate names, so search finds it under any of them. */
  aka: string[];
  song: string;
  artist: string;
  /** Who originated it, when that is known. Credit is the point. */
  creator: string;
  /** Year it broke, not the year you added it. */
  year?: number;
  /** Free-form: "arms-only", "group", "transition", "trend-2026". */
  tags: string[];
  /** 1 = anyone can do it, 5 = you cannot do it. */
  difficulty?: number;
  /** 0–100. undefined = unrated, which is a first-class state. */
  score?: number;
  notes?: string;
  /** Canonical link. Absent on seed entries — see below. */
  tiktokUrl?: string;
  /** Local paths under /dances/. Absent until fetched. */
  clip?: string;
  poster?: string;
  source: DanceSource;
  /** Set only when source === "daily": the day it was picked. */
  dailyDate?: string;
  addedAt: string;
  updatedAt: string;
}
```

`score` being optional and `undefined` — rather than defaulting to 0 — is
deliberate: "unrated" and "rated zero" are different facts, and the toolbar has
a sort that surfaces the unrated ones.

## Storage

`src/lib/dances/store.ts`, localStorage key `dances:v1`. Every mutator returns
the fresh board so components do `setData(result)` and never read storage
directly — the same boundary AI Rankings and Recall use, so a server backend
can replace two functions at the top of the file without any component
changing.

Daily picks are the exception and are described under **Dance of the Day**.

## The wall

`src/components/dances/DanceWall.tsx`.

Filtered dances are chunked into rows of 9:16 tiles. Each row is a track
rendered twice for a seamless loop and translated by a single `requestAnimation
Frame` loop — **not** a CSS animation, because a CSS animation cannot be eased
to a stop and resumed from where it was. Rows alternate direction.

Hovering a tile sets that row's target speed to 0; the actual speed damps
toward the target each frame, so the row glides to a halt instead of snapping.
The tile lifts and its video plays. On leave, the target returns to base speed
and the row eases back up.

**The performance rule:** only the hovered tile ever mounts a `<video>`. Every
other tile is an `<img>` poster. This is what keeps 200+ tiles at 60fps, and it
is not an optimisation to add later — it is the design.

Sound: browsers block audio before the page has been clicked. Tiles start
muted; a small "click for sound" hint sits in the corner and disappears
permanently after the first click anywhere in the app.

Motion: the whole wall respects `prefers-reduced-motion`, falling back to a
static grid where hover still plays the clip.

## Getting dances in

**Paste a link.** `POST /api/dances/oembed` with a TikTok URL. The server calls
TikTok's public oEmbed endpoint (`https://www.tiktok.com/oembed?url=…`, no key,
no auth), which returns title, `author_name` and `thumbnail_url`. The
thumbnail is downloaded to `public/dances/<id>.jpg` — hotlinking it would break
when the signed URL expires. The response prefills the add form; the user
supplies the dance name (oEmbed gives a caption, not a name) and a score.

**Fetch the clip.** `POST /api/dances/clip` shells out to `yt-dlp` for one
dance, saving a ~6s muted preview to `public/dances/<id>.mp4`. A bulk
`scripts/dances-fetch.mjs` does the same for every dance that has a
`tiktokUrl` and no `clip`. Neither is required for the app to work.

## The seed, and why it has no links

`src/lib/dances/seed.ts` ships roughly 40 well-known dances with real names,
songs, artists, originating creators, years, tags and difficulty.

**Seed entries deliberately carry no `tiktokUrl`.** A fabricated link that 404s
is worse than no link: it looks like data, it fails silently, and it poisons a
database whose whole value is being trustworthy. So seed cards render as
typographic tiles — large name, song, year, an accent gradient — that drift in
the wall like any other tile and carry a "find it" action that opens a TikTok
search for that dance name. Pasting the link back turns the tile into a video
tile.

Day one, the wall moves and reads well. It becomes alive as it is filled.

## Dance of the Day

### Why this changes the architecture

A daily pick must be decided **once** and remembered, including across browser
profiles and cleared storage. localStorage cannot do that, and a client cannot
be trusted to be open when the day rolls over. So daily picks live server-side
in `.dances-daily.json`, written through `src/lib/dances/dataDir.ts` — the same
pattern as Recall's data dir, with `DANCES_DATA_DIR` to relocate it onto a
mounted volume when the code directory is read-only.

The client merges server picks into its localStorage board on load, keyed by
`tiktokUrl`, so the merge is idempotent. One database, two writers.

### Trigger

**Catch-up on open only.** No cron, no deploy dependency. `GET
/api/dances/daily` runs on app load:

- It compares the last recorded pick date to today and fills the gap, **capped
  at 5 days back, newest first** — returning after a month costs one catch-up,
  not thirty searches.
- A `lastRunAt` stamp in the file debounces it, so opening the app ten times in
  an afternoon fires one search, not ten.

### Choosing the pick

The client sends its dance names (names only — small, and no other board data
leaves the browser). The server joins them with its own past picks into an
exclusion list, and asks a web-search-grounded model through OpenRouter
(`OPENROUTER_API_KEY`, already configured for Soundprint) for up to **3**
candidates: name, song, artist, creator, a TikTok link, and one line on why it
is blowing up.

### The honesty gate

Each candidate is verified by hitting TikTok's oEmbed. It must resolve with a
real `author_name` and `thumbnail_url` or it is discarded and the next
candidate is tried. If none survive, the day is recorded with `status: "none"`
and is **not** retried — the UI says "no verified pick today" and no further
search is spent on it.

A dance the model invented can never enter the database. This gate is the
feature; without it the vault becomes untrustworthy within a week.

A surviving pick has its thumbnail saved locally, so it has a poster
immediately and picks up its hover clip on the next `yt-dlp` fetch. It is
written as an ordinary `Dance` with `source: "daily"` and `dailyDate`, so it
drifts in the main wall like everything else.

### UI

`src/components/dances/DanceOfTheDay.tsx` — a band pinned above the wall:
today's pick as one large auto-playing tile with the date, the why-line and a
score slider, plus a scrollable strip of the last 7 days.

Cost: one search call per day.

## Finding and scoring

A toolbar above the wall: search across name, aka, song, artist, creator and
tags; sort by score, newest, year, or unrated-first; tag chips.

Filtering changes *which tiles are on the wall* — it never stops the drift.
Sorting by score means the front of the wall is the leaderboard; there is no
separate rankings view.

Clicking a tile opens `DanceModal`: the real TikTok embed (script loaded
lazily, only when the modal opens), all metadata, notes, a 0–100 score slider,
edit and delete.

## Failure modes

| Situation | Behaviour |
|---|---|
| oEmbed fails (deleted/private video) | Typed values are kept; the dance saves with the link marked unresolved. Never discards user input. |
| `yt-dlp` not installed | Clear message with the install line. Tiles stay on posters; embeds still work. |
| No `OPENROUTER_API_KEY` | The band says so plainly and offers a paste-it-yourself button. No silent no-op. |
| Read-only filesystem | Clip fetch and daily writes are disabled with a stated reason; the wall and embeds are unaffected. |
| Model returns nothing verifiable | Day recorded as `none`, not retried. |

## Files

```
src/lib/dances/types.ts        Dance, DanceSource, board types
src/lib/dances/seed.ts         ~40 curated dances, no fabricated links
src/lib/dances/store.ts        localStorage board, mutators return fresh data
src/lib/dances/oembed.ts       TikTok oEmbed call + thumbnail download
src/lib/dances/daily.ts        candidate search, verification gate, catch-up
src/lib/dances/dataDir.ts      .dances-daily.json location (DANCES_DATA_DIR)
src/lib/dances/query.ts        search / sort / tag helpers

src/app/api/dances/oembed/route.ts
src/app/api/dances/clip/route.ts
src/app/api/dances/daily/route.ts
src/app/apps/tiktok-dances/page.tsx

src/components/dances/DanceWall.tsx
src/components/dances/DanceTile.tsx
src/components/dances/DanceOfTheDay.tsx
src/components/dances/DanceModal.tsx
src/components/dances/AddDanceDialog.tsx
src/components/dances/Toolbar.tsx

scripts/dances-fetch.mjs       bulk clip fetch
public/dances/                 gitignored media cache
```

Plus a `PROJECTS` entry in `src/lib/catalog.ts` (category **Video**) and a
`.env.example` section for `DANCES_DATA_DIR`.

## Verification

This repo has no test runner. Verification is the dev server plus browser
checks:

- Wall drifts on load; hovering eases one row to a stop and plays that tile.
- Only one `<video>` element exists in the DOM at a time.
- Pasting a real TikTok link resolves through oEmbed and saves a local poster.
- Pasting a dead link keeps typed values and flags the link.
- `/api/dances/daily` with no key returns the no-key state, not a 500.
- A forged candidate URL is rejected by the verification gate.
- `prefers-reduced-motion` stops the drift and leaves hover playback working.

Use `NEXT_DIST_DIR` when running a second dev server — two servers sharing
`.next` corrupts it.

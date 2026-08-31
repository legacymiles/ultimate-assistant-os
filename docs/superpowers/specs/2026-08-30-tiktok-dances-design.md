# Dance Vault — design

**Date:** 2026-08-30
**Route:** `/apps/tiktok-dances`
**Status:** designed, not built

## Problem

TikTok dances arrive faster than anyone remembers them. A dance is everywhere
for two weeks, you half-learn it, and three months later the name is gone and
the video is unfindable — TikTok's own history is a firehose with no shelf.
There is nowhere to keep a personal record of which dances mattered, what song
each one was set to, who made it, and how much *you* rate it.

This is that record: a wall of dances that is always moving, plays on hover,
and carries a personal 0–100 score. Plus one new dance a day, added on
autopilot, so the vault stays current without being maintained.

**Every tile ships playable.** An empty tile is a failed tile. The seed is
generated from live search and machine-verified, not hand-written from memory.

## Non-goals

- Not a TikTok client. It never logs in, never reads a feed, never posts.
- Not a tutorial app. No step breakdowns, mirroring, or slow-motion trainer.
- Not shared or multi-user. One person's vault, like AI Rankings.

## Where the video comes from

TikTok cannot be hover-autoplayed: its embed is an iframe with a play button,
and raw CDN URLs are signed and expire. The dances are *posted* on TikTok, but
they are also re-posted, tutorialised and compiled on YouTube — where the video
is embeddable, keylessly verifiable, and free to hotlink a poster from.

So **YouTube is the playback source; TikTok is the credit link.**

This was validated before writing this spec, not assumed:

| Mechanism | Result |
|---|---|
| `youtube.com/results?search_query=…` scraped for `"videoId"` | 25–32 real IDs per dance name |
| `youtube.com/oembed?url=…` (keyless) | 200 + title, channel, thumbnail |
| `"playableInEmbed"` on the watch page | `true` for every sampled ID |
| `yt-dlp --version` | **not installed on this machine** |

That last row is why local mp4 is not the day-one path.

### The playback ladder

Each tile resolves the best available source, in order:

1. **Local mp4** — `public/dances/<id>.mp4` if present. Instant, silky, no
   network, no third-party branding. Produced by `yt-dlp` when it is installed.
2. **YouTube iframe** — mounted *only while hovered*, with
   `autoplay=1&mute=1&playsinline=1&controls=0&loop=1`. This is the day-one
   path and it needs nothing installed.
3. **Poster only** — `i.ytimg.com/vi/<id>/hqdefault.jpg`, which is stable and
   never expires, so posters need no download at all.

Rung 2 is what makes the wall alive today; rung 1 is a free upgrade the moment
`yt-dlp` exists. Tiles never sit at rung 3 unless verification failed.

`public/dances/` is gitignored — media is a local cache, never a repo asset.

## Data model

`src/lib/dances/types.ts`:

```ts
export type DanceSource = "seed" | "manual" | "daily";

/** A verified, playable source for one dance. */
export interface DanceVideo {
  kind: "youtube" | "local";
  /** youtube: the 11-char id. local: filename under /dances/. */
  ref: string;
  /** Never expires for youtube; a local jpg for local clips. */
  poster: string;
  /** Who posted the video we play (not necessarily the choreographer). */
  channel?: string;
  sourceTitle?: string;
  /** When the embed check last passed. */
  verifiedAt: string;
}

export interface Dance {
  id: string;
  /** "Renegade" — the name people actually say. */
  name: string;
  /** Alternate names, so search finds it under any of them. */
  aka: string[];
  song: string;
  artist: string;
  /** Who originated the choreography, when known. Credit is the point. */
  creator?: string;
  /** Year it broke, not the year you added it. */
  year?: number;
  /** Free-form: "arms-only", "group", "transition", "trend-2026". */
  tags: string[];
  /** 1 = anyone can do it, 5 = you cannot do it. */
  difficulty?: number;
  /** 0–100. undefined = unrated, which is a first-class state. */
  score?: number;
  notes?: string;
  /** What plays on hover. Absent only if every candidate failed. */
  video?: DanceVideo;
  /** The original TikTok, when known — opens from the modal for credit. */
  tiktokUrl?: string;
  source: DanceSource;
  /** Set only when source === "daily": the day it was picked. */
  dailyDate?: string;
  addedAt: string;
  updatedAt: string;
}
```

`score` is optional and `undefined` rather than defaulting to 0 on purpose:
"unrated" and "rated zero" are different facts, and the toolbar sorts on the
difference.

## Storage

`src/lib/dances/store.ts`, localStorage key `dances:v1`. Every mutator returns
the fresh board so components do `setData(result)` and never read storage
directly — the same boundary AI Rankings and Recall use, so a server backend
can replace two functions at the top of the file without any component
changing.

Daily picks are the exception, described below.

## The seed is generated, not written

`scripts/dances-resolve.mjs` is the heart of the app's honesty. Given a list of
dance names it:

1. Searches YouTube for `<name> tiktok dance` (short-video filter).
2. Takes the top candidates and calls keyless oEmbed on each.
3. Rejects anything that fails oEmbed **or** whose watch page does not report
   `playableInEmbed: true`.
4. Writes the winner — id, channel, source title, poster — into
   `src/lib/dances/seed.generated.ts`.

The script is run at build time and its **output is committed**, so the app
ships with real, already-verified videos and does no resolution at runtime.
Re-running it refreshes dead entries.

`src/lib/dances/seed.names.ts` holds the curated input: ~40 dances with name,
song, artist, creator, year, tags and difficulty — the editorial layer the
resolver cannot produce. Current trends are researched from live search at
build time rather than recalled from model memory, which is months stale.

A name that survives no candidate is dropped from the generated seed rather
than shipped as an empty tile.

## The wall

`src/components/dances/DanceWall.tsx`.

Filtered dances are chunked into rows of 9:16 tiles. Each row is a track
rendered twice for a seamless loop and translated by a single
`requestAnimationFrame` loop — **not** a CSS animation, because a CSS animation
cannot be eased to a stop and resumed from where it was. Rows alternate
direction.

Hovering a tile sets that row's target speed to 0; actual speed damps toward
the target each frame, so the row glides to a halt instead of snapping. The
tile lifts and its video plays. On leave, the target returns to base speed and
the row eases back up.

**The performance rule: only the hovered tile ever mounts a `<video>` or an
iframe.** Every other tile is an `<img>` poster. This is what keeps 200+ tiles
at 60fps, and it is not an optimisation for later — it is the design. It also
keeps YouTube from loading 200 players.

A short hover intent delay (~120ms) stops a mouse sweeping across the wall from
spawning a trail of players.

Sound: browsers block audio before the page has been clicked, and rung-2 embeds
must start muted regardless. A "click for sound" hint sits in a corner and
disappears permanently after the first click anywhere in the app.

The whole wall respects `prefers-reduced-motion`: the drift stops and it
becomes a static grid where hover still plays.

## Adding dances by hand

`AddDanceDialog` takes either a TikTok link or a plain dance name.

- **A name** runs the same resolver path through `POST /api/dances/resolve`,
  so a manual add gets the same verified video the seed did.
- **A TikTok link** is read through TikTok's public oEmbed (keyless) for the
  caption, author and thumbnail, and is stored as `tiktokUrl` for credit; the
  resolver still finds the playable video.

If oEmbed fails — deleted or private video — the typed values are kept and the
dance saves with the link flagged unresolved. User input is never discarded
because a network call failed.

## Dance of the Day

### Why this changes the architecture

A daily pick must be decided **once** and remembered, including across browser
profiles and cleared storage, and a client cannot be trusted to be open when
the day rolls over. So daily picks live server-side in `.dances-daily.json`,
written through `src/lib/dances/dataDir.ts` — the same pattern as Recall's data
dir, with `DANCES_DATA_DIR` to relocate it onto a mounted volume when the code
directory is read-only.

The client merges server picks into its localStorage board on load, keyed by
video ref, so the merge is idempotent. One database, two writers.

### Trigger

**Catch-up on open only.** No cron, no deploy dependency. `GET
/api/dances/daily` runs on app load:

- It compares the last recorded pick date to today and fills the gap, **capped
  at 5 days back, newest first** — returning after a month costs one catch-up,
  not thirty.
- A `lastRunAt` stamp in the file debounces it, so opening the app ten times in
  an afternoon fires one search, not ten.

### Choosing the pick

The client sends its dance names — names only; no other board data leaves the
browser. The server joins them with its own past picks into an exclusion list,
then runs whichever discovery path is available:

- **With `OPENROUTER_API_KEY`** (already configured for Soundprint): a
  web-search-grounded model names up to 3 dances that are blowing up now and
  are not in the exclusion list, with song, artist and a one-line why.
- **Without any key:** a keyless fallback searches YouTube for a rotating
  trend query (`tiktok dance trend <month> <year>`, `new tiktok dance
  challenge this week`) and takes the top result not already in the vault,
  deriving a provisional name from the title.

The keyless path is the floor, not a stub: autopilot works with no key at all.
The AI path exists because it names the dance properly and explains why it is
trending, which a video title usually does not.

### The honesty gate

Every candidate — from either path — goes through the same resolver as the
seed: oEmbed, then `playableInEmbed`. **A pick that cannot be played is not a
pick.** Candidates are tried in order; if none survive, the day is recorded as
`status: "none"` and is not retried, and the band reads "no verified pick
today".

This is why a fabricated dance can never enter the vault: the model does not
supply the video, it only supplies a name to search for, and a name that
resolves to nothing playable dies at the gate.

Provisional names from the keyless path are editable in one click, and the band
marks them as unconfirmed so a messy auto-derived title is visibly a draft
rather than a claim.

### UI

`src/components/dances/DanceOfTheDay.tsx` — a band pinned above the wall:
today's pick as one large auto-playing tile with the date, the why-line and a
score slider, plus a scrollable strip of the last 7 days. Picks are ordinary
dances tagged `source: "daily"`, so they also drift in the main wall.

Cost: one search call per day, or zero on the keyless path.

## Finding and scoring

A toolbar above the wall: search across name, aka, song, artist, creator and
tags; sort by score, newest, year, or unrated-first; tag chips.

Filtering changes *which tiles are on the wall* — it never stops the drift.
Sorting by score means the front of the wall is the leaderboard; there is no
separate rankings view.

Clicking a tile opens `DanceModal`: the video at full size, all metadata,
notes, a 0–100 score slider, a link to the original TikTok when known, edit and
delete.

## Failure modes

| Situation | Behaviour |
|---|---|
| A seed name resolves to nothing playable | Dropped from the generated seed. No empty tiles, ever. |
| A video dies after shipping | Poster stays, tile shows "source gone"; re-running the resolver repairs it. |
| TikTok oEmbed fails on a manual add | Typed values kept, link flagged unresolved. |
| `yt-dlp` not installed | Rung 2. Stated once in the UI, not nagged. |
| No `OPENROUTER_API_KEY` | Keyless discovery path runs. Autopilot still works. |
| Read-only filesystem | Daily writes disabled with a stated reason; wall and playback unaffected. |
| No candidate survives the gate | Day recorded as `none`, not retried. |

## Files

```
src/lib/dances/types.ts             Dance, DanceVideo, board types
src/lib/dances/seed.names.ts        curated editorial input (~40 dances)
src/lib/dances/seed.generated.ts    committed resolver output — real videos
src/lib/dances/store.ts             localStorage board, mutators return fresh
src/lib/dances/resolve.ts           search + oEmbed + playableInEmbed gate
src/lib/dances/daily.ts             discovery paths, catch-up, dedupe
src/lib/dances/dataDir.ts           .dances-daily.json (DANCES_DATA_DIR)
src/lib/dances/query.ts             search / sort / tag helpers

src/app/api/dances/resolve/route.ts
src/app/api/dances/daily/route.ts
src/app/api/dances/clip/route.ts    optional yt-dlp upgrade
src/app/apps/tiktok-dances/page.tsx

src/components/dances/DanceWall.tsx
src/components/dances/DanceTile.tsx      the playback ladder lives here
src/components/dances/DanceOfTheDay.tsx
src/components/dances/DanceModal.tsx
src/components/dances/AddDanceDialog.tsx
src/components/dances/Toolbar.tsx

scripts/dances-resolve.mjs          regenerates seed.generated.ts
scripts/dances-fetch.mjs            bulk yt-dlp clip upgrade
public/dances/                      gitignored media cache
```

Plus a `PROJECTS` entry in `src/lib/catalog.ts` (category **Video**) and a
`.env.example` section for `DANCES_DATA_DIR`.

## Verification

This repo has no test runner. Verification is the resolver's own output plus
dev-server browser checks:

- `scripts/dances-resolve.mjs` reports how many names resolved; **every**
  shipped seed entry has a `video`.
- Wall drifts on load; hovering eases one row to a stop and plays that tile.
- Only one player exists in the DOM at a time; sweeping the mouse across the
  wall spawns no trail of players.
- A dance added by name gets a verified video.
- A forged/unembeddable id is rejected by the gate.
- `/api/dances/daily` with no key still produces a pick, not a 500.
- `prefers-reduced-motion` stops the drift and leaves hover playback working.

Use `NEXT_DIST_DIR` when running a second dev server — two servers sharing
`.next` corrupts it.

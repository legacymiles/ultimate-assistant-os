# Viral Studio Content

Route: `/apps/viral-studio-content` · Category: Video · Live

Record reviewed: 2026-11-22

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- viral-studio-content "what to change"`.

## What it does

Four boards for the clips worth saving — Viral audio (sounds and songs), Fights, Dances and Motion (surfing, hoops, rap performances and anything else that moves). They all work the same way: paste a link from TikTok, Instagram, YouTube, X, Facebook or anywhere else and it lands in the tab you're on, newest first, with the same video never added twice. Hover a tile and it plays; one tap on the × deletes it, with Undo. Signed in, the video file itself is saved once into your private storage so it plays instantly and survives the post being taken down; when a network won't hand it over, the tile plays through that network's own player instead and says so. Paste several links at once, press Ctrl+V anywhere, or drag a link onto the board. Replaced Dance Vault.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Dance of the Day finds the trend through the hub's search service** (2026-11-22) — the daily
  pick used to be one call to a model that searched as it answered (`perplexity/sonar`,
  OpenRouter's `:online`). Now `src/lib/dances/daily.ts` calls `searchNews` with a week's
  freshness (a month-fresh web search as the floor, since the free providers' news modes are
  thin), flattens the coverage with `asPrompt`, and a plain cheap model reads it and names the
  dances. The name is still only a name: every candidate goes through `resolveVideo`, the same
  gate the seed passed. No coverage, or no key, hands the day to the keyless YouTube trend search,
  which is unchanged. `DANCES_MODEL` should now be a plain model — a search model is wasted money,
  and a trailing `:online` on it is stripped.
- **4 link boards (audio, fights, dances, motion)** — New app at /apps/viral-studio-content; /apps/tiktok-dances redirects in - Paste social links (several at once, Ctrl+V anywhere, drag & drop) into the open tab, newest first, no duplicates per tab - H…
- **Facebook videos that need a sign-in now get Upload the video, Connect Facebook and Try again right on the tile** — The tile used to stop at "Facebook wouldn't hand over this video". Now: - Upload the video: pick it from the phone or computer; it goes straight to storage (signed upload link, up to 500 MB) and play…
- **Song finder names the song under the title, filters by mood, popularity and category**
- **Second review round** — Trim matched blurred side copies (sharpness), keep one-sided soft areas - Size the newest clip so the wall plus an add-a-link tile ends on a full row - Stronger pointer sheen and tilt; soft shade beh…
- **Finish-review fixes** — Trim letterbox bars from each still (measured in the browser) and frame poster + WebGL reveal on the picture - Corner open/delete buttons always visible on touch screens - Newest clip shown large (2x…
- **Streaming-grade redesign with WebGL trail reveal** — Impeccable direction (owner chose clean streaming grid, Apple TV+ bar); surface brief recorded - Clips rest in black & white; webgl-trail-reveal ring-buffer trail scans colour in, then floods and pla…
- **Put a saved character into any dance video** — Studio view in Dance Vault: reference dance (upload, link or library) + reusable character -> MiniMax H3 motion-transfer video, with a dance library, character library, every take kept and regenerate…
- **Add Dance Vault — a wall of TikTok dances that never stops moving** — Rows of vertical tiles drift sideways forever in alternating directions; hovering one eases its row to a halt and plays that dance. Each record keeps the name people actually say, the song, the chore…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

- **Dance of the Day names a real, current dance, or records the day as `none`.** Every name is
  checked against a playable video before it enters the vault, and a day with no playable candidate
  is written down rather than retried on every app open.
- **Autopilot works with no key at all.** The keyless YouTube trend path is the floor, not a stub.
- **A dead search service costs the day nothing.** The pick falls to the keyless path instead of
  failing.

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/tiktok-dances` — owner's sign-in
- Page `/apps/viral-studio-content` — owner's sign-in
- `src/app/api/dance-studio/`
- `src/app/api/viral-studio/`
- `src/components/dances/`
- `src/components/viral-studio/`
- `src/lib/dance-studio/`
- `src/lib/dances/`
- `src/lib/viral-studio/`

### Sign-in & who can use it

- Needs a signed-in user (requireUser / auth.getUser) — `src/lib/dance-studio/server/library.ts`

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET | `/api/dance-studio` | owner's sign-in |
| POST | `/api/dance-studio/characters` | owner's sign-in |
| PATCH DELETE | `/api/dance-studio/characters/[id]` | owner's sign-in |
| POST | `/api/dance-studio/dances` | owner's sign-in |
| PATCH DELETE | `/api/dance-studio/dances/[id]` | owner's sign-in |
| POST | `/api/dance-studio/fetch-image` | owner's sign-in |
| POST | `/api/dance-studio/generations` | owner's sign-in |
| GET DELETE | `/api/dance-studio/generations/[id]` | owner's sign-in |
| POST | `/api/dance-studio/import` | owner's sign-in |
| GET | `/api/dance-studio/media` | owner's sign-in |
| POST PUT | `/api/dance-studio/upload` | owner's sign-in |
| POST | `/api/viral-studio/add` | owner's sign-in |
| GET DELETE | `/api/viral-studio/media` | owner's sign-in |
| GET | `/api/viral-studio/poster` | owner's sign-in |
| POST | `/api/viral-studio/song` | owner's sign-in |
| POST | `/api/viral-studio/tag` | owner's sign-in |
| POST PUT | `/api/viral-studio/upload` | owner's sign-in |

### Data & database rules

- Saved data `dances:v1` — `src/lib/dances/store.ts`, `src/lib/viral-studio/store.ts`
- Saved data `viral-studio:v1` — `src/lib/viral-studio/store.ts`
- Server docs (server_docs via readDoc/writeDoc) — `src/lib/dance-studio/server/library.ts`, `src/lib/dances/daily.ts`

### Keys & outside services

- `AI_GATEWAY_API_KEY` — `src/lib/dance-studio/server/providers/gateway.ts`, `src/lib/dance-studio/server/providers/index.ts`
- `AI_MODEL` — `src/lib/viral-studio/server/tagger.ts`
- `AUDD_API_TOKEN` — `src/lib/viral-studio/server/songFinder.ts`
- `DANCE_STUDIO_GATEWAY_MODEL` — `src/lib/dance-studio/server/providers/gateway.ts`
- `DANCE_STUDIO_PROVIDER` — `src/lib/dance-studio/server/providers/index.ts`
- `DANCES_DATA_DIR` — `src/lib/dances/dataDir.ts`
- `DANCES_MODEL` — `src/lib/dances/daily.ts`
- `MINIMAX_API_KEY` — `src/lib/dance-studio/server/providers/index.ts`
- `MINIMAX_VIDEO_MODEL` — `src/lib/dance-studio/server/providers/minimax.ts`
- `OPENROUTER_API_KEY` — `src/lib/dances/daily.ts`
- `OPENROUTER_SITE_URL` — `src/lib/dances/daily.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/lib/viral-studio/server/tagger.ts`

### Tests

- `src/lib/dance-studio/dance-studio.test.ts`
- `src/lib/viral-studio/board.test.ts`
- `src/lib/viral-studio/filters.test.ts`
- `src/lib/viral-studio/song.test.ts`
- `src/lib/viral-studio/stuck.test.ts`
- `src/lib/viral-studio/trail.test.ts`
<!-- code:end -->

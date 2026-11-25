# YouTube videos

Route: `/apps/youtube-videos` · Category: AI · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- youtube-videos "what to change"`.

## What it does

Paste any YouTube, Shorts, TikTok, Instagram, Facebook, X, Vimeo or Twitch link (or several at once, or paste anywhere on the page) and it lands at the top of your watch-later list, with its title, channel and thumbnail filled in by themselves. The same video pasted twice moves back to the top instead of saving twice, deletes can be undone, and YouTube and Vimeo play right inside the app. For you suggests what to watch next from what you save (real YouTube videos with a YouTube key, otherwise searches Jarvis picks). The hero is a 3D reel modeled in Blender that wears your saved thumbnails; every link you save flies into it. Also a widget on the Jarvis Dashboard.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **YouTube videos widget + app; Site errors moves to its own tab** — Dashboard: the Site errors widget leaves the Deck for More › Work › Site errors (also /apps/jarvis#site-errors, where crash notifications already link). Its slot goes to a new YouTube videos widget.
- **Works on a phone — fits the screen, ring above the paste box, list in the first screen** — The Dashboard card's four thumbnails could push the whole widget column past the phone's edge (cut off, no way to scroll sideways). They now share the card's width, and the widget grid can't be widen…
- **YouTube videos v2 "Holo Deck"; key setup with clickable step guides** — Design (interactive-web-studio, scroll-craft layering, blender-to-web): the hero is a Blender-modeled ring of glass screens round a play-prism core with glowing frames and orbit rings, over a shader …

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/youtube-videos` — owner's sign-in
- `src/app/api/youtube-videos/`
- `src/components/youtube-videos/`
- `src/lib/youtube-videos/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET | `/api/youtube-videos/meta` | owner's sign-in |
| POST | `/api/youtube-videos/recommend` | owner's sign-in |

### Data & database rules

- Saved data `youtube-videos:v1` — `src/lib/youtube-videos/useLibrary.ts`

### Keys & outside services

- `YOUTUBE_API_KEY` — `src/app/api/youtube-videos/recommend/route.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/youtube-videos/recommend/route.ts`

### Tests

- `src/lib/youtube-videos/youtube-videos.test.ts`
<!-- code:end -->

# AI Rankings

Route: **`/apps/ai-rankings`** · Category: AI · **public**: visitors browse, only the owner edits.

A category-first leaderboard of AI models. A visitor picks a category (text-to-speech, realtime
voice, image-to-video…) and sees two lists for it: **Top ranked** and **Just dropped**. One-tap
filters cover open source, runs locally, free, and released within 7, 30 or 90 days. The category
and filters are kept in the URL (`?c=tts&open=1&r=30`), so every view is a link you can share.

Spec: [`docs/superpowers/specs/ai-rankings-public-leaderboard.md`](../superpowers/specs/ai-rankings-public-leaderboard.md)

## How the score works

Each model can have a **public score** and a **curator rating**:
- The **public score** is an arena Elo or a benchmark percent, with its source, label and date.
  Elo is measured from the category leader: the leader scores 100, and every 4 Elo behind costs one
  point. A percent is used as it is.
- The **curator rating** is the owner's 1–10 rating, counted as ×10.

With both, the score is their average. With one, it is that one. A model with neither is listed as
unranked. Ranks are always computed over the whole board, so filters don't renumber anything: an
open model that is #5 overall still shows #5 with "Open source" on. Use **one score source per
category** (the seed test enforces this).

## Staying current

`.github/workflows/ai-rankings-sweep.yml` calls `POST /api/ai-rankings/sweep` once a day. The sweep:
1. reads Hugging Face's trending list for each category's pipeline tags;
2. keeps only original releases from the last 45 days that clear the category's likes bar;
3. drops quantised copies and other people's fine-tunes, and anything already on the board, in the
   inbox, or dismissed before;
4. files the rest in the owner's **Inbox**.

Nothing goes public until the owner approves it. The owner can also press **Check now** in the
inbox.

## Where things are

| | |
|---|---|
| Page | `src/app/apps/ai-rankings/page.tsx` → `src/components/ai-rankings/Leaderboard.tsx` |
| UI pieces | `ModelSheet.tsx` (view, rate, edit) · `InboxPanel.tsx` · `AnalyzeLink.tsx` (paste a link) · `parts.tsx` |
| Categories, scoring, filters | `src/lib/ai-rankings/leaderboard.ts` (pure, tested) |
| Owner actions | `src/lib/ai-rankings/boardActions.ts` (pure, tested; all input is cleaned here) |
| Sweep | `src/lib/ai-rankings/sweep.ts` (pure parts tested against recorded HF responses) |
| Storage + who may edit | `src/lib/ai-rankings/boardServer.ts`: one `server_docs` row (`ai-rankings-public-board`), or `.data/ai-rankings/` locally |
| Routes | `GET/POST /api/ai-rankings/board` (GET is public; POST is owner-only, checked in the route) · `POST /api/ai-rankings/sweep` (token or owner) |
| Access rules | `AI_RANKINGS_PUBLIC` in `src/lib/hubAccess.ts`; the sweep is in `TOKEN_AUTH_PATHS` in `src/middleware.ts` |
| Seed | `src/lib/ai-rankings/seedModels.ts`: 115 models researched 2026-11-08. It is only used until the first save |

The old private board (`store.ts`, `types.ts`, `fromDashboard.ts`) still exists. The Dashboard's
"screenshot → AI Rankings" destination writes to it in the browser. The owner sees a one-time
**Import them** banner that brings its AI records onto the public board (`fromOldBoard.ts`).

## Setup for the live site

- `HUB_OWNER_EMAILS` decides who the owner is. Without Supabase configured (local), whoever is at
  the keyboard is the owner.
- `SUPABASE_SERVICE_ROLE_KEY` is needed so the board saves to Postgres on Vercel; without it, saves
  only last until the next deploy.
- `AI_RANKINGS_SWEEP_TOKEN`: set the same value on Vercel and as a GitHub Actions secret to turn on
  the daily sweep.

## Change it

Before you start: read `leaderboard.ts` (the categories live in `CATEGORIES`) and this file. To add
a category, add one object to `CATEGORIES` with its family, its HF pipeline tags and its likes
bar; the rail, overview, inbox and forms all pick it up from there. Keep the rules: every write is
checked as the owner on the server, nothing the sweep finds goes public without approval, every
score names its source, and ranks are never renumbered by a filter.

Not built yet: refreshing scores automatically from Artificial Analysis's API (it needs a key, the
free tier allows 100 calls a day, and attribution is required), and visitor accounts with "follow a
category" alerts.

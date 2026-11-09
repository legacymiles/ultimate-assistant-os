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

The same run refreshes the **scores** already on the board from Artificial Analysis's free API
(`src/lib/ai-rankings/scores.ts`). Six of its free boards are the exact sources the seed used, one
per category — speech, text-to-image, image editing, text-to-video (audio), image-to-video (audio)
and music with vocals — so a refresh writes the same label back and the one-source-per-category
rule holds. LLMs (LMArena) and 3D (3D Arena) are not AA boards and are left alone, and so is
realtime-voice: its Big Bench Audio percent is a Pro-tier evaluation the free endpoints do not
carry.

A score is only rewritten when exactly **one** AA entry claims the model, matched on name and
maker with case and punctuation ignored. AA's product prefixes and resolution suffixes are seen
through ("Dreamina Seedance 2.5 1080p" is the board's "Seedance 2.5"), but two candidates
("Kling 2.1 Master" and "Kling 2.1 Pro" for a board entry of "Kling 2.1"), a next version
("Veo 4.1" for "Veo 4"), a different lab with the same model name, or a score the owner sourced
elsewhere all mean the model keeps the number it has. Only the scores that moved get a new
`asOf`. Each board is re-read at most once every 20 hours, so a run costs 6 of the free tier's
100 daily calls.

## Where things are

| | |
|---|---|
| Page | `src/app/apps/ai-rankings/page.tsx` → `src/components/ai-rankings/Leaderboard.tsx` |
| UI pieces | `ModelSheet.tsx` (view, rate, edit) · `InboxPanel.tsx` · `AnalyzeLink.tsx` (paste a link) · `parts.tsx` |
| Categories, scoring, filters | `src/lib/ai-rankings/leaderboard.ts` (pure, tested) |
| Owner actions | `src/lib/ai-rankings/boardActions.ts` (pure, tested; all input is cleaned here) |
| Sweep | `src/lib/ai-rankings/sweep.ts` (pure parts tested against recorded HF responses) |
| Score refresh | `src/lib/ai-rankings/scores.ts` (pure, tested; `AA_BOARDS` is the list of free AA boards) |
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
- `ARTIFICIAL_ANALYSIS_API_KEY` turns on the score refresh (free tier: 100 calls a day, this uses
  6). Without it the releases half still runs and the inbox line says the scores were not
  refreshed. Attribution is required on every tier; the page footer credits them.

## Change it

Before you start: read `leaderboard.ts` (the categories live in `CATEGORIES`) and this file. To add
a category, add one object to `CATEGORIES` with its family, its HF pipeline tags and its likes
bar; the rail, overview, inbox and forms all pick it up from there. Keep the rules: every write is
checked as the owner on the server, nothing the sweep finds goes public without approval, every
score names its source, and ranks are never renumbered by a filter.

Not built yet: visitor accounts with "follow a category" alerts. A score source AA's free tier does
not serve — realtime-voice's Big Bench Audio percent, and anything behind the Pro `rank` and
`release_date` fields — still has to be typed in the model sheet by hand.

# AI Rankings — public leaderboard redesign

Date: 2026-11-08 · Depth: **commercial** (public board, server data, owner-only writes)

## End goal

A visitor who wants "the best open-source TTS right now" or "what video model dropped this
week" gets the answer in one tap, and trusts it because every rank shows where its score came
from. The owner keeps it current in about a minute a day: new releases arrive in an inbox on their
own, and the owner only has to approve them.

## Named quality bar

**Artificial Analysis's per-modality leaderboards** (for example its Text-to-Speech arena page):
pick a modality, see a ranked list with a score, release date and open-weights flag. AI Rankings
must stand next to it, and add three things it doesn't have: a "Just dropped" view, the owner's
own rating and notes, and sites and tools alongside models.

## Features

1. **Category-first navigation.** Families (Language, Voice, Image, Video, Music, 3D and worlds,
   Sites) hold fine-grained categories: LLMs, coding agents, text-to-speech, realtime voice,
   speech-to-text, image, image editing, text-to-video, image-to-video, lipsync and avatars,
   music, 3D, world models, and platforms. Each category shows its count and a dot when something
   was released in the last 14 days.
2. **Overview.** With no category picked, a card per category shows its #1 and its newest release.
3. **Category view.** "Top ranked" (rank, name, maker, blended score bar, release date, badges)
   next to "Just dropped" (newest releases first, with their rank).
4. **One-tap filters** that apply everywhere: Open source, Runs locally, Free, Released within
   7, 30 or 90 days. Search covers name, maker, summary, features and tags.
5. **Blended score.** A public score (arena Elo or benchmark percent, with its source, label and
   date) plus the owner's 1–10 rating. Elo is normalised within its category (400 Elo = 100
   points). The blend is 50/50 when both exist and uses whichever one exists otherwise. A model
   with neither is listed as unranked. The model sheet shows the full breakdown.
6. **Model sheet.** Every fact, its features, the score breakdown and a link out. The owner can
   edit every field here.
7. **Owner tools** (only visible to the owner): add from a link (reuses the analyzer), edit,
   delete, rate, **Inbox**, **Check for new releases now**, **Preview as visitor**, and a one-time
   **Import from my old board**.
8. **The hard feature: a daily new-release inbox.** A GitHub Action calls `/api/ai-rankings/sweep`
   once a day. The sweep reads Hugging Face's trending models for each category's pipeline tags,
   keeps releases from the last 45 days that clear a likes threshold, skips quantised copies and
   other people's fine-tunes, skips anything already on the board or dismissed, and files the rest
   as suggestions. Nothing reaches the public board until the owner approves it.
   *Not in this round:* refreshing arena scores automatically from Artificial Analysis. Its API
   needs a key we don't have to test against, the free tier is 100 calls a day, and its free
   media responses don't include release dates. Scores are entered and refreshed in the model
   sheet for now.
9. **States:** loading skeleton, empty category (with a prompt to add a model when you are the
   owner), "no matches" with a reset-filters button, and plain-English failed-save and offline
   errors.

## Foundation (commercial)

- Sign-in: the hub's existing Supabase login. Visitors don't need an account.
- Roles: the owner is set by `HUB_OWNER_EMAILS`. Every write is checked on the server, in the
  route. With no Supabase configured (local demo), the local user is treated as the owner.
- Data: one server document (`server_docs`, service role, RLS with no policy). Locally it is a
  file. It is read and written with `readDocStrict`, so a failed read never saves an empty board.
- Public access: only `/apps/ai-rankings` and `/api/ai-rankings/board` become public. The
  analyzer and classify routes stay owner-only because they spend AI credits.
- Legal: links to the hub's `/legal`.
- Out of scope, by the owner's choice: visitor accounts, billing and account emails. This is a
  curated board that people read, not a product with members. The natural next step is visitor
  accounts with "follow a category" email alerts.

## Checklist rules in play

Never a white page, plain-English errors, phone-friendly at 390 px, newest first where time
matters, no duplicates (the sweep and the importer both dedupe by Hugging Face id, URL and name),
updates by itself (the daily sweep), simple setup (no keys needed to run).

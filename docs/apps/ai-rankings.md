# AI Rankings

Route: **`/apps/ai-rankings`** · Category: AI · **public**: visitors browse, only the owner edits.

A category-first leaderboard of AI models. A visitor picks a category (text-to-speech, realtime
voice, image-to-video…) and sees two lists for it: **Top ranked** and **Just dropped**. One-tap
filters cover open source, runs locally, free, and released within 7, 30 or 90 days. The category
and filters are kept in the URL (`?c=tts&open=1&r=30`), so every view is a link you can share.

Spec: [`docs/superpowers/specs/ai-rankings-public-leaderboard.md`](../superpowers/specs/ai-rankings-public-leaderboard.md)

## How the score works

**Every category is judged on its own dimensions**, each carrying its own weight, and the score out
of 100 is their weighted blend. Text-to-speech is judged on its public arena score, naturalness,
emotion, clarity, pronunciation accuracy, speed, cost and age; text-to-video on motion, prompt
adherence, consistency, native audio, clip length and cost; LLMs on arena Elo, reasoning, coding,
cost per million tokens, throughput and context. All fourteen sets live in
[`src/lib/ai-rankings/dimensions.ts`](../../src/lib/ai-rankings/dimensions.ts), weighted out of 100
(a test enforces that), and each one names its own leaderboard — "Arena Elo" for LLMs, "SWE-bench"
for coding agents.

A dimension's 0–100 comes from the first of four places that has an answer:

1. a **measurement** in that dimension's own unit — `$4.50/M tokens`, `120 ms to first audio`,
   `3.2% word error` — mapped onto 0–100 by a scale that says which value scores 100 and which
   scores 0. Prices, latencies and context windows use a log scale, because $0.01 → $0.10 an image
   is the same size of step as $0.10 → $1.00;
2. the owner's **1–10** for that dimension, ×10;
3. the **public score** — an arena Elo or a benchmark percent, with its source, label and date. Elo
   is measured from the category leader: the leader scores 100, and every 4 Elo behind costs one
   point. A percent is used as it is;
4. a **derivation** from the record itself — age from the release date (full marks today, nothing
   left after 18 months), openness from the weights and whether it runs on your GPU, and a rough
   cost from free/freemium/paid until a real price is typed in.

A dimension with none of the four is left **empty**, never guessed, and the weights renormalise over
what is known — so a thinly measured model is scored on what is known rather than punished for the
gaps. Each row carries a `known/of` mark saying how much of its category's weight that was.

**A derived value counts for half its weight** (`DERIVED_WEIGHT` in `dimensions.ts`). A cost of 30
because a model is "paid" is a guess standing in for a price nobody has looked up, and at full
weight that guess decided a category outright: GLM-5.3 took first place in LLMs over Gemini 4 Argon
— the actual arena leader — by 89 to 80, mostly on the strength of the word "free". Halved, the two
sit at 89.6 and 87.9: being free still counts, it just no longer outvotes a measurement. The
discount is on influence only — `coverage` still counts the dimension as known, because it is — and
it ends the moment the guess becomes a real number, typed in or read by the daily refresh.

**A derivation alone is never a score.** New, open and free is not evidence of being good at
anything, so a model with no benchmark, rating or measurement stays **unranked** no matter how many
derived cells it fills. One real number is enough to rank it.

Ranks are always computed over the whole board, so filters don't renumber anything: an
open model that is #5 overall still shows #5 with "Open source" on. Use **one score source per
category** (the seed test enforces this).

Because of that, a filtered **Top ranked** list has holes in it, and the holes are filled in: each
model the filter removed is shown in its own place as a muted row with its rank, its score and the
reason it is out ("closed", "paid", "cloud only", "older"). A run of more than three is named three
deep and then counted ("+ 2 more above"), and nothing is shown past the last matching row — below
it there is no hole, just the rest of the board. With **Open source** on, the list also opens with
where the best open model stands: *"Best open source: Fibo 2.0 at #5 of 8 · 31 points behind GPT
Image 2.6"*. All of it is pure and tested: `topRowsWithGaps`, `hiddenReason` and `openStanding` in
`leaderboard.ts`.

**Every column sorts the list.** "Which is best overall" is rarely the question a reader arrives
with — they want the cheapest that is still good, or the fastest, or the one that sounds most
human. Clicking a column head sorts by that dimension and the rows keep their true overall ranks,
so the new answer never costs you the old one; the sort is in the URL (`?c=tts&s=cost`) like
everything else, and below the column layout the same sort is a select. A `Best for cost: …` line
names the leaders the overall order hides. The holes above are only filled in while the list is in
rank order: sorted by cost, a missing #2 is not a hole.

## Staying current

`.github/workflows/ai-rankings-sweep.yml` calls `POST /api/ai-rankings/sweep` once a day (13:17
UTC). The run has three halves, and every feed behind them is published on the page itself —
`SOURCES` in [`src/lib/ai-rankings/sources.ts`](../../src/lib/ai-rankings/sources.ts) is rendered by
`SourcePanel` on the overview, with what each source covers, how often it is read and a link to
check it by hand. The categories no feed covers are named there too, because quiet-because-nothing-
shipped and quiet-because-nothing-is-watching look identical from outside.

**New releases**, from two feeds:
1. **Hugging Face trending** for each category's pipeline tags — original releases from the last 45
   days that clear the category's likes bar, minus quantised copies, other people's fine-tunes, and
   anything already on the board, in the inbox, or dismissed before;
2. **the Artificial Analysis boards** — any arena entry that is not on the board yet. This is what
   makes a hosted model findable at all: Veo, Kling, Seedance, GPT and Gemini have no HF repo to
   trend, so before this the daily check was blind to half the field. The entries are already in
   hand from the score refresh, so it costs no extra call. An arena entry says a model exists and
   nothing about where its weights are, so an approved one starts **hosted and paid** with no
   Hugging Face id, and its release date is honestly blank rather than dated to the day it was
   found — which would otherwise hand it a full recency score it had not earned.

A model both feeds find in one run is suggested once. Nothing goes public until the owner approves
it; the owner can also press **Check now** in the inbox.

**Measurements.** The same run re-reads the numbers the new dimensions are made of — price,
throughput and context window — from Artificial Analysis's free LLM data endpoint
(`src/lib/ai-rankings/metrics.ts`), for the language categories. Prices move far more often than
arena scores do, and a dimension nobody re-reads is exactly the kind of stale number that makes a
board quietly wrong. Each measurement records where it came from in `metricsFrom`, and the refresh
only ever rewrites its own: a number the owner typed in the sheet is marked `owner` and is never
overwritten. No price is taken from the media boards — a per-image price and a per-second video
price are not the same number, and a wrong price is worse than no price because it sorts the board.

**Scores.** The same run refreshes the **scores** already on the board from Artificial Analysis's free API
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
| **What each category is judged on** | `src/lib/ai-rankings/dimensions.ts` (pure, tested) — `CATEGORY_DIMS` is the per-category list, `LIB` the shared definitions |
| Measured prices, speeds, context | `src/lib/ai-rankings/metrics.ts` (pure parts tested) |
| The published list of feeds | `src/lib/ai-rankings/sources.ts` → `SourcePanel.tsx` on the overview |
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

Before you start: read `leaderboard.ts` (the categories live in `CATEGORIES`), `dimensions.ts` (what
each one is judged on) and this file. To add a category, add one object to `CATEGORIES` with its
family, its HF pipeline tags and its likes bar, **and one entry to `CATEGORY_DIMS`** — the rail,
overview, inbox, forms and score columns all pick it up from there, and a category with no
dimensions scores on nothing. To change what a category is judged on, edit its `CATEGORY_DIMS` list:
weights are out of 100 (a test enforces it), a dimension id reused from `LIB` keeps its meaning
everywhere, and a new one goes in `LIB` first with a code of four characters or fewer so it fits a
column head.

Keep the rules: every write is checked as the owner on the server, nothing the sweep finds goes
public without approval, every score names its source, ranks are never renumbered by a filter, a
dimension with no number is left empty rather than guessed, a derivation alone never ranks a model
and counts for only half its weight, and the daily refresh never overwrites a measurement the owner
typed.

Not built yet: visitor accounts with "follow a category" alerts. The judgement dimensions —
naturalness, motion, adherence and the rest — are the owner's to fill in; nothing estimates them,
by design, and a row shows which are still empty. A score source AA's free tier does not serve —
realtime-voice's Big Bench Audio percent, and anything behind the Pro `rank` and `release_date`
fields — still has to be typed in the model sheet by hand.

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/ai-rankings` — public
- `src/app/api/ai-rankings/`
- `src/components/ai-rankings/`
- `src/lib/ai-rankings/`

### Sign-in & who can use it

- Needs a signed-in user (requireUser / auth.getUser) — `src/lib/ai-rankings/boardServer.ts`
- Owner-only check (requireOwner / isOwner) — `src/lib/ai-rankings/boardServer.ts`

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/ai-rankings/analyze-url` | owner's sign-in |
| GET POST | `/api/ai-rankings/board` | public |
| POST | `/api/ai-rankings/classify` | owner's sign-in |
| POST | `/api/ai-rankings/site-url` | owner's sign-in |
| POST | `/api/ai-rankings/sweep` | per-account key (no session) |

### Data & database rules

- Saved data `ai-rankings:v2` — `src/lib/ai-rankings/store.ts`
- Server docs (server_docs via readDoc/writeDoc) — `src/lib/ai-rankings/boardServer.ts`

### Keys & outside services

- `AI_MODEL` — `src/app/api/ai-rankings/analyze-url/route.ts`, `src/app/api/ai-rankings/classify/route.ts` +1 more
- `AI_RANKINGS_SWEEP_TOKEN` — `src/app/api/ai-rankings/sweep/route.ts`
- `ARTIFICIAL_ANALYSIS_API_KEY` — `src/app/api/ai-rankings/sweep/route.ts`
- `HUB_OWNER_EMAILS` — `src/lib/ai-rankings/boardServer.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/ai-rankings/analyze-url/route.ts`, `src/app/api/ai-rankings/classify/route.ts`, `src/app/api/ai-rankings/site-url/route.ts`

### Called on a schedule

- .github/workflows/ai-rankings-sweep.yml calls /api/ai-rankings/sweep

### Tests

- `src/lib/ai-rankings/analyzeLink.test.ts`
- `src/lib/ai-rankings/backfillUrls.test.ts`
- `src/lib/ai-rankings/boardActions.test.ts`
- `src/lib/ai-rankings/dimensions.test.ts`
- `src/lib/ai-rankings/fromDashboard.test.ts`
- `src/lib/ai-rankings/fromOldBoard.test.ts`
- `src/lib/ai-rankings/leaderboard.test.ts`
- `src/lib/ai-rankings/metrics.test.ts`
- `src/lib/ai-rankings/nulkey.test.ts`
- `src/lib/ai-rankings/scores.test.ts`
- `src/lib/ai-rankings/seedModels.test.ts`
- `src/lib/ai-rankings/siteUrl.test.ts`
- `src/lib/ai-rankings/sources.test.ts`
- `src/lib/ai-rankings/sweep.test.ts`
<!-- code:end -->

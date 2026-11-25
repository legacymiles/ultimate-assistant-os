# Personas Studio

Route: `/apps/personas-studio` · Category: AI · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- personas-studio "what to change"`.

## What it does

A content studio for people who run several creator personas at once — a rap channel, an explainer page, a baby-growth diary. Each persona holds its profile overview, niche and voice, plus its TikTok, Instagram, YouTube, Facebook and X accounts with their usernames and sign-ins (kept in the encrypted Jarvis vault). Connect an account with the platform's own login and its videos sync in with views, likes and comments, and every sync records each video's progress. Every morning each persona gets fresh, shootable ideas built on what's working; press Plan it and the idea becomes a post in a pipeline (idea → script → film → edit → ready) and a week calendar you drag posts onto. Scheduled posts go out on their own through the official APIs — Instagram reels and Facebook Page videos publish at the time, TikTok videos land in the creator's inbox to post with one tap — and anything a platform can't take by API becomes a reminder that copies the caption and opens the app. Analytics shows views per day, follower growth, every video's growth curve against the persona's own normal (breakouts flagged), the best hours to post, and which formats earn the most. Works offline with template ideas when no AI key is set.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Social Personas grows into a full content studio** — Every persona in one place: profile overview, accounts on TikTok, Instagram, YouTube, Facebook and X with their usernames and sign-ins (Recall logins, sealed by the vault — never in the persona blob)…
- **A Daily Dancer, and a deletion that sticks** — The studio opens with Barry and nothing else, which is one persona doing one job. Daily Dancer is the second: a dance a day, taught like a mirror, with the character document and content plan written…
- **A link on every step, so nobody hunts through a console** — Each platform's guide opened with one link and then left you to find the rest by sidebar name inside TikTok's, Meta's and Google's portals — consoles most people see once. YouTube already linked all …
- **A learning loop, and personas filed under the job they do** — Adds three things the Studio did not have, without touching the Draft pipeline, the Message Inbox or publishing.
- **Message inbox tab — every DM and comment in one place** — Each persona gets a Message inbox tab (also in the Jarvis Personas pane): - Live read + reply for Instagram (DMs + comments), Facebook Pages (Messenger + comments) and YouTube (comments), on the pers…
- **Reading layer over the galaxy; one-tap Connect with in-app setup** — Words never sit on the moving background any more (new checklist rule U8): - Every Jarvis tab's content sits on a frosted reading layer (.nj-read); Chat frosts its conversation column and sidebar and…
- **Creator persona grid with TikTok/IG/FB connect, AI daily ideas and brainstorm** — Personas hold their accounts (platform login via official APIs when keys are set, handle + link import otherwise), a synced post table the AI watches/reads, a 'what the AI knows' memory, daily ideas …

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/personas-studio` — owner's sign-in
- Page `/apps/social-personas` — owner's sign-in
- `src/app/api/social-personas/`
- `src/components/social-personas/`
- `src/lib/social-personas/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/social-personas/analyze` | owner's sign-in |
| POST | `/api/social-personas/brain` | owner's sign-in |
| POST | `/api/social-personas/chat` | owner's sign-in |
| POST | `/api/social-personas/disconnect` | owner's sign-in |
| POST | `/api/social-personas/ideas` | owner's sign-in |
| POST | `/api/social-personas/inbox` | owner's sign-in |
| POST | `/api/social-personas/inbox/reply` | owner's sign-in |
| POST | `/api/social-personas/inbox/suggest` | owner's sign-in |
| POST PUT DELETE | `/api/social-personas/media` | owner's sign-in |
| GET | `/api/social-personas/oauth/[platform]/callback` | owner's sign-in |
| GET | `/api/social-personas/oauth/[platform]/start` | owner's sign-in |
| GET POST | `/api/social-personas/publish/tick` | per-account key (no session) |
| GET | `/api/social-personas/queue` | owner's sign-in |
| POST | `/api/social-personas/schedule` | owner's sign-in |
| GET POST DELETE | `/api/social-personas/setup` | owner's sign-in |
| GET | `/api/social-personas/status` | owner's sign-in |
| POST | `/api/social-personas/sync` | owner's sign-in |
| POST | `/api/social-personas/unschedule` | owner's sign-in |

### Data & database rules

- Saved data `social-personas:v1` — `src/lib/social-personas/store.ts`
- Server docs (server_docs via readDoc/writeDoc) — `src/lib/social-personas/server/connectors.ts`, `src/lib/social-personas/server/platformKeys.ts`, `src/lib/social-personas/server/queue.ts` +1 more

### Keys & outside services

- `AI_MODEL` — `src/lib/social-personas/server/ai.ts`
- `FACEBOOK_APP_ID` — `src/lib/social-personas/server/connectors.ts`
- `FACEBOOK_APP_SECRET` — `src/lib/social-personas/server/connectors.ts`
- `INSTAGRAM_APP_ID` — `src/lib/social-personas/server/connectors.ts`
- `INSTAGRAM_APP_SECRET` — `src/lib/social-personas/server/connectors.ts`
- `PERSONAS_TICK_TOKEN` — `src/app/api/social-personas/publish/tick/route.ts`
- `SOCIAL_OAUTH_ORIGIN` — `src/lib/social-personas/server/http.ts`
- `SOCIAL_PERSONAS_DATA_DIR` — `src/lib/social-personas/server/connectors.ts`, `src/lib/social-personas/server/platformKeys.ts` +2 more
- `TIKTOK_CLIENT_KEY` — `src/lib/social-personas/server/connectors.ts`
- `TIKTOK_CLIENT_SECRET` — `src/lib/social-personas/server/connectors.ts`
- `YOUTUBE_CLIENT_ID` — `src/lib/social-personas/server/connectors.ts`
- `YOUTUBE_CLIENT_SECRET` — `src/lib/social-personas/server/connectors.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/lib/social-personas/server/ai.ts`

### Called on a schedule

- .github/workflows/personas-tick.yml calls /api/social-personas/publish/tick

### Tests

- `src/lib/social-personas/inbox.test.ts`
- `src/lib/social-personas/learn.test.ts`
- `src/lib/social-personas/logic.test.ts`
- `src/lib/social-personas/queue.test.ts`
- `src/lib/social-personas/studio.test.ts`
<!-- code:end -->

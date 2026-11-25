# 3D Studio Video Creator

Route: `/apps/3d-studio` · Category: Video · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- 3d-studio "what to change"`.

## What it does

An AI animation director that turns a simple prompt into a complete animated video. Pick a style, length and format; the director interprets the idea, writes the story beats, casts characters, scouts sets and storyboards every shot with a camera move, lighting and timing. For each piece of motion it decides the right tool — Mixamo mocap clips for everyday humanoid movement, Cascadeur for stunts, fights, creatures and physics-based motion, Blender for cameras, objects and effects — and explains why. The storyboard plays instantly as a moving 3D animatic you can export, and one click sends it to Blender on your own PC, where Claude Code builds, animates and renders the finished film for you to watch and download.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Prompt -> AI animation director -> Blender render** — An AI animation director at /apps/3d-studio. The director (AI with an offline fallback) interprets a prompt into story beats, cast, sets and a storyboard, and routes every motion to Mixamo, Cascadeur…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/3d-studio` — owner's sign-in
- Page `/apps/3d-studio/[id]` — owner's sign-in
- `src/app/api/studio3d/`
- `src/components/studio3d/`
- `src/lib/studio3d/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET POST | `/api/studio3d/builder-token` | owner's sign-in |
| POST | `/api/studio3d/builder/claim` | per-account key (no session) |
| POST | `/api/studio3d/builder/fail` | per-account key (no session) |
| POST | `/api/studio3d/builder/media` | per-account key (no session) |
| POST | `/api/studio3d/builder/progress` | per-account key (no session) |
| GET | `/api/studio3d/media/[id]/[which]` | owner's sign-in |
| GET POST | `/api/studio3d/projects` | owner's sign-in |
| GET POST PATCH DELETE | `/api/studio3d/projects/[id]` | owner's sign-in |

### Data & database rules

- Server docs (server_docs via readDoc/writeDoc) — `src/lib/studio3d/store.ts`

### Keys & outside services

- `AI_MODEL` — `src/lib/studio3d/director/llm.ts`
- `GAME_CREATOR_DATA_DIR` — `src/lib/studio3d/store.ts`
- `STUDIO3D_DATA_DIR` — `src/lib/studio3d/store.ts`
- `STUDIO3D_MODEL` — `src/lib/studio3d/director/llm.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/lib/studio3d/director/llm.ts`

### Tests

- `src/lib/studio3d/studio3d.test.ts`
<!-- code:end -->

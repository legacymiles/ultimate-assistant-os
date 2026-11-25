# Video Studio Arena

Route: `/apps/video-studio-arena` · Category: Video · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- video-studio-arena "what to change"`.

## What it does

The studio every other video idea plugs into, so there is one place to make a video instead of eight apps. Describe what you want — subject, length, style, audience, aspect, narration, music, captions — and pick HOW it gets made: Remotion for motion graphics, diagrams and data; HyperFrames for AI-directed programmatic scenes; Unreal Engine for 3D cinematics, characters and Sequencer camera work; Blender for custom 3D, simulations and product films; H3 for cinematic AI footage. Every engine is a plugin with its own skill, capability detection and execution pipeline, so adding a sixth is a folder, not a rewrite. The AI writes an engine-agnostic production plan you read and approve scene by scene, then rewrites every scene in the chosen engine's own terms — you never have to know how any of these tools work. Rendering is real and so is the status list: H3 runs on the server, the other four run on your PC through the studio runner, and a missing install, MCP or key is named on the card rather than faked. Regenerate a single scene, duplicate the project to try another engine and compare them side by side, and — in AI Director mode — let it route each scene to whichever engine suits it and assemble the lot.

## Features

_None written yet._

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/video-studio-arena` — owner's sign-in
- `src/app/api/video-studio/`
- `src/components/video-studio/`
- `src/lib/video-studio/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET | `/api/video-studio/methods` | owner's sign-in |
| POST | `/api/video-studio/plan` | owner's sign-in |
| GET POST | `/api/video-studio/projects` | owner's sign-in |
| GET POST DELETE | `/api/video-studio/projects/[id]` | owner's sign-in |
| GET | `/api/video-studio/projects/[id]/video` | owner's sign-in |
| GET POST | `/api/video-studio/runner-token` | owner's sign-in |
| POST | `/api/video-studio/runner/claim` | per-account key (no session) |
| POST | `/api/video-studio/runner/clip` | per-account key (no session) |
| POST | `/api/video-studio/runner/fail` | per-account key (no session) |
| POST | `/api/video-studio/runner/progress` | per-account key (no session) |

### Data & database rules

- Server docs (server_docs via readDoc/writeDoc) — `src/lib/video-studio/server/store.ts`

### Keys & outside services

- `AI_MODEL` — `src/lib/video-studio/server/plan.ts`
- `BLENDER_MCP_PORT` — `src/lib/video-studio/methods/blender/server.ts`
- `BLENDER_PATH` — `src/lib/video-studio/server/detect.ts`
- `CLAUDE_CONFIG_PATH` — `src/lib/video-studio/server/detect.ts`
- `FFMPEG_PATH` — `src/lib/video-studio/server/detect.ts`
- `GAME_CREATOR_DATA_DIR` — `src/lib/video-studio/server/store.ts`
- `HYPERFRAMES_API_KEY` — `src/lib/video-studio/methods/hyperframes/server.ts`
- `UNREAL_ENGINE_DIR` — `src/lib/video-studio/server/detect.ts`
- `VIDEO_STUDIO_DATA_DIR` — `src/lib/video-studio/server/store.ts`
- `VIDEO_STUDIO_MODEL` — `src/lib/video-studio/server/plan.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/lib/video-studio/server/plan.ts`

### Tests

- `src/lib/video-studio/plan.test.ts`
<!-- code:end -->

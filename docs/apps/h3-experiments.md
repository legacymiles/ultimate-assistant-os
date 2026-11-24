# H3 Prompt Lab

Route: `/apps/h3-experiments` · Category: Video · Live

Record reviewed: 2026-11-24

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- h3-experiments "what to change"`.

## What it does

The self-improving MiniMax H3 prompting lab (grown from H3 Experiments on 2026-11-24 — same slug, so old links work). There is ONE Master Prompt Guide and it publishes as ONE skill, `h3-prompt`. Experiments are not rival guides: each one changes a few of the compiler's techniques (knob = value: lead block, camera wording, identity handling, length, shot structure, set description, action writing, dialogue format, closing clause) on top of the guide's settings for a genre. Every test is paired — the same scenario rendered by the master and by the experiment with the same seed on the owner's own H3 in WanGP — and every clip is measured by ffmpeg on the PC (cuts, frame-to-frame SSIM, freezes, exposure, camera motion) before a vision judge scores what it sees with frame-numbered evidence. Credit goes to individual techniques (additive back-fitting, so techniques that travelled together split it), ranked by the lower bound of a 90% interval with shrinkage, so one lucky render cannot win. Techniques that clear the bar are combined per genre into a proposed guide change with its evidence; nothing changes the guide without approval (unless promotion is set to automatic), every version is kept, and rollback makes a new version.

Design spec: `docs/superpowers/specs/2026-11-24-h3-prompt-lab-design.md`. PC worker: `tools/h3-lab-worker/` (README there).

## Features

- **Master Prompt Guide** — v1 consolidates `h3-prompt` (everything in it survives), MiniMax's official base/Ref2VA formats, the measured long-video rules from the seesee75 Director paper (rules only; its GPL code is not used) and this PC's WanGP facts: 14 core sections + 43 genre modules across narrative, cinematic, action, gaming and commercial. Read it all, copy as SKILL.md, view any version, roll back.
- **Genre modules inside the one guide** — each genre has its own compiler settings, scoring weights, rules, pacing, camera language and continuity list; the agent researches per genre.
- **Deterministic compiler + linter** (`compile.ts`, `lint.ts`) — official base or six-section Ref2VA prompt from a shot spec and the bibles; the linter checks length per shot, two-positions, dialogue that cannot fit at 2.5 words/s, beats, duration, bracket camera tags, phantom references, missing sound, body contact and off-frame entrances.
- **Experiment Lab** — experiments A–E seeded as drafts (character-first, environment-first, cinematography-first, structured scene-by-scene, hybrid) with hypotheses; the live compiler (the standout) rewrites the prompt instantly as technique switches are flipped and highlights what changed; queue paired renders, render once, save as an experiment.
- **Experiment Comparisons** — technique leaderboard ranked by lower bound, per genre; side-by-side master vs experiment with videos, aligned judging frames, per-dimension deltas, prompt diff and owner ratings; the old skill-films ledger lives inside it.
- **Scoring** — 11 dimensions, genre-weighted: measured (continuity by SSIM spikes against the clip's own baseline, so a steady fast push is not a morph; camera match; freezes; static-camera set stability; exposure) + judged (vision model, frame-cited) + owner overrides.
- **Continuity Inspector** — measured and judged issues with severity, confidence, timestamp, evidence and a recommended prompt fix; changes the spec marks intentional (position, lighting, wardrobe, environment, props) are never flagged; across production scenes it compares the previous scene's end with this one's start.
- **Video Reverse Engineering** — the browser finds the shots (colour-histogram cuts) and grabs keyframes; a vision model writes a blueprint (people, positions, actions, dialogue, emotion, camera, light, set, props, transitions); recreate it as a production with your own cast and sets — never a face swap. Without an AI key it stores the measured structure only and says so.
- **Character / Environment / Production bibles** — explicit identity and layout fields, continuity rules, reference photos (sent to H3 as Ref2VA references, identity first); productions compile prompts frozen with the guide version, render per scene, and show the continuity strip between scenes.
- **Autonomous agent** — `agent.ts` decides the next step (evaluate → conclude → combine → queue → design → research); it runs from the PC worker's idle tick, the open page, and a GitHub Actions schedule (`h3-lab-tick.yml`, only once `H3LAB_TICK_TOKEN` is set on GitHub and Vercel). Start / pause / resume / stop, run one step, daily render and AI budgets (owner renders are never budget-blocked), max concurrent experiments, manual or automatic promotion, hub AI or Claude Code (via the worker) as the brain. Offline experiment design picks the weakest genre-weighted dimension and tests ONE untested technique at a time.
- **H3 Connection** — the PC worker (`tools/h3-lab-worker`) polls the hub with its own token (the site never calls the laptop), renders through the existing WanGP MCP on :42004 (never starts a second wgp.py), measures, uploads to Storage bucket `h3-lab` via a signed PUT, and re-queues renders it lost on restart. Diagnostics page with pass/fail rows.
- **Repository Research** — the five researched repos plus the evaluation tools, with licence, compatibility, recommendation and integration status; the agent adds GitHub finds for review; nothing is installed automatically.
- **Jarvis Skill Integration** — Publish writes the approved guide to the `h3-prompt` skill through the hub's skill store (the same store as the jarvis-memory connector), with up to three top-scoring prompts as examples.
- **Activity feed** — every entry is written by the step that did the work; nothing is synthesised.

## Must keep working

- The old skill-films ledger (`H3Lab.tsx`, `h3lab:v1`, `/api/h3-lab/films`, `/api/h3-lab/skills`) still opens inside Experiment Comparisons.
- Approving a change never edits an existing version; rollback adds a version; rejected changes stay in history.
- A paired test renders master and experiment with the same seed; experiment renders only run while the agent is running and within the daily budget; the owner's own renders are never budget-blocked.
- The worker routes accept only the worker token (`h3l_…`, stored hashed) or, for `/worker/tick`, `H3LAB_TICK_TOKEN`; the clip route streams local files only from WanGP's outputs folder and never on Vercel.
- No score, issue or activity entry is ever shown that a real render, measurement, judge or owner action did not produce.

## Requested, not built yet

- Face-embedding identity scoring (insightface / facenet-pytorch) to make character consistency a measured dimension — needs a Python install the owner approves.
- PySceneDetect / TransNetV2 shot detection on the PC for reference videos (browser histogram cuts and ffmpeg `scdet` are used now).
- SyncNet / mediapipe lip-sync scoring for dialogue shots.
- Retiring `h3-cinematic-prompt`, `h3-stitched-film` and `h3-long-story` (folded into the guide) so only `h3-prompt` remains — the owner's call.
- Smart Shot's own compiler (`src/lib/smart-shot/h3prompt.ts`) reading the approved guide's settings.
- Importing the ~200 past renders in WanGP's outputs folder (their settings are embedded in the mp4) as historical evidence.

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/h3-experiments` — owner's sign-in
- `src/app/api/h3-lab/`
- `src/components/h3-lab/`
- `src/lib/h3-lab/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/h3-lab/agent/tick` | owner's sign-in |
| POST | `/api/h3-lab/analyze` | owner's sign-in |
| GET | `/api/h3-lab/blueprint` | owner's sign-in |
| GET | `/api/h3-lab/clip` | owner's sign-in |
| GET | `/api/h3-lab/films` | owner's sign-in |
| GET | `/api/h3-lab/frames` | owner's sign-in |
| GET POST | `/api/h3-lab/lab` | owner's sign-in |
| GET | `/api/h3-lab/skills` | owner's sign-in |
| POST | `/api/h3-lab/worker/claim` | per-account key (no session) |
| POST | `/api/h3-lab/worker/progress` | per-account key (no session) |
| POST | `/api/h3-lab/worker/result` | per-account key (no session) |
| POST | `/api/h3-lab/worker/think` | per-account key (no session) |
| POST | `/api/h3-lab/worker/tick` | per-account key (no session) |
| POST | `/api/h3-lab/worker/upload` | per-account key (no session) |

### Data & database rules

- Saved data `h3lab:v1` — `src/lib/h3-lab/types.ts`
- Server docs (server_docs via readDoc/writeDoc) — `src/components/h3-lab/lab/sections/Connection.tsx`, `src/components/h3-lab/lab/useLab.ts`, `src/lib/h3-lab/api.ts` +1 more

### Keys & outside services

- `H3LAB_DATA_DIR` — `src/lib/h3-lab/server/store.ts`
- `H3LAB_TICK_TOKEN` — `src/app/api/h3-lab/lab/route.ts`, `src/lib/h3-lab/server/http.ts`
- `VERCEL` — `src/app/api/h3-lab/clip/route.ts`
- `WANGP_DIR` — `src/app/api/h3-lab/clip/route.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/h3-lab/analyze/route.ts`, `src/app/api/h3-lab/lab/route.ts`, `src/lib/h3-lab/server/brain.ts`

### Called on a schedule

- .github/workflows/h3-lab-tick.yml calls /api/h3-lab/worker/tick

### Tests

- `src/components/h3-lab/lab/research/shotDetect.test.ts`
- `src/lib/h3-lab/lab.test.ts`
<!-- code:end -->

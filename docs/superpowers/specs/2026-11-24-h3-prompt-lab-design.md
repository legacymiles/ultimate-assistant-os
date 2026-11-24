# H3 Prompt Lab — design

Date: 2026-11-24 · App: `/apps/h3-experiments` (grown in place; title "H3 Prompt Lab") · Depth: owner-only tool, Foundation inherited from the hub (owner middleware, service-role `server_docs`, token-only worker routes). No second person, so no billing/legal layer.

## End goal

Fewer failed H3 generations and less hand-prompting: one Master Prompt Guide that gets measurably better on its own, published as the ONE `h3-prompt` skill, while experiments run in the background against the owner's real WanGP install.

The goal beyond it: the guide knows *per genre* what works (a fight is not a sitcom), and every line in it has evidence a person can click.

## Named bar

Weights & Biases' run-comparison workspace (runs table → pick two → per-metric deltas with the media side by side), at the density of Linear's issue view.

## What already exists and is reused

| Need | Reused |
|---|---|
| Render H3 locally | WanGP MCP `wangp_generate` on `127.0.0.1:42004/mcp` (protocol proven by `tools/studio-bridge/server.mjs`), models `minimax_h3_{ref2va,fl2va}_pruned`, quality ladder turbo/hi |
| Clip measurement | ffmpeg 9 filters on this PC: `scdet` (shots), `ssim`, `vidstabdetect` (camera motion), `freezedetect`, `signalstats` (exposure) — no Python install needed |
| Worker pattern | `tools/video-studio-runner` (token claim/progress/upload), `src/lib/video-studio/server/store.ts` token minting |
| Persistence | `server_docs` via `src/lib/server/docStore.ts`; clips in Storage via `blobStore.ts` |
| AI | `src/lib/ai/provider.ts` `aiFetch` (vision via `image_url` parts); optional Claude Code (`claude -p`) brain on the PC |
| Old ledger | `H3Lab.tsx` (skill films ledger) stays, mounted inside Comparisons |
| Prompt knowledge | `~/.claude/skills/h3-prompt` (+ cinematic/stitched/long-story/scene-continuity), MiniMax official `base-en.txt`/`ref-en.txt`, seesee75 Director's measured rules (GPL — rules only, no code) |

## Core idea: experiments are technique settings, not whole guides

The compiler (`compile.ts`) turns a shot spec + bibles into an official-format H3 prompt. Its behaviour is a **Strategy**: one value per knob (order, camera wording, identity handling, length, structure, environment detail, action writing, dialogue format, closing clause). A **technique** is one knob=value.

- The Master Guide = an approved base Strategy + per-genre overrides + prose sections.
- An Experiment = overrides on top of the genre's master strategy + a hypothesis.
- Tests are **paired**: the same scenario is compiled by master and by the experiment and rendered with the same seed. Scores are compared pair by pair.
- Statistics are per technique and per dimension (shrunk mean, 90% interval, rank by the lower bound — the Personas Studio rule that stops n=1 beating n=10). The agent never promotes a whole experiment: it combines the techniques whose lower bound is above zero, one knob each.

## Scoring

Eleven dimensions. Measured ones come from ffmpeg evidence (environment stability, continuity, camera accuracy vs the requested move, movement/dead-shot, visual exposure). Judged ones come from a vision model looking at extracted frames (character identity, action, dialogue, genre, cinematography, adherence) and must cite what it saw; the owner's rating overrides both. Genre weights decide what matters (fight: action + movement + continuity; sitcom: dialogue + character).

## The loop (24/7)

`agent.ts` decides the next step from state alone (pure, tested): evaluate finished renders → conclude finished experiments → propose combinations → queue renders for drafted experiments (budget) → design a new experiment from the weakest dimension → research. It runs on:
1. the PC worker's idle loop (every few minutes while it runs),
2. the open page,
3. a GitHub Actions schedule when a tick token is configured (laptop off: reasoning continues, renders wait in the queue).

Pause/stop are checked at every step. Every activity entry is written by the step that did the work — none are synthesized.

## Never silently rewrite

Approved changes create a new guide version with what/why/problem/experiments/evidence. Rollback creates a new version copying an old one. Publishing to the `h3-prompt` skill is an owner button (it changes the Jarvis skill every device syncs).

## Out of this first delivery (filed as follow-ups)

Face-embedding identity scoring (insightface/facenet — needs a Python install, approval-gated), PySceneDetect/TransNetV2 shot detection (ffmpeg `scdet` used now), SyncNet lip-sync scoring, folding the four other H3 skills into `h3-prompt` (needs owner approval), wiring the website's own Smart Shot compiler to read the approved guide.

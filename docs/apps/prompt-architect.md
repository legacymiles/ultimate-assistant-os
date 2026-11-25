# Prompt Architect

Route: `/apps/prompt-architect` · Category: AI · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- prompt-architect "what to change"`.

## What it does

Turn a vague, half-formed idea into an amazing, build-ready prompt. Describe what you want and Prompt Architect runs a short adaptive interview — a first round of sharp questions, then a second round that closes the gaps your answers open and lands a real, named quality bar to beat. It shapes everything into an editable overview (one-liner, purpose, design direction, core vs supporting features) and routes the idea's vibe to the right design skills, then writes an optimized prompt for an agent like Claude Code — with a Builder-vs-Critic gauntlet baked in and a one-click 'Copy for Gauntlet' handoff. A portable toggle strips personal references for a shareable prompt. AI-powered with a full offline fallback.

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

- Page `/apps/prompt-architect` — owner's sign-in
- `src/app/api/blueprint/`
- `src/components/blueprint/`
- `src/lib/blueprint/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/blueprint` | owner's sign-in |

### Data & database rules

- _No database, storage or saved data of its own._

### Keys & outside services

- `AI_MODEL` — `src/app/api/blueprint/route.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/blueprint/route.ts`

### Tests

- _None yet._
<!-- code:end -->

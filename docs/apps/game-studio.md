# Game Studio

Route: `/apps/game-studio` · Category: Apps · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- game-studio "what to change"`.

## What it does

Every game in one place. Create is Game Creator: describe a game and Unreal Engine on your PC designs it, builds the gameplay, playtests it, takes screenshots from the player's eye and packages it, all in a gallery that updates live. Unfinished games is the shelf of games that play but are not done yet — Slippery Escape and Item Storm Arena today — each playable right there in the list, one tap from full screen, with a Finish it button that hands the rest of the work to Claude Code through your In Queue.

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

- Page `/apps/game-studio` — owner's sign-in
- `src/components/game-studio/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

- _None._

### Data & database rules

- _No database, storage or saved data of its own._

### Keys & outside services

- _None._

### Tests

- _None yet._
<!-- code:end -->

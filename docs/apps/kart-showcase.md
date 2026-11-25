# APEX/01 Kart Teardown

Route: `/apps/kart-showcase` · Category: Websites · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- kart-showcase "what to change"`.

## What it does

A cinematic, interactive 3D racing-kart teardown. Orbit the machine on a lit stage, hover a section to explode it into individually labelled parts with names and specs, and click any part to isolate it — then scroll down to drop into a first-person, scroll-driven ride through a neon tunnel with a live speed/gear HUD. Built with React Three Fiber, GSAP and Lenis; honours reduced motion and degrades gracefully without WebGL.

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

- Page `/apps/kart-showcase` — owner's sign-in
- `src/components/kart/`
- `src/lib/kart/`

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

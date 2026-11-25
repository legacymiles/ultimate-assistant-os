# EMBER Reveal

Route: `/apps/fire-reveal` · Category: Image · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- fire-reveal "what to change"`.

## What it does

A WebGL mouse-trail image-reveal studio, built with a custom GLSL shader in the style of Unicorn Studio's scanning effect. Two pixel-aligned images are stacked in one shader; moving the cursor paints a persistent trail that scans the top image away to reveal what's hidden underneath, with a thin chromatic-split distortion band at the boundary. The trail holds for a beat after you stop, then eases closed. Upload your own two images and switch rim tints (Ember, Inferno, Frost, Toxic) live. Runs as a single draw call at 60fps, honours reduced motion with a drag-to-reveal crossfade, and degrades gracefully without WebGL.

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

- Page `/apps/fire-reveal` — owner's sign-in
- `src/components/reveal/`

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

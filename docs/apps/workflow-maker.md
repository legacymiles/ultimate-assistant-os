# Workflow Maker

Route: `/apps/workflow-maker` · Category: Video · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- workflow-maker "what to change"`.

## What it does

The owner's "rea to workflow". Drop a video or pictures of any process — how people make money clipping videos, a fitness influencer's routine, an avatar agent, cooking ASMR, a step-by-step tutorial, an app you like — and say what you want. Jarvis watches it frame by frame (the video-analyzer and rea pass), raises it with felix and the scholar, and lays out the blueprint: every input as an upload slot, every stage with the engine that does it and where it runs, the one result, how we'll know it works, and the card exactly as it will sit on the Studio wall. Edit any of it, press Build it, and Claude Code on your PC builds the real, working tool with the rea-to-workflow skill, tests it and puts it live. Also a card in Jarvis › Studio.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Custom Video Swap and Workflow Maker cards with their own screens** — Custom Video Swap: pick the card, drop a clip + new faces + a background, say who becomes who — the screen opens with every upload in its slot (driving video, original → new character with a lit arro…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/workflow-maker` — owner's sign-in

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

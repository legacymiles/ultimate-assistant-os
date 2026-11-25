# Custom Video Swap

Route: `/apps/custom-video-swap` · Category: Video · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- custom-video-swap "what to change"`.

## What it does

Recast any clip. Drop the driving video, a photo of each new character and the new background: each person in the clip sits next to who they become with an arrow between, you tap them on the frame where their faces are clearest, and the new world sits beside them. Make it sends the job — clip included — to your PC, where Viggle swaps the characters (one frame edited, carried through every frame), MiniMax H3 turns the background picture into a living plate, and Robust Video Matting lays the people onto it, graded to its light. It comes back as a before | after you drag across. Free, on your own GPU. Also a card in Jarvis › Studio.

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

- Page `/apps/custom-video-swap` — owner's sign-in

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

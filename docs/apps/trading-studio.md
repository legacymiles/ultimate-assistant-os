# Trading Studio

Route: `/apps/trading-studio` · Category: Utilities · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- trading-studio "what to change"`.

## What it does

Six trading tools that used to be six apps, behind one switcher the way Jarvis Audio Studio holds its three — each still the app it was, each with its own accent so where you are is felt before it is read. EA World is the vault of what you learned about your bots and EA Lab is the bench that measures them; both run on this PC and open here once their code is brought onto the website. Replay plays a bot against a real past New York session tick by tick on real Dukascopy bid/ask, with a simulated MT4 broker that charges latency, slippage and commission. Terminals starts and opens the three outside market terminals that run beside it. The Feature List holds every dictated Expert Advisor spec, tagged and searchable and one click from your clipboard. And the Calculator prices a whole basket of gold orders at once — where it breaks even, what it makes at any exit, and the exit that lands a target profit. Old links to any of the six land in the right section.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **A Trading Agent that reads a setup and signs nothing** — Third section, after EA World and EA Lab — learn, measure, then reason. It is the one section here that measures nothing and runs nothing.
- **EA Lab is in, so its pending panel goes** — Trading Studio's Lab tab has been a placeholder reading "EA Lab is on your PC and isn't on the website yet. This tab is where it will open." The code it was waiting for existed, committed, on a featu…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/trading-studio` — owner's sign-in
- `src/components/trading-studio/`

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

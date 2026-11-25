# EA Lab

Route: `/apps/ea-lab` · Category: Utilities · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- ea-lab "what to change"`.

## What it does

A bench where a MetaTrader Expert Advisor stops being a claim and becomes a measurement. Drop an .ex4 into the watched folder and it is registered, installed into an idle test terminal, backtested headless, filed by strategy and rated — without the terminal being touched by hand. It reads like a database because it is one: strategy tree down the left, a dense sortable table in the middle, the full record on the right. Two columns do the work no MetaTrader report does. The first is NAKED: peak UNHEDGED exposure, reconstructed from the open book rather than from closed trades, which is the figure that actually ends accounts — one hedge EA from the owner's own folder posts a 71.6% win rate and quietly reaches 231x its base lot unhedged. The second is modelling quality, which rides with every number, because a profit factor from a 25%-quality run and one from real ticks are not the same kind of fact and the lab refuses to rank them together. Ratings are built on out-of-sample results only: ranking on in-sample profit factor just sorts the folder by how thoroughly each EA memorised the past. EAs are filed by HOW THEY FAIL — martingale, hedge-recovery, grid, scalper, trend, mean-reversion — since grouping by indicator would file a doubling grid next to a fixed-stop breakout for both reading an RSI. Testing runs on this PC through a local runner; with it off the app opens, says so plainly, and shows everything it already knows.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **EA Lab is in, so its pending panel goes** — Trading Studio's Lab tab has been a placeholder reading "EA Lab is on your PC and isn't on the website yet. This tab is where it will open." The code it was waiting for existed, committed, on a featu…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/ea-lab` — owner's sign-in
- `src/components/ea-lab/`
- `src/lib/ea-lab/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

- _None._

### Data & database rules

- _No database, storage or saved data of its own._

### Keys & outside services

- _None._

### Tests

- `src/lib/ea-lab/exposure.test.ts`
- `src/lib/ea-lab/rating.test.ts`
- `src/lib/ea-lab/report-mt5.test.ts`
- `src/lib/ea-lab/report.test.ts`
<!-- code:end -->

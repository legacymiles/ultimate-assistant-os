# Expert Advisor World

Route: `/apps/ea-world` · Category: Utilities · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- ea-world "what to change"`.

## What it does

Several studios behind one front door, the way Jarvis Audio Studio is — Analyze, Vault and Bench, each its own application, sharing a palette and a store, and each carrying an accent hue so which one you are in is something you feel before you read it. A folder of .mq4 files records what you own; this records what you LEARNED, which is the only thing that compounds toward a better bot. It starts at Analyze: drop an EA in, or paste it straight out of MetaEditor, and it is read on the spot, in the browser, with nothing uploaded — because an EA is often the only copy of something somebody paid for. Source is taken apart into the family it belongs to, a risk score with every tell quoted at its line number, and the mechanics worth copying with the code pulled out ready to keep; a Strategy Tester .htm report is parsed by EA Lab's own parser for the real numbers, so the two apps cannot disagree about what a report says; and an .ex4 is told plainly that nothing can read inside machine code. The Vault is four ledgers: the EAs with their source kept as readable text and synced to every device; the mechanics worth stealing, each one a short overview plus the smallest MQL4 that actually works on a live server, stop levels and error codes included, because those are the lines forum posts leave out and the reason the forum version loses money; the strategy families, filed by HOW THEY DIE rather than what they read, since grouping by indicator files a doubling grid next to a fixed-stop breakout; and the ideas not built yet, each with the stage it has reached. Every record carries two fields a file listing cannot — where it came from, and how it fails — and a bot whose failure mode is blank says so in amber. Then the part that makes collecting worth anything: the build bench. Draft features, bots and ideas onto it and it compiles ONE build prompt, governing rules first and risk floor second so the rules outrank the signal rather than filtering it, and it names the CONTRADICTIONS before any code — draft a loss-doubling sizer next to a drawdown ceiling and it says so, in words, with the reconciling move, because that rule gets implemented twice and obeyed once. The twelve dictated feature specs are read live from the EA Feature List rather than copied, so the two cannot drift. Pairs with EA Lab: this is where a bot is understood, that is where it is measured.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **HFT Secret v2 and Fingerprint the original** — HFT_Secret_v2.mq4 + replay twin: the original's published rule (34-SMA channel on M1 highs/lows, US30) picks the side; v1's HFT engine trades it, now with breakeven, flatten at session end, daily tar…
- **Replay studio, Terminals studio, HFT Secret rebuild EA** — Replay (/apps/ea-world/replay): real Dukascopy bid/ask ticks for a past NY session, a simulated MT4 broker (latency, stop slippage, stop level, commission, margin), visual playback 1x-300x with the b…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/ea-feature-list` — owner's sign-in
- Page `/apps/ea-world/replay` — owner's sign-in
- Page `/apps/ea-world/terminals` — owner's sign-in
- `src/app/api/ea-replay/`
- `src/components/ea-replay/`
- `src/components/ea/`
- `src/lib/ea-features/`
- `src/lib/ea-replay/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/ea-replay/port` | owner's sign-in |
| GET | `/api/ea-replay/ticks` | owner's sign-in |

### Data & database rules

- _No database, storage or saved data of its own._

### Keys & outside services

- `AI_MODEL` — `src/app/api/ea-replay/port/route.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/ea-replay/port/route.ts`

### Tests

- `src/app/api/ea-replay/ticks/route.test.ts`
- `src/lib/ea-replay/replay.test.ts`
- `src/lib/ea-replay/v2.test.ts`
<!-- code:end -->

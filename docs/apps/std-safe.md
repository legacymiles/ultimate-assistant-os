# Tap Safe

Route: `/apps/std-safe` · Category: Apps · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- std-safe "what to change"`.

## What it does

A tracker for the STD lab reports you already receive, and a way to show someone what you were tested for, what came back, and how long ago the sample was taken. Upload the PDF from STDcheck, Quest, Labcorp or MyChart and it is read server-side — lab, panel, collection date and each of ten results — then handed to you on a review screen where nothing is saved until you confirm every line. A phone photo goes to a vision model instead, and when there is no key it says so and drops to manual entry rather than pretending. The word "clean" appears nowhere in it. Status is derived per infection rather than per record, because someone may have had HIV drawn two weeks ago and syphilis six months ago, and one overall date would hide that; every row carries its own age, fresh under 30 days and stale past 90, and the ones nobody tested for stay on screen in grey so a two-test panel can never look like a full workup. Positives are first-class and carry treatment context — treated and cleared, undetectable, on suppressive therapy — because an undetectable viral load is not transmissible and flattening that into a red dot is both wrong and cruel. Sharing is a live handshake: you read out a six-character code, they type it, you see a preview of exactly what approving would show, and a yes opens it for 24 hours. Denials are silent, since a refusal that announces itself is a disclosure of its own, and rotating your code cuts everyone off at once. The report files are never shared — they carry a legal name and a date of birth — and no result page is without the two things it cannot prove: that the document is authentic, and that anything has happened since the sample was taken.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Add STD Safe, and wire the hub up for a real deployment** — STD Safe verifies a lab document, tracks per-infection status, and answers another person's request for a result via an approve-a-request grant. The store enforces every rule server-side rather than …

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/std-safe` — owner's sign-in
- `src/app/api/std-safe/`
- `src/components/stdsafe/`
- `src/lib/stdsafe/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/std-safe/auth` | owner's sign-in |
| GET POST | `/api/std-safe/me` | owner's sign-in |
| POST | `/api/std-safe/parse` | owner's sign-in |
| POST DELETE | `/api/std-safe/records` | owner's sign-in |
| GET | `/api/std-safe/report` | owner's sign-in |
| POST PATCH DELETE | `/api/std-safe/requests` | owner's sign-in |
| GET | `/api/std-safe/view` | owner's sign-in |

### Data & database rules

- Server docs (server_docs via readDoc/writeDoc) — `src/lib/stdsafe/store.ts`

### Keys & outside services

- `AI_MODEL` — `src/lib/stdsafe/ai.ts`
- `AI_VISION_MODEL` — `src/lib/stdsafe/ai.ts`
- `STDSAFE_DATA_DIR` — `src/lib/stdsafe/dataDir.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/lib/stdsafe/ai.ts`

### Tests

- _None yet._
<!-- code:end -->

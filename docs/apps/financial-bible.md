# Financial Bible

Route: `/apps/financial-bible` · Category: Utilities · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- financial-bible "what to change"`.

## What it does

Several rooms behind one front door, and the first of them answers the question that kills most ideas: not whether it is a good one, but what you actually DO on Saturday morning. Every idea you have had is a card, and the card holds a build plan — phases, numbered steps, a cost range on each one, the materials with quantities, who sells them near you, how long it takes and how you know a step came out right. Then you argue with it. Ask for it cheaper, swap pine for oak, ask whether a step even needs a permit where you live, and the answer comes back with the EDIT attached: these four steps change, the total drops, accept or discard. Accept and it becomes v2 with v1 still readable, because 'cheaper' and 'the good version' both have to survive. Press Price this for real and a web-reading model goes and finds actual shops with actual addresses and prices, and every line it checked starts saying VERIFIED with the page it came from; everything it could not find keeps saying ESTIMATE, because that is the honest answer. What it will not do is the thing every business-plan tool does: it never mentions an LLC, insurance, branding or marketing. Those are nine buttons at the foot of the plan that generate nothing until you press one. And anything legal — permits, resale certificates, selling food — comes back as a question with somebody to ask, never as an answer, because no app knows the rules where you live. The Funding room is a loan broker's desk reference built from the owner's 6 Figure Funder course: type in a client's report numbers and one sheet says whether they're fundable, roughly how much (2–3x their personal available credit) and which of ~90 lenders fit, soft pulls first; every lender's bureau, minimums, velocity rules and tips sit in a filterable table beside cheat sheets, plays, mistakes, call scripts and an index of all 226 lessons. Deal Scout and Money Plays say what they will hold and admit they are not built yet.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **The sheet, the gate, and four rooms** — Design driven by interactive-web-studio. Warm paper raised on a graphite chassis, one accent hue per room as ambient light, tabular numerals, no WebGL — every figure on this sheet is money about to b…
- **Money Plays room shows every money agent's views and earnings**
- **Mark progress complete**
- **Funding room — qualifier, lender table, cheat sheets, plays, mistakes, scripts, lesson index**
- **Funding knowledge base (lenders, playbook, lessons), qualifier, search, Timeline filing**
- **All 4 courses read**
- **Corporate Credit Secrets complete**
- **Funding Secrets Bundle complete**
- **Master go-to list + banker questions**
- **6FF Mastery complete**
- **6FF Mastery through L106**
- **Course notes in progress (6FF Mastery L1-43)**
- **The logic, before a single component** — Seven modules and 70 tests, because the trust in this app lives here rather than in the UI. Totals that are a function of the steps and so cannot disagree with them. A patch engine that drops an op n…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/financial-bible` — owner's sign-in
- `src/app/api/bible/`
- `src/components/bible/`
- `src/lib/bible/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/bible/chat` | owner's sign-in |
| POST | `/api/bible/extra` | owner's sign-in |
| POST | `/api/bible/plan` | owner's sign-in |
| POST | `/api/bible/verify` | owner's sign-in |

### Data & database rules

- Saved data `bible:v1` — `src/lib/bible/store.ts`

### Keys & outside services

- `AI_MODEL` — `src/app/api/bible/chat/route.ts`, `src/app/api/bible/extra/route.ts` +1 more
- `BIBLE_VERIFY_MODEL` — `src/app/api/bible/verify/route.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/bible/chat/route.ts`, `src/app/api/bible/extra/route.ts`, `src/app/api/bible/plan/route.ts` +1 more

### Tests

- `src/lib/bible/clean.test.ts`
- `src/lib/bible/funding/qualify.test.ts`
- `src/lib/bible/ops.test.ts`
- `src/lib/bible/prompts.test.ts`
- `src/lib/bible/rooms.test.ts`
- `src/lib/bible/store.test.ts`
- `src/lib/bible/totals.test.ts`
- `src/lib/bible/verify.test.ts`
<!-- code:end -->

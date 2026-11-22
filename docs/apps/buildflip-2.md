# BuildFlip 2

Route: `/apps/buildflip-2` · Category: Apps · Live

Record reviewed: 2026-11-22

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- buildflip-2 "what to change"`.

## What it does

Paste the link to a build you saw — TikTok, Instagram, Pinterest — or just say what you want to make, and about fifty seconds later you have the plan and the money. The plan is real: finished dimensions you can drag, a numbered build with the tools and minutes each step takes, a cut list, and the safety notes that belong to THIS build rather than a generic list. The money is the part flippers get wrong: every board, screw, tube of glue and sheet of sandpaper priced at a current listing with a buy link and a running total, and a resale band built only from COMPLETED sales — asking prices are shown beside them and never counted. Out of that comes one number, your real hourly rate, and a build-or-skip call that says which two figures decided it. Tap any number and it tells you the page it came from, the day it was checked and how sure it is; anything from the bundled demo catalog says so wherever it appears. Size the build up and the quantities re-count themselves. At the store the list regroups by aisle with tap targets you can hit in gloves, and logging what you actually paid puts your receipts next to the estimate — after three finished builds of a type, the estimates correct themselves. Rank your ideas by profit per hour, put two head to head, and send any plan out on a read-only link that keeps your receipts to yourself.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Prices and comps come from the hub's search service, not the model** (2026-11-22) — the PRICE
  and COMPS passes used to hand OpenRouter's web plugin a result count and let the model search
  mid-generation. Now `src/lib/buildflip-2/ai/web-context.ts` searches first through
  `@/lib/search/client` (`research` with the pages read: one search per material, capped at 16 and
  four at a time; two sold-listing queries for comps), and the model reads prices and sales off
  those pages. Every citable URL therefore came out of a search response, and `allowedUrl` throws
  away any link the model did not get from one — a buy link on a plan resolves or is not shown. A
  search that finds nothing prices from market knowledge, labels every row low-confidence with no
  link, and says so on the plan; it does not drop to the demo catalog, because the spec is real.
- **Moved into the hub as /apps/buildflip-2** — Brought over from legacymiles/buildflip-2-2 and the live v1: its route, UI, logic and API land in the hub's own folders, its AI goes through the shared provider, and its fonts come from the faces alr…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

- **Every material priced, with a buy link that resolves.** A price with a dead or invented link is
  worse than no link: the link is how a user checks the number. Links are only ever ones the search
  service returned.
- **The resale band is built from COMPLETED sales only.** Asking prices are shown beside them and
  never counted. This is the whole claim of the app.
- **An empty comps search never wipes comps already on a plan.** A search that finds nothing is not
  evidence the market vanished.
- **The demo catalog still catches a missing key.** No AI key, or a failed spec pass, prices from the
  bundled catalog and labels every number as demo wherever it appears.
- **A dead search service degrades, never throws.** The plan still arrives, with its prices marked
  as estimates and the reason printed on it.

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/buildflip-2` — owner's sign-in
- Page `/apps/buildflip-2/admin` — owner's sign-in
- Page `/apps/buildflip-2/board` — owner's sign-in
- Page `/apps/buildflip-2/compare` — owner's sign-in
- Page `/apps/buildflip-2/legal/privacy` — owner's sign-in
- Page `/apps/buildflip-2/legal/refunds` — owner's sign-in
- Page `/apps/buildflip-2/legal/terms` — owner's sign-in
- Page `/apps/buildflip-2/plan/[id]` — owner's sign-in
- Page `/apps/buildflip-2/pricing` — owner's sign-in
- Page `/apps/buildflip-2/settings` — owner's sign-in
- Page `/apps/buildflip-2/share/[token]` — owner's sign-in
- Page `/apps/buildflip-2/upgraded` — owner's sign-in
- `src/app/api/buildflip-2/`
- `src/components/buildflip-2/`
- `src/lib/buildflip-2/`

### Sign-in & who can use it

- Needs a signed-in user (requireUser / auth.getUser) — `src/app/api/buildflip-2/account/delete/route.ts`, `src/app/api/buildflip-2/account/route.ts`, `src/app/api/buildflip-2/billing/checkout/route.ts` +16 more
- Owner-only check (requireOwner / isOwner) — `src/app/api/buildflip-2/admin/stats/route.ts`, `src/lib/buildflip-2/api.ts`

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET PATCH | `/api/buildflip-2/account` | owner's sign-in |
| DELETE | `/api/buildflip-2/account/delete` | owner's sign-in |
| GET | `/api/buildflip-2/admin/stats` | owner's sign-in |
| POST | `/api/buildflip-2/billing/checkout` | owner's sign-in |
| POST | `/api/buildflip-2/billing/portal` | owner's sign-in |
| POST | `/api/buildflip-2/billing/webhook` | owner's sign-in |
| GET | `/api/buildflip-2/capabilities` | owner's sign-in |
| POST | `/api/buildflip-2/leads` | owner's sign-in |
| GET | `/api/buildflip-2/plan` | owner's sign-in |
| GET PATCH DELETE | `/api/buildflip-2/plan/[id]` | owner's sign-in |
| POST DELETE | `/api/buildflip-2/plan/[id]/receipts` | owner's sign-in |
| POST | `/api/buildflip-2/plan/[id]/reprice` | owner's sign-in |
| POST DELETE | `/api/buildflip-2/plan/[id]/share` | owner's sign-in |
| POST | `/api/buildflip-2/plan/generate` | owner's sign-in |
| POST | `/api/buildflip-2/upload` | owner's sign-in |

### Data & database rules

- Table `app_state` (public.app_state) · RLS on — used in `src/lib/buildflip-2/db/store.ts`, `src/lib/buildflip-2/rate-limit.ts`
  - policy public.app_state · app_state_all — for all using (user_id = auth.uid()) with check (user_id = auth.uid())
- Saved data `buildflip-2:prefs:v1` — `src/components/buildflip-2/Providers.tsx`

### Keys & outside services

- AI calls through `src/lib/ai/provider.ts` — `src/lib/buildflip-2/ai/chat.ts`

### Tests

- `src/lib/buildflip-2/ai/web-context.test.ts`
- `src/lib/buildflip-2/calc.test.ts`
- `src/lib/buildflip-2/security.test.ts`
<!-- code:end -->

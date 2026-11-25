# Find My Life

Route: `/apps/find-my-life` · Category: AI · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- find-my-life "what to change"`.

## What it does

Your phone, laptop, Meta glasses, car, keys and wallet in one place, on a live radar with you in the middle. Every thing sits at its real direction and distance (or on a dark street map), with a dense list of how fresh each location is, battery and how far away. Apple's Find My and Google's Find Hub have no API, so each thing gets the best source that really works, picked automatically: devices report themselves while Jarvis is open on them (and ring on command), an iPhone Shortcut checks in in the background, cars connect through Smartcar for live location, fuel and locks, Bluetooth things (glasses, earbuds, the car) get a last-seen pin the moment they disconnect from your phone, tagged things open their AirTag/Tile/SmartTag app and show a pasted Share Item Location link, and anything can be pinned by hand. Compass mode turns the radar with your phone so blips point at the real things around you. Also a widget on the Jarvis Dashboard and a step in onboarding.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Every device and thing you own on one live radar** — New Jarvis app plugin + Dashboard widget + onboarding "Find" step. Phone, laptop, Meta glasses, car, keys, wallet and more on a Life Radar (true bearing, log distance, sweep-synced blips, Compass mod…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/find-my-life` — owner's sign-in
- `src/app/api/find-my-life/`
- `src/components/find-my-life/`
- `src/lib/find-my-life/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET POST | `/api/find-my-life` | owner's sign-in |
| GET | `/api/find-my-life/car/callback` | owner's sign-in |
| GET | `/api/find-my-life/car/connect` | owner's sign-in |
| GET POST | `/api/find-my-life/ping` | per-account key (no session) |

### Data & database rules

- Server docs (server_docs via readDoc/writeDoc) — `src/lib/find-my-life/server/store.ts`

### Keys & outside services

- `SMARTCAR_APPLICATION_ID` — `src/lib/find-my-life/server/smartcar.ts`
- `SMARTCAR_CLIENT_ID` — `src/lib/find-my-life/server/smartcar.ts`
- `SMARTCAR_CLIENT_SECRET` — `src/lib/find-my-life/server/smartcar.ts`
- `SMARTCAR_MODE` — `src/lib/find-my-life/server/smartcar.ts`

### Tests

- `src/lib/find-my-life/engine.test.ts`
<!-- code:end -->

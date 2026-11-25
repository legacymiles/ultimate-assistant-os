# Dump Finder

Route: `/apps/dump-finder` · Category: Utilities · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- dump-finder "what to change"`.

## What it does

A map for whoever is standing next to a loaded truck. It finds the phone, draws a ring of the radius you pick, from 1 to 50 miles, and pins every asphalt plant and paving yard (where the millings go), concrete and rubble yard, landfill, transfer station, recycling center and scrap yard inside it, nearest first. Filter chips narrow it to the load on the truck, and each pin carries a letter as well as a colour so it still reads in sunlight. Open a site for its phone, hours, what it says it takes and a Directions link, plus a notes box for what no map knows: whether they are taking millings this week, the price a ton, the gate hours. Sites come live from OpenStreetMap with no key, a satellite view shows whether a plant has a pile and a way in for a tri-axle, and any spot nobody has mapped can be dropped on the map and follows you to every device. No location? Type a ZIP or a job-site address instead.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Asphalt millings, landfills and recycling on a map (#1)** — New app at /apps/dump-finder, offered as a Jarvis App plugin. It finds the device, draws the chosen radius (1-50 mi) and pins every asphalt plant / paving yard, concrete and rubble yard, landfill, tr…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/dump-finder` — owner's sign-in
- `src/app/api/dump-finder/`
- `src/components/dump-finder/`
- `src/lib/dump-finder/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET | `/api/dump-finder/geocode` | owner's sign-in |
| GET | `/api/dump-finder/sites` | owner's sign-in |

### Data & database rules

- Saved data `dump-finder:v1` — `src/lib/dump-finder/store.ts`

### Keys & outside services

- _None._

### Tests

- `src/lib/dump-finder/sites.test.ts`
<!-- code:end -->

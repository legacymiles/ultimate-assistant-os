# God's Eye View

Route: `/apps/gods-eye-view` · Category: Apps · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- gods-eye-view "what to change"`.

## What it does

A spy-satellite simulator in the browser, where the data turns out to be real. A CesiumJS globe behind a keyhole scope and a tactical HUD: coordinates, altitude, estimated GSD and NIIRS, sun elevation, a REC clock. Toggle live layers from public, keyless sources: every aircraft OpenSky can see (adsb.lol around you when OpenSky is throttled), military traffic from adsb.lol, thousands of satellites propagated in the browser with SGP4 from CelesTrak, the last day of USGS earthquakes, ~25,000 live public traffic cameras (click one to enlarge it, hop to the next, or let it auto-hop), space missions from the Launch Library, datacenters, dams, and with free keys NASA FIRMS fires, AIS ships and TomTom street traffic, plus the world's submarine cables. Ride any aircraft in COCKPIT first person. Aircraft glide between updates by dead reckoning. Click anything to lock on: a detection box, a telemetry card, a trail, and a camera that follows it, orbit ring included for satellites. Re-skin the whole planet through the original's GLSL sensor looks: CRT, NVG, FLIR (Ironbow or white-hot), Anime, Noir and Snow, on keys 1-7. Drive it by typing or holding Space to talk: "fly to Tokyo", "thermal", "turn on satellites", "track the ISS", "reset globe". Views share as links. Esri imagery works with no keys; paste a Cesium ion token or Google Maps key in POWER UP for photorealistic 3D cities. A port of bilawalsidhu/gods-eye-view (MIT).

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **A spy-satellite globe over real, live data** — A port of bilawalsidhu/gods-eye-view (MIT) as a hub app. CesiumJS globe behind a keyhole scope and a tactical HUD, with keyless live layers — OpenSky and adsb.lol aircraft, CelesTrak satellites propa…
- **Say STILL when it's a still, and make live video easy to find** — Every camera card said "LIVE", including the ones that are a still picture the agency republishes once a minute — so a working feed looked broken.
- **Poll CCTV stills every second, and only swap real new frames** — Stills refreshed every 4 s (30 s before that), which felt frozen.
- **Live video for CCTV cameras that stream, fast stills for the rest** — The camera card refreshed its still every 30 seconds, so feeds felt frozen.
- **Cockpit, voice agent, radio scanner and the walkthrough's missing features** — Built against the original's walkthrough video:
- **Load CCTV per network to fit Vercel's response limit** — All ~24,000 cameras in one /api/gods-eye/cameras response was ~5 MB, past Vercel's 4.5 MB function response cap, so production returned an error and the layer stayed empty. Windy webcams were chained…
- **CCTV cameras worldwide, not just London** — The CCTV layer only drew TfL's JamCams, so flying anywhere else showed nothing. It now aggregates ~24,000 official, keyless traffic cameras from 23 open-data networks: TfL, fifteen 511 DOT sites (FL,…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/gods-eye-view` — owner's sign-in
- `src/app/api/gods-eye/`
- `src/components/gods-eye/`
- `src/lib/gods-eye/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET | `/api/gods-eye/[feed]` | owner's sign-in |
| POST | `/api/gods-eye/agent` | owner's sign-in |
| GET | `/api/gods-eye/traffic/[z]/[x]/[y]` | owner's sign-in |

### Data & database rules

- _No database, storage or saved data of its own._

### Keys & outside services

- `NEXT_PUBLIC_CESIUM_ION_TOKEN` — `src/components/gods-eye/GodsEyeView.tsx`
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` — `src/components/gods-eye/GodsEyeView.tsx`
- `TOMTOM_API_KEY` — `src/app/api/gods-eye/traffic/[z]/[x]/[y]/route.ts`
- `WINDY_WEBCAMS_API_KEY` — `src/lib/gods-eye/cameras.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/lib/gods-eye/agent.ts`

### Tests

- `src/lib/gods-eye/commands.test.ts`
- `src/lib/gods-eye/geo.test.ts`
<!-- code:end -->

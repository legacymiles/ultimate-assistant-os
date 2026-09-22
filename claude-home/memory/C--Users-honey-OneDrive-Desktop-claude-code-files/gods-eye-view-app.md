---
name: gods-eye-view-app
description: "God's Eye View at /apps/gods-eye-view — CesiumJS spy-satellite globe port of bilawalsidhu/gods-eye-view (MIT); keyless live layers, GLSL sensor styles, local voice/typed commands; CDN Cesium + satellite.js v6 gotchas"
metadata: 
  node_type: memory
  type: project
  originSessionId: a2283046-f5be-4b5d-bf24-42652f5cb53f
  modified: 2026-09-15T02:17:02.230Z
---

Native hub port (2026-09-14) of github.com/bilawalsidhu/gods-eye-view, built from the repo + its YouTube demo
(watched with [[video-analyzer-skill]]). Registered in `src/lib/catalog.ts`; code in `src/lib/gods-eye/`
(globe.ts engine, shaders.ts, feeds.ts, commands.ts, geo.ts + tests) and `src/components/gods-eye/`.

- **Cesium loads from jsDelivr (pinned 1.145.0), not bundled.** `cesium` is a devDependency for types only.
  Bundling would slow every hub compile and route worker/asset files through the Supabase middleware.
- **satellite.js must stay on v6.** v7's index pulls a WASM build importing `node:module`/`node:worker_threads`,
  which webpack can't bundle for the browser. After swapping versions the dev server must be restarted
  (it caches the old `dist/index.js` path → ENOENT).
- **Feeds are keyless, via `/api/gods-eye/[feed]`** with in-memory TTL + serve-stale: OpenSky states/all (90 s,
  anonymous credit budget) falling back to adsb.lol 250 nm around the camera, adsb.lol /v2/mil, CelesTrak
  active TLEs (3 h), USGS 2.5_day, submarinecablemap cable-geo (NC licence).
- The original's OpenAI Realtime voice agent was replaced by a local regex parser (typed or Web Speech API) —
  no key/cost. Google 3D / ion keys are pasted in POWER UP (localStorage) or `NEXT_PUBLIC_GOOGLE_MAPS_KEY` /
  `NEXT_PUBLIC_CESIUM_ION_TOKEN`; neither is set yet.
- **CelesTrak 403s a repeat download** of the same GROUP within its 2-hour update window (body: "GP data has not
  updated since your last successful download"). feeds.ts keeps the last set in `os.tmpdir()/gods-eye-view/`
  and falls back to stitching smaller groups (stations, visual, starlink…) — never loop-retry `active`.
- **Tracking does not use Cesium `trackedEntity`** (it waits on a bounding sphere a 1px point never reports, so
  the camera never moved). The camera is `lookAtTransform`-anchored in the target's ENU frame and re-anchored
  every tick; `untrack()` must reset to `Matrix4.IDENTITY` before any flyTo.
- **Verification gotcha:** when the Browser pane is hidden, rAF is throttled and Cesium renders ~10 frames, so
  the globe looks black. Force frames with `window.__gev.viewer.render()` in a loop (`__gev` is a dev-only handle).
- **CCTV is worldwide since 2026-09-16** (user complained it only showed London). `src/lib/gods-eye/cameras.ts`
  aggregates ~24k keyless official traffic cams from 23 networks: TfL, 15 "511" sites (FL, GA, NY, UT, PA, ON, AZ, NV,
  WI, ID, New England, CT, AB, LA, AK) via their shared `/List/GetData/Cameras?query=` endpoint (100 rows/page max),
  NYC DOT, Caltrans d1-12, DriveBC, Digitraffic FI, NZTA, HK TD, LTA SG. Per-network cache 6 h + tmpdir disk copy;
  **Vercel caps function responses at 4.5 MB**: the all-in-one 5 MB list failed in prod, so `cameras` is an index
  and the browser fetches `cameras?net=<id>` per network (largest FL ~930 KB, ≤15 s cold). Rest of world via `WINDY_WEBCAMS_API_KEY` (set in .env.local 2026-09-16, verified:
  Paris/Tokyo/Sydney ~200 each). `webcams` feed pages 4×50 (Windy caps limit at 50, offset works) around the view on
  moveEnd, 1° cell cache 8 min; Windy image URLs are plain `?v=2`, no token. Key must also be added in Vercel for prod. Never add insecam-style unsecured private cameras.
- **Walkthrough parity pass (2026-09-17)** from the original's YouTube guide (o_FJ1NIH9yw): enlarged CCTV viewer
  (red X, Esc), CCTV PREV/NEXT/AUTO HOP + hover preview, CONTEXT card (CONTACTS 250 km list, SPACE MISSIONS),
  COCKPIT first person (engine `enterCockpit`: camera setView each tick at the dead-reckoned aircraft, smoothed
  heading/pitch/roll, offset bleeds off feed snaps; inputs disabled, fov 75°), CELESTIAL, SCENES (localStorage shots,
  START/EXPORT/IMPORT), CHOOSE YOUR FIRST VIEW modal, and layers launches (Launch Library, keyless, 15 req/h → 1 h
  cache), datacenters + dams (static `public/gods-eye/*.json` from `scripts/gods-eye-snapshot.mjs` — Overpass/Wikidata
  take 30-90 s, too slow for Vercel), and key-gated fires (NASA_FIRMS_MAP_KEY), vessels (AISSTREAM_API_KEY, server
  listens to the websocket ~7 s per 1° cell), street traffic (TOMTOM_API_KEY via tile proxy route). Not built:
  incident reconstruction, TR-3B easter egg.
- **Voice agent + radio (2026-09-17, deployed 58aded3):** `/api/gods-eye/agent` runs a tool-calling loop via
  `aiEndpoint()` (STD=claude-sonnet-5, MINI=claude-haiku-4.5, `reasoning.effort=low` halves latency to ~5-7 s);
  server tools geocode (Photon), reverse-geocode, route (routing.openstreetmap.de OSRM); client applies returned
  actions (waits ~3.3 s after a fly before orbit/cockpit). Browser Web Speech in, speechSynthesis out. Radio:
  `radio` feed = WXRadio.org icecast mounts (callsign = last dash segment) joined to NWS `CCL.js` transmitter
  arrays + Radio Browser; https only. RadioDeck uses two <audio> elements (CORS one feeds the analyser meter).
  3D aircraft use Cesium_Air.glb from jsDelivr gh (heading = track − 90°). Dev HMR edits blank the HUD — reload.
- **The user checks the LIVE site, not localhost.** "It still doesn't have X" usually means not deployed yet.
- **CCTV freshness is the agency's, not ours (measured 2026-09-17):** NYC DOT republishes a still every ~3.4 s,
  Hong Kong ~10 s, 511GA/Caltrans/TfL/511WI every 1-2 min. Stills are polled every 1 s; where the host sends a
  valid CORS header the poll is conditional (ETag/Last-Modified/length) so only real new frames decode — the 511
  sites send a DUPLICATED `Access-Control-Allow-Origin` header, which browsers reject, so they use plain <img>.
  ~5,000 cameras (Caltrans, NYSDOT, NV, WI, LA) have open CORS-enabled HLS and play as real video via hls.js
  (prefer hls.js over `canPlayType` — some Chromium builds claim native HLS and then fail). Background/hidden
  tabs pause video and throttle timers, which is why a hidden preview pane looks frozen.

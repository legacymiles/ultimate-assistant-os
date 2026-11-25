# Realtime Lucy

Route: `/apps/realtime-lucy` · Category: Video · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- realtime-lucy "what to change"`.

## What it does

A live video-to-video stream driven by LingBot-World 2.0's causal-fast world model, running on your own GPU. The webcam goes out over WebRTC; on the PC the model's inference loop is turned inside out so it never stops: every quarter second of camera video is VAE-encoded, noised into the distilled four-step schedule, denoised against a rolling KV-cache memory of what the model already generated, written into that memory, and decoded straight back into the return video track. Type a prompt to change the look mid-stream, choose how much of the camera to keep, and hold WASD or the arrow keys to drive the model's own camera-control conditioning. A live panel shows real numbers — generated fps, glass-to-glass latency, per-stage timings and VRAM — because the whole point is that it is real model inference, not a filter.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Live webcam into LingBot-World-V2** — The page streams the webcam to the GPU server in tools/realtime-lucy, which runs LingBot-World-V2's causal-fast path — SDEdit per chunk, KV cache and the streaming VAE kept — and streams frames back.…
- **Name the bridge that is running but too old to start the engine** — A bridge from before the /lucy routes answers /health and 404s the rest, and "start it" is the wrong fix there — the old copy holds the port, so a second one exits. The page now says which of the two…
- **One button that starts the engine, not a command to copy** — The page was only ever the WebRTC client, so with nothing running on the GPU it showed the webcam and told you to go and run a script — which reads as "the prompt does nothing". Start Lucy now asks t…
- **Masked cond_mode, plus the fixes that made it runnable** — The reported bug was "I see myself but the prompt does nothing". Root cause was that no GPU server was running at all -- the page is only a WebRTC client, so with the server down the local camera pre…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/realtime-lucy` — owner's sign-in
- `src/app/api/realtime-lucy/`
- `src/components/realtime-lucy/`
- `src/lib/realtime-lucy/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET POST | `/api/realtime-lucy/[...path]` | owner's sign-in |

### Data & database rules

- _No database, storage or saved data of its own._

### Keys & outside services

- `LUCY_SERVER_URL` — `src/app/api/realtime-lucy/[...path]/route.ts`
- `LUCY_TOKEN` — `src/app/api/realtime-lucy/[...path]/route.ts`

### Tests

- _None yet._
<!-- code:end -->

# Realtime Agent

Route: `/apps/realtime-agent` · Category: AI · Live

Record reviewed: 2026-11-25

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- realtime-agent "what to change"`.

## What it does

One switchboard for the owner's three talking agents, so they are picked from a single screen
instead of three different places. Two are free and one is a rented GPU that bills by the hour,
and the whole screen is arranged around that asymmetry: the paid one is the only thing behind a
gate, and once it is running the money is the loudest thing on the page.

| Agent | What it is | Cost |
|---|---|---|
| 3D agent | new-jarvis's Three.js face (`AvatarScene`, `variant="hero"`) | free, always there |
| Local agent | LiveTalking on the owner's PC, `127.0.0.1:8010`, wav2lip256 at ~25 fps on the 3050 | free |
| RunPod agent | the same LiveTalking with the MuseTalk backend on a rented RunPod GPU | **billed hourly** |

Both photoreal faces are reached over WebRTC through the existing `LiveTalking` client in
`src/lib/ai-live-studio/livetalking.ts` — the one AI Live Studio already uses — pointed at either
localhost or the pod's reported address. Nothing about an agent is re-implemented here; this app
is the switch, the gate and the meter.

The pod image this app starts is built in the LiveTalking checkout, at
`C:\dev\livetalking\deploy\runpod` (Dockerfile, entrypoint, model fetcher and deploy notes).

## Features

- **The picker** — all three agents always visible, each with its real state as a dot **and** a
  word (`ready` · `not running` · `starting` · `running — billing` · `not set up`), never a colour
  alone. Each card also says what it needs before it can answer, so none is ever silently broken.
  The billed card shows its hourly rate on its face, before it is ever selected.
- **The confirm gate** (the point of the app) — choosing the RunPod agent opens a modal that
  quotes RunPod's own reported rate, what an hour would cost, and what the idle auto-stop caps the
  damage at. It says out loud that billing starts when the pod starts, not when you talk to it.
  Nothing is called until "Start it and bill me". If RunPod has not reported a rate, the dialog
  says so rather than showing a confident `$0.00`.
- **The meter** (`data-standout`) — exists only while the pod is actually billing, and while it
  exists it owns the page: dollars spent this session at 28px in JetBrains Mono with tabular
  figures, elapsed time, the rate, and a countdown to the idle stop. It **stays visible after
  switching back to a free agent**, because a pod you forgot about is exactly how this gets
  expensive.
- **Stop** — red, in the meter, never behind a menu, one press. On success it also drops the
  selection back to the 3D agent so the stage is not left pointing at a dead pod.
- **Idle auto-stop** — 5 / 15 / 30 / 60 minutes quiet, default 15, chosen in the gate. The browser
  sends a keepalive every 60s while the tab is visible; the **server** re-checks the idle window on
  every status poll and stops the pod itself, so a closed tab cannot leave a GPU running. "Never"
  is deliberately not an option.
- **Nothing destructive is reachable** — RunPod's stop (`POST /pods/{id}/action {"action":"stop"}`)
  frees the GPU and keeps the `/workspace` volume; terminate (`DELETE /pods/{id}`) destroys the
  volume and with it the MuseTalk weights and the avatar. They are one word apart in the API, so
  `src/lib/realtime-agent/pod.ts` exports no terminate, delete or destroy at all, and a test
  asserts the module surface never grows one.
- **Owner-only, fail-closed** — the app and its route are not in any PUBLIC list, so `routeAccess`
  defaults them to `"owner"` and the middleware answers 401/403 before the handler runs. This
  matters more than usual: the endpoint can spend the owner's money.
- **The 3D stage survives a resize** — React Three Fiber measures its container once, at mount, and
  never re-measures; a resize after load (rotating a phone, or any width change) otherwise leaves a
  blank canvas until an unrelated reflow. So the canvas mounts two frames late, its box is a fixed
  300px at **every** breakpoint rather than a percentage, and a `ResizeObserver` remounts it on a
  real size change. Do not "simplify" any of those three back: each one on its own reproduces a
  blank stage. Verified at 1440px and 390px, and across a live resize between them.
- **Demo mode** — with no `RUNPOD_API_KEY` / `RUNPOD_POD_ID` the RunPod card reads "not set up" and
  the stage names the exact variables to set and where the deploy files are (R4). The other two
  agents are unaffected.

## Must keep working

- Opening the app with no keys set shows three cards and never a blank panel or a crash.
- Selecting the RunPod agent **always** opens the confirm gate first, and dismissing it starts
  nothing and bills nothing.
- While the pod bills, the meter is visible on every agent — not just the RunPod one.
- Stop is reachable in one press whenever the pod is billing.
- `pod.ts` exports no terminate/delete/destroy (`pod.test.ts` asserts this).
- A failed RunPod call explains itself in plain English — rejected key, unknown pod id, no free
  GPU on the host, unreachable — and never echoes the API key.
- The money figures never render `NaN` or a bare `$0.00` for real spend (`cost.test.ts`).

## Requested

- Nothing outstanding. Asked for on 2026-11-25 as "all my agents in 1 place … it has to confirm to
  start the runpod agent because it charges me".

## Known limits, honestly

- **The idle auto-stop needs something to ask it.** The server checks on each status poll, so it
  fires from any later visit or any open tab — but if the laptop is shut with no tab anywhere, the
  pod keeps running until something polls again. The gate says this in plain words, and RunPod's
  own console remains the backstop.
- **`lastActivityAt` is module scope**, so it does not survive a serverless cold start. A cold
  start loses the clock, not the pod: the next poll re-arms it. The guarantee is the visible meter
  and the one-press Stop, not the timer.
- **No proxy-URL guessing.** RunPod does not document a format for its HTTP proxy hostname, so
  `podEndpoint` uses only the `runtime.ports` ip:port RunPod actually reports and answers null
  otherwise. A guessed hostname would fail mid-conversation with the pod already costing money.
- **Not yet verified against a live pod.** Every RunPod path, field and action here is from the
  REST API v2 spec and `docs.runpod.io/pods/manage-pods`, and the error paths are unit-tested
  against a fake fetch, but no real pod has been started from this app.

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/realtime-agent` — owner's sign-in
- `src/app/api/realtime-agent/`
- `src/components/realtime-agent/`
- `src/lib/realtime-agent/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET POST | `/api/realtime-agent/pod` | owner's sign-in |

### Data & database rules

- _No database, storage or saved data of its own._

### Keys & outside services

- `RUNPOD_API_KEY` — `src/lib/realtime-agent/pod.ts`
- `RUNPOD_POD_ID` — `src/lib/realtime-agent/pod.ts`

### Tests

- `src/lib/realtime-agent/agents.test.ts`
- `src/lib/realtime-agent/cost.test.ts`
- `src/lib/realtime-agent/pod.test.ts`
<!-- code:end -->

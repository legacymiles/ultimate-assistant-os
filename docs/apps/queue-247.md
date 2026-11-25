# 24/7 Queue

Route: `/apps/queue-247` · Category: AI · Live

Record reviewed: 2026-11-25

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- queue-247 "what to change"`.

## What it does

The command center for every ongoing, scheduled and autonomous AI task in the hub — the upgrade
of In Queue. The owner tells Jarvis what they want in plain words; Jarvis works out which app it is
about, which agent should do it, whether it is a one-off, a scheduled job, a recurring task or a
standing 24/7 workflow, splits big requests into parts that wait for each other, and files real
tasks. A worker on the VPS runs them with the PC off and the browser closed, and the board shows
what is actually happening — every status, progress bar, log line and result comes from a worker
that did the work.

## Features

- **Persistent task engine** — every task, run, log line, finding, message and notification is a
  Postgres row (`queue_*` tables). Tasks survive refreshes, closed browsers, server restarts and
  network drops.
- **VPS worker** (`tools/queue-worker`, Docker, `restart: always`) — claims due tasks with
  `queue_claim` (FOR UPDATE SKIP LOCKED: no task ever runs twice), runs one bounded step at a time
  under a renewed lease, saves state between steps, retries with exponential backoff, recovers a
  crashed worker's task when its lease expires, hands tasks back on shutdown, heartbeats its
  load/memory/running tasks. Concurrency per worker and per executor, memory ceiling, capabilities
  (a task only goes to a worker that can run it). Any number of workers.
- **Kinds** — once, scheduled (at a time), recurring (every N minutes / daily at HH:MM in a zone),
  continuous (a standing workflow that resumes from its own saved state every round and survives a
  bad round).
- **Sub-tasks and dependencies** — a multi-part request becomes parts plus a parent that waits for
  them and writes one report.
- **Jarvis commander** — `/api/queue247/command`: one AI call plans tasks or acts on existing ones
  (pause, resume, stop, reschedule, answer), refuses duplicates of running work, uses past results
  and findings as memory. With no AI available an offline planner takes the words literally and
  says so. Also the Jarvis chat tool `queue_command` and connector tools `task_list` / `task_get` /
  `task_command` for Claude Code.
- **The stage — Jarvis's chat as the front of the page** (mockup 3 "Chat is the stage", picked
  2026-11-25; taste-skill Cold Luxury: smoke + silver, one emerald accent, Geist). A WebGL trail
  reveal (`QueueStage.tsx`, webgl-trail-reveal): calm smoked glass over the circuitry the agents
  run on; the pointer paints a trail that scans it in, labels for the real workers and 24/7
  workflows light up under the trail, and every new queue event pulses out of its node. Reduced
  motion / no WebGL: a still picture of both layers. On it, Jarvis's message box
  (`JarvisComposer.tsx`): reference pictures (attach, paste or drop, up to 6, shrunk in the
  browser, stored in `queue-247` under `refs/<uid>/`, shown to the planner and kept on every task
  the message files as `config.references`), the model router (Auto = the hub's router, one-tap
  Opus 5.5 / DeepSeek V4.1, or any OpenRouter model from the full list; cloud models only — the
  "my subscription" brains need the PC), "Start talking to Jarvis" (talk-to-type) and Send. The
  conversation under it shows your pictures, which model planned each reply, and a live card per
  task filed. Tasks are a timeline rail on the left, counts / last hour / workers / discoveries /
  live activity on the right (phone: chat, tasks, then the rest).
- **Talk about a task** — each task has its own conversation; words to a waiting task answer it,
  words to a busy one become guidance its executor reads next step.
- **Owner controls** — pause, resume, edit, prioritise, run now, restart, terminate (cascades to
  sub-tasks), approve / decline, answer, delete.
- **Agents (executors)**: research (web/news/GitHub, never reports the same source twice), MT4 bot
  discovery (continuous; public Telegram channel previews, GitHub, web; static MQ4/MQ5 analysis for
  martingale, grid, averaging, hedging, repainting, missing stops, DLL imports, web requests,
  account locks, time bombs, obfuscation; quality/reliability/risk/strategy scores with reasons;
  fingerprint de-duplication and version lineage; notifies on notable bots; never runs EA code,
  never trades), H3 recreation (upload or social link → ffmpeg shots and keyframes → H3 Lab's
  analysis → storyboard → per-shot H3 prompts with the owner's changes + variations), monitor
  (alerts only on change), code change (files a 24/7 agent for the PC harness and mirrors it),
  connected app (outside apps do the work and report back), rollup.
- **Connected apps** — every hub app is recognised from the catalog automatically; outside
  websites register in Apps, get a `q247_` key (hash stored) and use `/api/queue247/v1/*`
  (`docs/queue-247-api.md`): submit tasks, receive work at a callback, report progress, logs,
  findings, completion, questions.
- **Research library** — every finding searchable by kind, app, text and score.
- **Notifications** — notable discoveries, questions, approvals and failures.

## Must keep working

- A task filed on the board or from Jarvis chat appears at once and is claimed by the VPS worker
  within seconds when one is online; with no worker online the board says so instead of showing
  fake progress.
- Pausing or terminating a running task stops it within a minute (lease renew fails → step aborted).
- A worker restart never loses or duplicates a task.
- The MT4 agent never executes downloaded code and never connects to a trading account.
- Outside apps only ever see their own tasks.
- In Queue requests and 24/7 machine agents keep working in their own tabs.
- A message with pictures files its tasks with every picture in `config.references`, even when the
  AI planner is unavailable (the reply says nothing looked at them).
- The model picked in the chat is the model that plans (the reply names it); "/" focuses the box.

## Requested

- Isolated MT4 Strategy Tester backtests for discovered EAs (Windows VPS with MT4 terminal) —
  analysis is static only until then, and each finding says so.
- Web push for notable discoveries (in-app notifications today).

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/queue-247` — owner's sign-in

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

- _None._

### Data & database rules

- _No database, storage or saved data of its own._

### Keys & outside services

- _None._

### Tests

- _None yet._
<!-- code:end -->

# Website Studio

Route: `/apps/website-studio` · Category: Websites · Live

Record reviewed: 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- website-studio "what to change"`.

## What it does

One place for every website: describe what you want and it is built, paste an address and it is redesigned without losing a single thing the site does, or open one you have already shipped and change it with the client who owns it. Underneath it is one super harness — Felix, the prompt enhancer, two stages of mockups (the main design, then the supporting pages as a prototype you can actually walk), the design skills you picked, Impeccable and a security check — and the first working site goes LIVE before Software Factory deepens it, so there is something to open in minutes rather than at the end. Every website you have is in one library with its screenshot, and opening any of them lands in the same workspace: the site full-screen, the assistant folded beside it, and every build, file change and version in one panel.

## Features

**Starting a website — one slab, two modes.**
- **Build from a prompt** — describe the site; reference pictures and screen recordings can be
  attached (up to 6, dropped on the slab or picked). It becomes an App Builder project in the same
  synced store, so `?p=<id>` opens it here or in App Builder.
- **Redesign a website** — paste an address and a note about what should change. The live site is
  read (`/api/redesign/scrape`) and everything it does today becomes must-keep features.
- **Web design skills** — a dropdown built from the real design-skill roster, so a skill installed
  tomorrow appears tomorrow. One look at a time (bases replace each other), craft passes and
  centrepieces stack, Impeccable always closes, and anything that spends money is flagged opt-in.
  The picks reach the build brief as `<design_skills>`, in run order.

**My websites.** One library from three sources, each website shown exactly once: client sites and
hub apps (their Client Review documents, read where they already live) and builds that have not
shipped yet. Thumbnail from the newest screenshot or a mockup lane, search by name / client /
address, filters (All · Client sites · My apps · Needs you · Drafts) with live counts, ordered by
what is waiting on the owner, then what is building, then most recent; apps never opened sink to
the bottom.

**One workspace for every website.** Full-screen canvas with the assistant folded on the LEFT —
`Ctrl+\` or the fold button maximises the page, and the choice is remembered per device. Desktop
/ phone (390px) widths, reload, open in a new tab, and the address always on screen.
- On a live site: **Chat** (the client's requests and notices; the owner's Send is Send & build),
  **Build** (the pipeline rail and the harness narration), **Changes** (`harness/diff` — the files
  being changed, with the diff), **Versions** (the history, and Mark ready for the client).
- On a draft: **Chat**, **Features** (Felix's questions, then the feature table), **Pages**,
  **Build**. The panel follows the work — there is one thing to do at a time and it opens on it.

**Two stages of mockups.** Stage one is the three-direction bake-off, painted with Flux 2 on the
owner's PC (free and local). Stage two is new: the supporting pages as a prototype you can walk —
every screen drawn in the approved look, clickable links between them, loading / empty / success /
error states per screen, and Revise on any one screen without redrawing the others. A plan whose
links point nowhere, or that has a screen nothing can reach, cannot be approved.

**Ship first.** The approved routes go into the build brief as a specification, never as pictures.
The first working site goes live after a fast security check; the Studio then says the after-live
message into the same harness thread, which is what starts Software Factory and the deep security
scan. Sent once — the thread itself is the record, so a second device cannot send it again.

## Must keep working

- Every existing Client Review website opens with its own id and link secret unchanged. Nothing was
  copied or migrated.
- The client's own address `/apps/client-review?site=<token>` still opens their site — it now mounts
  this workspace. Their push notifications, their home-screen app and the service worker are all
  scoped to that address and must stay there. `?classic=1` opens the old screen.
- A hub app opened for the first time still gets its project made (`ensureApp`).
- Send & build still approves the waiting batch and starts the build on the PC in one action, and
  still undoes the approval if the build fails to start.
- A finished build still publishes itself onto the version, and the owner still presses Mark ready
  before anything reaches a client.
- `/apps/app-builder?p=<id>` still opens a draft started here; Jarvis chat's `app_builder` hand-off
  still works.
- Offline: the whole page works with no keys and no PC. The pages plan is written with no model at
  all, and the mockups fall back to the coded drawings when Flux is not running.

## Requested, not built yet

- The old routes (`/apps/app-builder`, `/apps/website-redesigner`, the owner's bare
  `/apps/client-review`) still stand on their own. They redirect in here only after the library has
  been checked against every live website — migration step 6 in
  `docs/superpowers/specs/website-studio.md`.
- The PC helper emits no task list for a Claude thread and `harness/preview` refuses a new-app
  project thread, so the Build tab shows the tool log rather than live tasks, and a draft has no
  local preview until it is deployed.
- Stage two can be written by a model or by a design engine (`FlowPlan.engine`); today it is the
  offline planner. Google Stitch was researched for this and left out on purpose — it is a
  quota-metered Google cloud service, its build half assumes Vite + React Router, and its output is
  static HTML with `href="#"` stubs.

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/website-studio` — owner's sign-in
- `src/components/website-studio/`
- `src/lib/website-studio/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

- _None._

### Data & database rules

- _No database, storage or saved data of its own._

### Keys & outside services

- _None._

### Tests

- `src/lib/website-studio/flows.test.ts`
- `src/lib/website-studio/library.test.ts`
- `src/lib/website-studio/pipeline.test.ts`
- `src/lib/website-studio/skills.test.ts`
<!-- code:end -->

# Ultimate Assistant OS — read this first

For every AI coding tool: Claude Code, Codex, Cursor, Gemini, Copilot, Windsurf, Aider, anything.
Claude Code also reads `CLAUDE.md`, which imports this file and adds Claude-only tools on top.
**Everything you need to build here is inside this repo.** Nothing below needs the owner's PC.

---

## Before you change anything: three checks

**1. Are you on current code?**

```bash
git fetch origin && git rev-list --left-right --count HEAD...origin/main
```

That prints two numbers: commits you have that `main` lacks, then commits `main` has that you
lack. The truth is **`main`** on `github.com/legacymiles/ultimate-assistant-os`. If the second
number is not 0, your checkout is **behind**: stop and tell the owner how many commits behind it is, before writing
any code. Old checkouts of this repo exist and are missing whole apps. Building on one is how a
feature the owner already has "disappears".

**2. Read the doc for the app you are touching:** `docs/apps/<slug>.md`.
It lists the app's **Features**, which are a contract: every one must still work after your
change. It also covers **how the app looks** (with a screenshot), where its code is, and the
owner's rules for it. The website itself (home page, app carousel, sign-in, legal pages) is
`docs/apps/hub.md`. The list of every app is `docs/apps/README.md`.

**3. Read `DESIGN.md` before writing any UI.** Its YAML header holds the real colour, type,
spacing and component tokens. Its body explains why. Then match the app's screenshot in
`public/look/`.

---

## What this repo is

One **Next.js 15** website (App Router, TypeScript, Tailwind v4, Supabase) that is **hosted on
Cloudflare** — it was on Vercel until 2026-11-07, so older notes and comments still say Vercel;
believe this line. It holds **every app the owner builds**, about 40 of them, under `/apps/<slug>`. It is both
their **portfolio** and their **personal operating system**. The centre of it is **Jarvis**,
an assistant that the other apps plug into.

The owner is **Osh**, a solo content creator and AI-automation artist (Honey Suite Studios). They
are not an engineer: write user-facing text and explanations in plain English. Who the product is
for, and its tone: `PRODUCT.md`. Who the owner is, their priorities and their locked decisions:
`aios/`.

`README.md` describes only **Projects Timeline**, the first app built here. It is not an overview
of the repo. This file is.

## Where things live

| Need | Go to |
|---|---|
| **What one app does, how it looks, where its code is** | `docs/apps/<slug>.md` |
| **The list of every app** — status, and where each one shows | `docs/apps/README.md` (generated from the catalog) |
| **The look** — tokens, components, rules | `DESIGN.md` · screenshots in `public/look/<slug>.jpg` |
| Who it's for · brand · product principles | `PRODUCT.md` |
| **Systems shared between apps** — In Queue, memory, keys, site errors, AI calls, studio homes, sign-in | `docs/SYSTEMS.md` |
| The app catalog — **single source of truth**; an app not in it does not exist | `src/lib/catalog.ts` → `PROJECTS` |
| Where an app shows: hub grid / Jarvis › App plugins / Dashboard widget / Toolbox tab / merged into a studio | `src/lib/studio/plugins.ts` (`PLUGIN_SLUGS`, `WIDGET_SLUGS`, `TOOLBOX_SLUGS`, `MERGED_INTO`) |
| An app's page | `src/app/apps/<slug>/page.tsx` |
| An app's UI | `src/components/<folder>/` |
| An app's logic, types and tests | `src/lib/<folder>/` (`*.test.ts` next to the code) |
| An app's server routes | `src/app/api/<folder>/` |
| Every AI call | `src/lib/ai/provider.ts` |
| Saved data that syncs across devices | `src/lib/sync/appState.ts` (Supabase `app_state`) |
| Database schema | `supabase/migrations/` (all in one: `supabase/all-schemas.sql`) |
| Sign-in walls and password gates | `src/middleware.ts` · `src/lib/appGate.ts` |
| Every change ever made to each app, newest first | `src/lib/timeline/feature-log.json` |
| Specs and plans | `docs/superpowers/{specs,plans}/` |
| Desktop/GPU helpers that are not the website | `tools/<name>/` |
| Environment variable names | `.env.example` (values go in `.env.local`, never committed) |
| Owner's context, decisions, connected systems | `aios/` (`aios/README.md` first) |

**The folder name is not always the slug.** Each app doc's "Where the code is" table gives the
real folders. The ones that differ:

`dashboard`→`recall` · `prompt-architect`→`blueprint` · `viral-studio-content`→`viral-studio` ·
`fire-reveal`→`reveal` · `3d-studio`→`studio3d` · `gods-eye-view`→`gods-eye` · `kart-showcase`→`kart` ·
`std-safe`→`stdsafe` · `seedance-studio`→`seedance` · `smart-shot-videos`→`smart-shot` ·
`video-studio-arena`→`video-studio` · `skills-library`→`skills` · `personas-studio`→`social-personas` ·
`money-agent-studio`→`money-agents` · `slippery-escape`→`slippery` · `website-redesigner`→`redesigner` ·
`custom-video-swap`→`jarvis/video-swap` · `workflow-maker`→`jarvis/workflow-maker` ·
`projects-timeline`→`AppShell.tsx` + `src/lib/repo`

## Where new things go

| Making | Put it | And register it |
|---|---|---|
| A **new app** | page `src/app/apps/<slug>/page.tsx` · UI `src/components/<folder>/` · logic + tests `src/lib/<folder>/` · routes `src/app/api/<folder>/` | **(1)** one object in `src/lib/catalog.ts` `PROJECTS` · **(2)** `docs/apps/<slug>.md` from `docs/apps/_TEMPLATE.md` · **(3)** a screenshot `public/look/<slug>.jpg` · then `node scripts/apps-index.mjs`. A test fails until (1) and (2) exist |
| A **feature in an existing app** | that app's folders | add a bullet to the **Features** list in `docs/apps/<slug>.md` in the same commit |
| A **change to how an app looks** | that app's components / CSS | update "How it looks" in its doc and retake `public/look/<slug>.jpg` |
| A cross-app system | `src/lib/<system>/` | a section in `docs/SYSTEMS.md` |
| A database table | a new file in `supabase/migrations/` | append it to `supabase/all-schemas.sql` |
| A new API key | `.env.example` (name only) | a `KEY_SOURCES` entry in `src/lib/new-jarvis/keySetup.ts` so users can set it up by clicking |
| A spec or plan | `docs/superpowers/{specs,plans}/` | — |
| Anything temporary | outside the repo | never commit it |

**Starting a new app:**

- **Slug:** short kebab-case naming the thing (`water-log`, not `app2` or `new-tracker`). Use the
  same word for the route and the code folders unless an existing folder already owns it.
- **Where it shows** (`src/lib/studio/plugins.ts`): leave it off every list and it gets a **hub
  grid** tile on the front page (only 8 apps are there today; most have moved into Jarvis). A working tool goes in `PLUGIN_SLUGS` (a card
  on Jarvis › App plugins). Something you glance at rather than work in goes in `WIDGET_SLUGS`
  (a Dashboard widget). If unsure, ask the owner. Anything holding the owner's personal data
  also goes in `UNPREVIEWABLE` in `catalog.ts`.
- **The test** that holds you to the registration column above is
  `src/lib/timeline/appDocs.test.ts` (run it with `npx vitest run src/lib/timeline`).

**Never create a second home for something that already has one:** no `notes/`, no `docs/notes/`,
no second app list, no second design doc. The tables above already have a place for it.

## How it looks

- **The system is "The Night Console"** (`DESIGN.md`): a near-black canvas with four tonal steps
  and 1px hairlines; colour only for state; monospace (JetBrains Mono, tabular figures) for every
  machine fact; dense tables over card grids; **no drop shadows**. Read the Do's and Don'ts at
  the bottom of `DESIGN.md`.
- **Some apps have their own look** on purpose (Cook Connect's holo table, Custom Video Swap's
  Cold Luxury, YouTube Videos' Holo Deck…). Each app's doc says which and how. **Keep an app's
  look unless the owner asks to change it.** Don't "unify" it back to the default.
- **Never ship a default-looking interface.** Plain Tailwind and a card grid is a failure here.
  If your tool has design skills or agents, use one before writing UI. Either way, follow
  `DESIGN.md` exactly and check the result against the screenshot.
- The owner likes **dense, database-style UIs** over card grids, and every screen must work on
  a phone.

## Rules that bite

- **Apps must work with no keys set** (local demo mode, offline fallback). A missing key degrades
  visibly; it never returns a 500.
- **Never run two dev servers on the same `.next` folder**, because it corrupts it. For a second
  server use `node scripts/dev-preview.mjs <port> --no-auth`, which uses its own folder and turns
  sign-in off.
- A self-contained Next app nested inside this repo must be added to `tsconfig.json` `exclude`,
  or `next build` breaks.
- Keep OpenRouter as the default AI route: its fallback, the Vercel AI Gateway, serves no
  Anthropic model on the free tier. That gateway is an API the code calls, not the host, so
  moving off Vercel hosting does not change it.
- Private apps that hold the owner's data go in `UNPREVIEWABLE` in `catalog.ts`, so the hub
  carousel never frames them.
- **Moving an app off the hub grid is one edit in `src/lib/studio/plugins.ts`.** Add it to
  `PLUGIN_SLUGS`, `WIDGET_SLUGS` or `TOOLBOX_SLUGS`, or put it in `MERGED_INTO` to fold it into a
  studio home. **Never delete the catalog entry.** Deleting one is what silently killed an app
  before.
- Folding an app into a studio home also needs: a section in that home's
  `src/lib/studio-home/<home>.ts`, mounting its component with `embedded`, and turning its old
  page into a `redirect()` to `?section=`. If that old page path holds uncommitted work, redirect
  from `next.config.mjs` `redirects()` instead (`docs/SYSTEMS.md` › Studio homes).
- **Never create `src/app/apps/ea-world/page.tsx` or anything under `src/app/apps/ea-lab/`.**
  That code lives only on the owner's PC and is not committed yet.
- **Nothing is sent, posted or bought without the owner's Approve.** This covers texts, social
  posts and client previews. Every app that does any of these has an approval step; keep it.

## Finishing a change

1. `npm test` (Vitest, runs `src/**/*.test.ts`) and `npm run build` must pass.
2. **Re-read the Features list in the app's doc and check each one still works.** Open the app;
   don't assume. Check it at phone width too.
3. Update `docs/apps/<slug>.md` in the same commit if you added a feature or changed the look.
4. Commit subject: **`<App>: <what changed, in plain words>`**. It becomes the feature's title on
   the owner's timeline. Then run `npm run timeline:log` and commit
   `src/lib/timeline/feature-log.json` with it.
5. Never push to `main` directly. Open a branch and a PR; the owner merges.

## What only exists on the owner's PC

You don't need any of these to build. They're listed so you know not to wait for them or
recreate them:

- **Claude Code skills** (`~/.claude/skills/`, plus a few in this repo's `skills/`) and the
  owner's memory server (the `jarvis-memory` connector). If your tool can't reach them, the docs
  in this repo are the fallback and are enough.
- **The owner's machine map** (`~/.claude/MAP.md`): which local folder holds which branch.
- **EA World / EA Lab** source code (see the rule above).
- `.env.local` with real keys. Every app runs without it.

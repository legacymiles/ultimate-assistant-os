# Website Redesigner

Route: `/apps/website-redesigner` · Category: Websites · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- website-redesigner "what to change"`.

## What it does

Paste any URL and get a fresh redesign that keeps what the site does. Website Redesigner fetches and analyzes the real page, captures a functionality inventory to preserve, then proposes three distinct redesign directions — restrained, expressive and experimental — each driven by a design skill and named a real site to beat. Pick one and it writes a complete, paste-ready, functionality-preserving build prompt for Claude Code. Works on any external URL, or your own site (so the rebuild edits real source and only restyles). AI-powered with a full offline fallback.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **A trust level, so one job is not a hundred taps** — New Jarvis gated every call with an effect, because `confirm` in actions.ts was answering two questions at once: "does this have an effect" and "should the owner be stopped and asked". A twelve-step …
- **The roster only holds skills that have a skin** — Takes the guard from ad9986a (feat/studio-hub-studios), written in parallel with 75fc8d0 while both of us were chasing the same red test. Theirs is the better mechanism and this keeps it.
- **A skill that builds a site is not a style** — skins.test.ts has been red on main since 99334dc, which added 11 "design skills" to the roster without skins. Nine of them are not design skills: jarvis-harness hands coding to a background agent, we…
- **Add design skills app-builder, commercial, eas-app-stores, expo-design-system, felix, hyperframes, impeccable, jarvis-harness, make-this-bet** — Auto-added by scripts/sync-design-skills.mjs after the skill was installed in ~/.claude/skills.
- **Add design skills app-builder, commercial, eas-app-stores, expo-design-system, felix, jarvis-harness, promo-video, rea-to-workflow, scholar,** — Auto-added by scripts/sync-design-skills.mjs after the skill was installed in ~/.claude/skills.
- **One home for building, with Website Redesigner inside** — /apps/app-builder gets a StudioHome switcher: Build (App Builder, unchanged) and Website Redesigner (V1, the V2 bake-off and a new Showcase view, moved into a component so the route is a thin page). …
- **4 link boards (audio, fights, dances, motion)** — New app at /apps/viral-studio-content; /apps/tiktok-dances redirects in - Paste social links (several at once, Ctrl+V anywhere, drag & drop) into the open tab, newest first, no duplicates per tab - H…
- **Five things the first real bake-off found** — Driving three live Claude lanes for twenty minutes taught more than the whole build did. Every fix here is a thing that was wrong on screen.
- **The bake-off console, and a crucible wired to the lanes** — ?v=2 on the Redesigner's own route is the bake-off; V1 is reached by every other spelling and is untouched. Four targets, N design skills, one harness thread per lane, three running builds compared s…
- **The brief, the facts and the lanes - before any of it is drawn** — The brief is the reason a bake-off can beat a tool that returns mockups: a lane does not get "redesign this nicely", it gets a contract. V2 never authors a design - no palette, no type scale, no layo…
- **The skill rebuilds the page, not just its colours** — The first pass only re-tinted the same page, which is not what a design skill does. Picking or hovering a skill now swaps the whole composition: seven arrangements of the same content, each the page …
- **The page wears the design skill you pick** — Reading "warm monochrome, typographic contrast" tells you nothing about a skill. Watching the console turn into warm paper with a serif headline tells you in half a second — so picking a skill in the…
- **Add design skill preview-icon** — Auto-added by scripts/sync-design-skills.mjs after the skill was installed in ~/.claude/skills.
- **Add design skills blender-threejs-export, hyperframes** — Auto-added by scripts/sync-design-skills.mjs after the skill was installed in ~/.claude/skills.
- **Correct the scroll-world roster description** — Mirrors 06b55f4 on main, so this branch matches the live roster.

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/website-redesigner` — owner's sign-in
- `src/app/api/redesign/`
- `src/components/redesigner/`
- `src/lib/redesigner/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/redesign` | owner's sign-in |
| POST | `/api/redesign/scrape` | owner's sign-in |

### Data & database rules

- _No database, storage or saved data of its own._

### Keys & outside services

- `AI_MODEL` — `src/app/api/redesign/route.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/redesign/route.ts`

### Tests

- `src/lib/redesigner/fingerprint.test.ts`
- `src/lib/redesigner/skins.test.ts`
- `src/lib/redesigner/v2/brief.test.ts`
- `src/lib/redesigner/v2/lane.test.ts`
<!-- code:end -->

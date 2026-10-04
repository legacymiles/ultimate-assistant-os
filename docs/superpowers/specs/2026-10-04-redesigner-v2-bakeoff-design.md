# Website Redesigner V2 — the design-skill bake-off

**Date:** 2026-10-04
**Status:** approved, building

## What this is

V1 of the Website Redesigner takes a URL and produces three written redesign
directions plus a paste-ready build prompt. V2 is a different act: it takes a
target, fires several coding-harness threads at once — each one told to build
the same thing with a DIFFERENT design skill — and gives back N real, running
builds to click through side by side.

It is the answer to a question the owner cannot answer any other way: which of
my design skills actually makes the coolest UI? A written direction cannot
answer it. A mockup cannot answer it. Three running sites can.

The comparison to Google Stitch is the owner's: Stitch turns a prompt into UI
mockups you then export. V2 turns a prompt into working code in your own repo,
designed by your own skills, on a branch you can land.

## The decisions, and why

**The design skill does the designing. V2 never authors a design spec.**
Considered and rejected: having V2 write tokens/type/layout per skill and
handing that spec to the builder. That is the mechanism that produces bland
output. The skills in `~/.claude/skills` are 10–40KB of specific, opinionated
instruction with hard bans in them; a palette-and-type sheet in between keeps
the colours and throws the opinions away. V2's only job is to assemble an
airtight brief and name the skill as sole design authority.

**Also rejected: V2 rendering the previews itself** (extending V1's live skin
system). It would be instant and free, but the preview would be this repo's CSS
wearing the skill's name — so the bake-off would measure the wrong thing.

**Judged by eye, recorded anyway.** No critic panel, no auto-scoring. The owner
picks the winner. The pick is recorded as one line so that after a few runs
there is a leaderboard, which is the actual deliverable of the feature.

**Lanes run on whichever harness is toggled.** Claude and DeepSeek are
independent peers (`listHarnesses()` checks each separately: the Claude Agent
SDK in `tools/jarvis-bridge` vs `dsh` at `DSH_DIR`). A bake-off runs entirely on
DeepSeek when Claude is not installed, and vice versa. An unavailable harness is
greyed with its `why` string printed verbatim; a lane whose model fails mid-run
keeps its place on screen showing the error rather than being retried silently
or removed.

## Architecture

### 1 · Routing

`/apps/website-redesigner` renders V1, untouched. `?v=2` renders V2, with a
V1/V2 toggle docked in both — the hub carousel's convention. New code lives in
`src/components/redesigner/v2/` and `src/lib/redesigner/v2/`; the only edit to
existing code is `page.tsx` branching on the search param.

### 2 · The brief — `src/lib/redesigner/v2/brief.ts`

Pure and tested. A `Target` is one of four shapes:

| Target | Facts source |
|---|---|
| `{kind:"new", idea}` | the prompt box text |
| `{kind:"my-app", slug}` | Projects Timeline repo (`overview`, `detailed`, curated `Feature[]`) + the catalog entry + the slug→folder map |
| `{kind:"url", url}` | V1's `scrapeUrl` from `engine.ts`, reused |
| `{kind:"hub-page", route}` | the route and its component folder |

`buildBrief(target, facts, skill)` returns the prompt the lane receives. Fixed
spine:

- **WHAT** — the target, with every feature quoted verbatim. Never summarised:
  a summarised feature is a dropped feature.
- **DESIGN AUTHORITY** — invoke skill X first; it owns every visual decision.
- **CONTRACT** — these features must still work; Tailwind v4; no new
  dependencies; the app must run with no keys set.
- **LANE RULES** — stay inside your worktree; add the catalog entry; this is
  the route.

Tests: the feature list survives verbatim, the feature count is preserved, the
skill is named exactly once as sole authority.

### 3 · Lanes — `src/lib/redesigner/v2/useBakeOff.ts`

Composes the bridge calls that already exist — `harness/list`, `start`, `say`,
`events` — and folds each lane's stream with the EXISTING `reduceEvents`, so
there is no second reducer to keep honest. One lane = one thread = one worktree
= one branch. Polling round-robins across lanes, reusing `pollEvery`, so three
lanes do not cost three times the requests.

### 4 · The gate, and the one new policy

Today `strict: false` auto-allows reads only; every write gates in both
harnesses, deliberately. Three lanes building a whole app that way is hundreds
of approvals, so bake-off lanes get a new, explicitly opt-in per-thread flag:

> auto-allow a **write** whose resolved path is inside that lane's own
> worktree. Runs, network, and any path outside the worktree still gate.

Default off everywhere else — New Jarvis's behaviour does not change.

### 5 · Preview per lane

One new bridge route, `POST /harness/preview {id, port}`, spawning
`scripts/dev-preview.mjs <port> --no-auth` with cwd set to that lane's worktree
and its own `NEXT_DIST_DIR` (two dev servers sharing `.next` corrupts it).
Ports 3311/3312/3313. Plus `POST /harness/preview/stop`.

V2 frames each lane at its port with a phone/tablet/desktop switcher. With the
bridge off, V2 says so plainly and hands over the briefs to paste — it degrades
visibly and never 500s.

### 6 · Compare and verdict

Three panes: skill name, live frame, diff summary, build stream behind a toggle.
"This one won" lands the winner's branch and discards the others behind a single
confirm — never automatically. The pick is recorded to `app_state` via
`saveSynced` as one line (skill, target, date), building the leaderboard.

### 7 · V2's own look — `blender-to-web`

The surface itself is built with the skill the owner named: a sculptural
centerpiece modeled in Blender (reproducible Python, editable `.blend`,
efficient GLB) brought to life with React Three Fiber, reacting to the run.
Specified when the skill is invoked at build time, not guessed at here. `three`,
`@react-three/fiber`, `drei`, `gsap` and `lenis` are already installed, so this
adds no dependencies.

### 8 · The `jarvis-harness` skill

New skill, written to BOTH `~/.claude/skills/jarvis-harness/` and the repo's
`skills/jarvis-harness/` — the repo copy is what makes it appear in Jarvis
Toolbox on the deployed hub. Contents:

- what the harness is, and that Claude and DeepSeek are independent peers
- the model toggle, and that a thread can be steered from a page OR from a
  Claude Code session — which is separate from which model runs it
- the gate, its risk levels, and the worktree-write policy above
- worktrees, land, discard
- the preview route
- troubleshooting, each failure named by its real symptom: bridge off, harness
  not installed (the `why` strings), dsh denying its own write before asking,
  dropped events resetting the view, a lane dying mid-build

## Build order

Three separable pieces, each usable before the next starts:

1. the `jarvis-harness` skill
2. V2 surface + brief + lanes
3. preview + compare + verdict

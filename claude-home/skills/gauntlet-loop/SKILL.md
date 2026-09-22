---
name: gauntlet-loop
description: >-
  Turn a goal into a self-improving Builder-vs-Critic loop that iterates until the
  work beats a real, named quality bar. A PANEL of specialist critic agents each gather
  their own evidence (for visual work: screenshots at several viewports, scroll positions,
  zoom levels, interaction states, motion frames; for writing, code, CLIs and skills: several
  perspectives and levels of reading), score design and aesthetics 0-10 and log every error;
  a squad of builder agents fixes the ranked issues in parallel; pass = over 8.5 (AAA) with
  zero errors, up to four retry rounds. Works for ANY medium. Use this WHENEVER the user wants
  output pushed past "good enough" through adversarial refinement — phrases like "gauntlet
  loop", "gauntlet this", "builder and critic", "critique loop", "critic agents", "score it",
  "AAA quality", "red-team my output", "iterate until it beats X", "make this as good as
  <named site/article/tool>", "keep going until it wins", "set a quality bar", "adversarial
  refinement", or any ask to relentlessly improve something (a site, 3D hero, game, essay,
  CLI tool, design, skill, research doc) against a concrete reference. Also trigger when the
  user wants BOTH a reusable prompt to paste elsewhere AND for you to run the loop with
  sub-agents. Produces a paste-ready prompt and/or orchestrates it.
---

# Gauntlet Loop

A gauntlet loop pushes **any** output (a website, an app, a 3D scene, a game, an essay, a CLI,
a skill) past "good enough" by making it survive repeated, adversarial judgment against a
**real thing that already exists in the same genre**. Builders make the work; a **panel of
critics** (fresh eyes, no idea how much effort went in, each with its own lens and its own
evidence) judge its craft harshly against that reference. The builders get one ranked issue
list and fix it in parallel. Repeat until it passes. The loop is the same for every medium;
only the evidence and the error list change.

Two deliverables: **a paste-ready prompt** for any Claude Code session, and/or **the loop
itself**, orchestrated here with sub-agents; if unclear, produce the prompt and offer to run
it. `references/templates.md` is the single source for all copy-paste text (critic prompt,
per-medium EVIDENCE and ERRORS blocks, critic JSON, aggregate, builder brief, paste prompt).

## The one thing that matters: the Bar

The loop only produces quality if the thing it compares against is **real**. A vague bar
("make it look professional") gives critics nothing to fetch; they invent a standard. A valid bar is **Named, Fetchable, and Comparable**:

- **Named**: a specific, real instance, not a category. `linear.app`, not "a clean SaaS site".
- **Fetchable**: a critic can obtain it right now: a URL to screenshot, an article to read,
  a repo or binary to run, a game to play.
- **Comparable**: same genre and ambition as the goal, so a side-by-side means something.

Choose the bar **per task and genre**: a landing page gets a landing page, an essay an
essay, a CLI a CLI. If the user gave no bar, **propose 2-3 candidates and let them pick**
before generating anything. `references/bars.md` lists strong named bars by domain.

The bar sets the **level of craft**, not the look. Critics judge how well the work does
what it is trying to do, at the bar's level; they never deduct for not resembling the bar.

## The scoring rule (the gate)

The user's rule, verbatim:

> After each completed attempt, a separate critic agent takes its own screenshots from several viewpoints and zoom levels and scores the design and aesthetics from 0 to 10. Over 8.5 means AAA quality. A pass is over 8.5 with zero errors. Below that, the builder gets the ranked issue list and tries again up to four rounds.

With a panel, each lens is one such critic.

| Score | Meaning |
|---|---|
| **> 8.5** | **AAA quality.** Stands next to the bar without apology |
| 7.0 – 8.5 | Strong professional work, but a trained eye sees the gap to the bar |
| 5.0 – 7.0 | Competent, template-adjacent, forgettable |
| < 5.0 | Broken, generic or clearly unfinished |

Precisely:

- **Overall** = mean of the lens scores, **rounded to one decimal first** (round half up:
  8.55 → 8.6, 8.549 → 8.5). **PASS needs that
  rounded value ≥ 8.6 (i.e. over 8.5) AND zero errors.** Those are the only two ways to fail.
  Always report the **lowest lens** next to it: `8.7 (low: art direction 8.1)`.
- **Any lens under 8.0 supplies the #1 issue** in the ranked list, whatever the mean, so a
  weak lens cannot hide behind strong ones. It does not by itself fail the round. Several
  under 8.0: lowest lens first; equal lens scores: higher severity first.

**Rounds.** **Round 1** is the critic panel on the first complete attempt. If it fails, up to
**four retry rounds** follow (**rounds 2 to 5**): builders fix, then a fresh panel scores.
Stop at the first PASS or **after round 5**, and then report the honest score, the lowest
lens, the remaining ranked issues and what would close them.

### "Screenshots from several viewpoints and zoom levels", for every medium

The rule is universal: literal for visual work; otherwise **several viewpoints** = several
perspectives on the work and **several zoom levels** = several levels of reading it.

| Medium | Viewpoints | Zoom levels |
|---|---|---|
| Website / web app | viewports (desktop, laptop, phone), scroll positions, interaction states | full frame, detail crops, element crops, browser zoom 200% |
| 3D / WebGL | the same, plus camera angles the scene offers, idle vs input motion frames | full frame, material/edge crops, video of the journey |
| Game | several in-game camera positions, play states (start, mid-play, fail, win), a recorded play | wide shot, HUD/UI crop, close-up of assets |
| Writing | a cold first-time reader, an expert, a skeptic | whole (arc, argument), section (structure), line (prose, facts) |
| CLI / API / library | new user, power user, script/CI caller | whole session, one command's output, one edge case |
| Skill / prompt | an agent following it cold, the user triggering it, a reviewer | whole flow, one step, one line (command, path, API) |

The concrete EVIDENCE block each critic gets per medium is in `references/templates.md` §2b.

### Errors (binary; any single one blocks the pass, whatever the score)

Every medium has a concrete error list; it lives **only** in `references/templates.md` §2b
(web/app, 3D/WebGL, game, writing, CLI/API, skill/prompt). Rules for all of them:

- **Only the build's errors.** Errors in the bar's evidence never count.
- For camera runs, each error is tagged `party: first` or `third` by comparing its source
  with the build's site (hosting suffixes like `vercel.app` count per subdomain; extensions like
  `chrome-extension://` are always third-party). **First-party errors block. Third-party
  errors block only when the critic confirms the build caused them**; otherwise the critic
  lists them as noise.
- `flags` in the report (focus ring missing, click navigated away, popup, crop skipped) are
  leads, not errors. Flags with `heuristic: true` (`keyboard-trap`, `blank-canvas`,
  `wheel-detail-loss`) are suspected errors: the critic confirms them in the shots (does
  Escape leave the modal? is the canvas meant to be dark?) and only then lists an error.
- **Not loaded.** A critic whose camera reports `stats.loaded: false` (exit 1) returns
  `score: null` plus the navigation error, and is never scored. The orchestrator first checks
  whether the build itself is down: if it is, that is a build error, and the round FAILS and
  counts. Otherwise it is a setup problem (wrong URL, server not started): fix the setup and
  rerun that lens only. A void rerun does NOT consume a retry round.

### Anchoring (keeps scores honest)

The bar is the **9-10 anchor**. Deductions need evidence: a critic who cannot say concretely
why the work is *below* the bar on a point may not deduct for it; a critic who can, must.
Ties go to the bar.

## The critic panel: decompose the task, delegate the judging

One critic sees one thing. A panel sees the whole. Before round 1, **decompose the task into
lenses**: 3 to 5 independent angles that together cover what "as good as the bar" means.
Give each lens to its own critic agent. Pick the lenses for the medium:

| Medium | Typical lenses |
|---|---|
| Website / web app | **Art direction** (composition, palette, type, hierarchy) · **Content & UX** (clarity, flows, states) · **Motion & interaction** · **Responsive & robustness** (mobile, reduced motion, errors, a11y, performance) |
| 3D / WebGL | Art direction · **3D & light** (materials, lighting, silhouette, post, render quality) · Motion & interaction · Responsive & robustness |
| Game | Feel & controls · Visual polish · Level/flow · Stability & performance |
| Writing | Argument · Structure · Voice & line-level prose · Accuracy |
| CLI / API / library | Ergonomics · Output & errors · Correctness & edge cases · Docs |
| A skill / prompt | Coverage vs the bar's techniques · Actionability for an agent · Accuracy · Failure modes |

Every critic:

1. **Gathers its own evidence** for its medium (templates §2b): runs the camera on a URL,
   screenshots and plays a game, reads a text cold at three levels, runs a CLI next to the
   bar's, traces an agent through a skill. It never judges from the builder's screenshots or
   description. It reads the bar's evidence from `<run>/bar` (captured once in round 0) and
   does not recapture the bar (CLI/API: it may run the bar on a new input it adds; templates §1). For URL work it also reads the round's **shared capture**
   (below) and still runs **at least one targeted capture of its own** for its lens.
2. **Is blind and adversarial.** It is not told who made the work, how long it took, or any
   earlier round's scores. Its job is to find gaps, not to reassure.
3. **Verifies what must still be true.** From round 2 on, the orchestrator gives it the
   previous round's merged `strengths_to_keep` as a checklist (no scores attached). Any that
   no longer hold are **high-severity regression issues**.
4. **Returns the critic JSON** (templates §2a) so issues can be merged.

**Aggregate** (orchestrator; format in templates §3): overall = mean of lens scores rounded to
one decimal, plus the lowest lens. Errors = union of the critics' `errors` (first-party, plus
third-party they confirmed); never the bar's. Merge duplicates. Rank: a lens under 8.0 supplies
#1 (lowest lens first), then regressions, then severity × that lens's gap below 8.5. Builders
get only that ranked list (with evidence files) plus the union of `strengths_to_keep`.

## The camera: `scripts/critic-shots.mjs` (anything with a URL)

Always write the absolute path (PowerShell does not expand `~`). It drives the installed
Chrome headless on the real GPU (playwright-core lives in the skill folder).

```
node C:/Users/honey/.claude/skills/gauntlet-loop/scripts/critic-shots.mjs --url <url> --out <run>/r<N>-<lens> \
  --viewports 1920x1080,1440x900,390x844 --steps 6 --frames 4 --interact --page-zoom 200
```

Per viewport it captures (details in `--help`):

- **Journey**: top + `--steps` positions via real 120 px wheel ticks. Long pages: corrected
  with `scrollTo` only on > 4 px drift, labelled honestly (`probes[].scrollDrift`). One-screen
  pages are tested: **wheel-driven** (a scroll journey *or* a camera zoom: compare w01 vs s00)
  if the wheel changes the frame, else **static single screen** (stepping stops). Scroll
  journeys (igloo-like): big `--wheel` (3000+) and a long `--wait`. OrbitControls scenes: the
  wheel zooms, so a small `--wheel` (240) or `--steps 1` (flag `wheel-detail-loss` warns).
- **Zoom levels**: 2x DPR full frames; native-2x crops (centre, top-left, `--crop x,y,w,h`:
  each value ≤ 1 is a fraction, > 1 is px) at top and mid step; `--selector` element crops;
  `--page-zoom 200` browser zoom (top + mid-page reflow check, desktop only).
- **Motion**: `--frames N` screencast bursts idle at the hero and per transition (still pages
  repeat frames marked `sameAsPrevious`); `--video` records the journey.
- **Interaction** on a fresh load: hover, drag, `--hover` (desktop only), a Tab pass; clicks on
  their own reload; mobile tap and swipes. Navigation/popups flagged; shots list `after`.
- **Checks**: console errors, exceptions, failed/4xx/5xx requests (party-tagged, deduped),
  horizontal overflow, `--expect-webgl`, `--reduced-motion`; blank canvas and keyboard trap
  as heuristic flags.
- **Robust**: a failed shot or viewport is flagged and the run goes on; `report.json` is
  always written (and checkpointed after each viewport). Exit 0 ok, **1 not loaded**
  (`stats.loaded: false`), 2 bad args (`--out` is required), **3 partial** (`stats.partial`:
  `--max-ms` reached, interrupted, or a camera failure; judge what was shot or rerun the rest).
  Nav failed on some viewports = partial: judge the rest, rerun the missing one (listed in
  `stats.navigationFailures`); `stats.loaded: false` only when every viewport failed.

**Time.** ~15–50 s per viewport; ×2–3 with a long `--wait`, `--frames` or `--video` (a 3D
flag set on three viewports took 3.5 min). That passes Claude Code's default 2-minute Bash
timeout, and a killed run never finishes its report. **Always run the camera with the Bash
tool `timeout: 600000`, or `run_in_background: true` and wait for the completion notice.**
`--max-ms` (default 540000) is the camera's own budget: when reached it takes no new shots,
writes `report.json` with `stats.partial: true` and exits 3 (Ctrl-C writes it too).

**Shared capture (default for URL work).** 4–5 critics each launching Chrome on one laptop
GPU skews frame timing. So each round, before spawning the panel, the orchestrator runs **one
full capture** of the build into `<run>/r<N>/shared` (round-0 flags). Critics read it, and each
still runs its own **targeted** capture (one or two viewports, its lens flags) into
`<run>/r<N>-<lens>`: its own screenshots. Frame-timing artefacts (stutter, dropped frames)
are confirmed in the shared capture before they are logged as errors.

## The improvement squad: many fixes for one task

A single builder working through 25 issues serially is slow and loses the thread. Split the
ranked list into **clusters that touch disjoint files or systems** (e.g. lighting and post /
HUD and typography / interaction code / mobile and fallback; for an essay: sections) and give
each cluster to its own builder agent, running in parallel. Rules:

- **Each builder owns its files** (an explicit list), in the main tree when files are disjoint
  (the dev server keeps serving it). Two clusters on one file: merge them or run them in turn.
- **Worktrees only for risky, overlapping work.** Builders spawned with
  `isolation: "worktree"` must **commit on their branch** before finishing (uncommitted work
  is lost when the worktree is cleaned up). The integrator then merges each branch into the
  main tree, resolves conflicts, and **restarts or reloads the dev server on the merged tree**
  before any critic shoots.
- **Builders fix; they never score.** A builder that grades its own work inflates.
- **Integrate, then verify once.** After the squad, one integrator pass checks the build runs
  cleanly (web: camera with `--steps 0 --interact`, exit 0, no new first-party errors; code:
  tests and a run; writing: one full read for seams) before the panel re-scores.
- **Keep what works.** Every builder brief carries the merged `strengths_to_keep`, so a fix
  in one place does not flatten what already beat the bar.

## Process

Restate the goal in one line → establish the bar (validate it, or propose 2-3 and wait) →
decompose into 3-5 lenses → generate the prompt (templates §5) and/or run the loop (below).

## Running the loop yourself (orchestration)

- **Round 0: bar evidence.** You capture the bar once into `<run>/bar` (camera for a URL with
  the flags `references/bars.md` lists; saved text for writing; the bar tool's outputs for a
  CLI). Critics read it; they never recapture it (CLI/API exception: new inputs, templates §1).
- **Attempt.** One builder agent (or you) produces the first complete version.
- **Round 1: panel.** URL work: first the shared capture into `<run>/r1/shared`. Then spawn
  all critics **in one message** (Agent tool, parallel), each with the critic prompt
  (templates §2 core + the medium's blocks + its lens); nothing about effort or earlier scores.
- **Aggregate** yourself and tell the user: round #, each lens score, overall (one decimal),
  lowest lens, first-party error count, PASS/FAIL, top three issues.
- **Squad.** On a fail, spawn builders **in one message**, each with the builder brief
  (templates §4). Integrate and smoke-test.
- **Rounds 2-5.** A **fresh** panel each time (new agents, no memory of earlier rounds), given
  the previous `strengths_to_keep` as must-still-be-true checks. Stop at the first PASS or
  after round 5.

Two engines: the **Agent tool** (default; the user can watch and steer), or the **Workflow
tool** only when the user opted into it (said "ultracode" or asked for a workflow).

For comparisons where a score is meaningless (choosing between two drafts), use the **blind
A/B** variant: strip labels, randomize order, force a binary pick plus every way the loser
loses, and loop until the critic picks the build over the bar.

## Failure modes (what quietly kills a gauntlet loop)

- **Vague bar**: critics invent a standard. Fix: Named + Fetchable + Comparable, per genre.
- **Builder judges itself** / **critics judge the builder's evidence**: inflation, curated
  views. Fix: separate fresh critics every round, each gathering its own evidence.
- **Web-only thinking**: an essay or CLI gets no real evidence. Fix: the medium's EVIDENCE block.
- **One critic, one lens**: a beautiful hero with a broken mobile layout passes. Fix: a panel,
  and a lens under 8.0 is issue #1.
- **Soft critics / score creep**: 8.6 for work obviously below the bar. Fix: the bar is the
  9-10 anchor, deductions need evidence, ties go to the bar, errors block.
- **Scoring from no evidence**: a dead URL, empty report, or a camera killed by a 2-minute
  timeout. Fix: `timeout: 600000`; `stats.loaded: false` means score null (see Not loaded).
- **Counting noise as errors**: the bar's, an extension's, or an unconfirmed heuristic flag.
  Fix: only the build's first-party errors, plus third-party ones the critic confirms.
- **Serial fixing**, **lost worktree work**, **fixes that regress**: see the squad rules;
  `strengths_to_keep` travels with every brief and the next panel verifies each one.
- **Over-specified builder** (you hand-wrote the answer) or **bar as a look to copy** (a
  clone). Fix: goal + bar + ranked issues; judge craft, never resemblance.

## Examples

**Landing page.** "Gauntlet-loop me a landing page for my Postgres backup CLI." Offer bars
`planetscale.com`, `dub.co`, `railway.app`; the user picks PlanetScale. Lenses: art direction
/ content & UX / motion / responsive. Round 1: 7.1 / 6.4 / 7.8 / 8.0, overall **7.3 (low:
content 6.4)**, 2 first-party errors, FAIL. Three builders fix type + hero, pricing, mobile
nav. Round 2 … PASS at 8.7 (low 8.3), zero errors, or an honest report after round 5.

**Other media.** An essay against Paul Graham's *How to Do Great Work*: three cold readers at
whole / section / line level; errors are factual mistakes and broken links. A log-search CLI
against ripgrep: both run on one corpus, outputs diffed, edge cases probed. An Unreal level:
`unreal_screenshot` from several cameras and play states. A WebGL world against `igloo.inc`:
long `--wait`, big `--wheel`, `--frames`, `--video`, Bash `timeout: 600000`.

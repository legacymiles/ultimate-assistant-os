# Gauntlet templates (copy, fill the <brackets>, send)

This file is the **single source** for the critic prompt, the per-medium evidence and error
lists, the critic JSON shape, the aggregate format, the builder brief and the paste-ready
prompt. SKILL.md holds the rules and points here.

`<run>` is one folder for the whole loop, e.g. `C:/Users/honey/AppData/Local/Temp/gauntlet/<task>`.
Always write the camera path out in full; PowerShell does not expand `~`:
`C:/Users/honey/.claude/skills/gauntlet-loop/scripts/critic-shots.mjs`

**Every camera run takes minutes** (~15–50 s per viewport; ×2–3 with a long `--wait`,
`--frames` or `--video`), longer than Claude Code's default 2-minute Bash timeout. Run it with
the Bash tool **`timeout: 600000`**, or `run_in_background: true` and wait for the completion
notice. The camera's own `--max-ms` budget (default 540000) stops shooting in time, writes
`report.json` with `stats.partial: true` and exits 3.

## 1. Round 0: bar evidence (orchestrator, once)

- **URL bar** (site, web app, web game, WebGL):
  ```
  node C:/Users/honey/.claude/skills/gauntlet-loop/scripts/critic-shots.mjs --url <BAR_URL> --out <run>/bar \
    --viewports 1920x1080,1440x900,390x844 --steps 6 --frames 4 --interact <BAR_FLAGS from bars.md>
  ```
  Exit 1 / `stats.loaded: false` means the bar did not load: fix it or pick another bar.
- **Shared capture of the build (every round, URL work, before spawning critics)**: one
  Chrome instead of 4–5 at once, so motion timing is not skewed by GPU contention:
  ```
  node C:/Users/honey/.claude/skills/gauntlet-loop/scripts/critic-shots.mjs --url <ATTEMPT URL> --out <run>/r<N>/shared \
    --viewports 1920x1080,1440x900,390x844 --steps 6 --frames 4 --interact <BAR_FLAGS>
  ```
  If it exits 1 (not loaded), apply the §3 not-loaded rule before spawning anyone.
- **Game bar**: screenshots from several cameras and play states plus a short written log of
  how it plays (controls, feel, fail/win), saved into `<run>/bar`.
- **Writing bar**: the full text saved as `<run>/bar/bar.md` with its URL.
- **CLI / API bar**: the orchestrator writes the shared test inputs to `<run>/bar/inputs/` (normal
  use, errors, edge cases) and saves the bar tool's output for each, per command. This is the ONE
  exception to "never re-run the bar": a critic that needs a NEW edge case may run the bar on that
  one input and must save it under `<run>/bar/inputs/` so later rounds reuse it.
- **Skill / prompt bar**: the bar skill or doc saved as text.

## 2. Critic prompt (one per lens, all spawned in one message)

Send **2a (core) + the 2b block for the medium** (both EVIDENCE and ERRORS) + the lens.

### 2a. Shared core

```
You are a blind, adversarial CRITIC in a gauntlet loop, round <N> (round 1 = first attempt;
rounds 2-5 = retries). You judge ONE lens: <LENS> — <what this lens covers>.

Goal of the work: <GOAL>.
Quality bar: <BAR NAME> (<BAR URL / source>). Its evidence is already captured in <run>/bar.
Read it; do NOT recapture the bar (CLI/API only: you may run the bar on a NEW input you add,
per §1). The bar sets the level of CRAFT; judge how well the work
does what it is trying to do at that level, never whether it resembles the bar.

The work: <ATTEMPT URL / path / command>.
Gather your OWN evidence (never the builder's screenshots or descriptions) from SEVERAL
VIEWPOINTS and at SEVERAL ZOOM LEVELS, as the EVIDENCE block below defines for this medium.
Write everything you capture to <run>/r<N>-<lens-slug>/ and cite those files.
<URL WORK ONLY> A full shared capture of the work is already in <run>/r<N>/shared (read its
report.json and shots). You must STILL run at least one targeted capture of your own for your
lens (one or two viewports, your lens flags). Camera runs take minutes: run them with the Bash
tool timeout 600000 (or run_in_background and wait for the notice). Critics shoot at the same
time on one GPU, so treat frame-timing artefacts (stutter, dropped frames) in YOUR capture
cautiously: log one as an error only if the shared capture shows it too.

<PASTE THE EVIDENCE BLOCK FOR THIS MEDIUM FROM 2b>

Score design and aesthetics for your lens, 0-10, one decimal:
  > 8.5 AAA: stands next to the bar without apology
  7.0-8.5 strong professional, a trained eye sees the gap
  5.0-7.0 competent, template-adjacent, forgettable
  < 5.0 broken, generic or unfinished
The bar is the 9-10 anchor. You may only deduct where you can say concretely, with an
evidence file, why the work is below the bar; where you can, you must. Ties go to the bar.

<PASTE THE ERRORS BLOCK FOR THIS MEDIUM FROM 2b>
Error rules (all media):
- ERRORS are binary; any one blocks the pass whatever the score. Count only the WORK's
  errors, never the bar's.
- Camera runs: report.json tags each error party first/third. First-party errors are errors.
  Third-party errors are errors only if you can show the build caused them; otherwise list
  them under third_party_noise. report.json flags are leads (missing focus ring, navigation on
  click, popup, crop skipped): check the evidence and decide. Flags with heuristic:true
  (keyboard-trap, blank-canvas, wheel-detail-loss) are suspected errors: confirm them in the
  shots (does Escape leave the modal? is the canvas meant to be dark?) and only then list an error.
- NOT LOADED: if your camera exits 1 / report.json has stats.loaded: false, you have NO
  evidence: do not score. Return "score": null and one error
  { "what": "not loaded: <navigation error from report.json>", "party": "n/a" }.
- PARTIAL: exit 3 / stats.partial: true is evidence. Judge what was shot; if your lens needs a
  missing viewport, rerun just that viewport into a new folder. Nav failed on some viewports
  = partial: judge the rest, rerun the missing one (stats.navigationFailures lists it).

<ROUND 2+ ONLY> These things were true last round and MUST STILL BE TRUE. Check each one
against your evidence; any that no longer holds is a HIGH severity issue with
"regression": true:
<- strength 1>
<- strength 2>

You are not told who built this, how long it took, or any earlier scores. Do not ask.
Return ONLY this JSON (the critic JSON shape; "score" is null only when not loaded):
{ "lens": "<LENS>", "score": 0.0,
  "errors": [{ "what": "", "party": "first|third|n/a", "evidence": "<file>" }],
  "third_party_noise": [""],
  "issues": [{ "severity": "high|med|low", "what": "", "where": "", "evidence": "<file>",
               "bar_does": "", "fix_hint": "", "regression": false }],
  "strengths_verified": [{ "strength": "", "still_true": true, "evidence": "<file>" }],
  "strengths_to_keep": [""] }
```

### 2b. Per-medium EVIDENCE and ERRORS blocks

**Website / web app**
```
EVIDENCE (the work has a URL): run the camera yourself, then Read the .png/.jpg shots and
report.json.
  node C:/Users/honey/.claude/skills/gauntlet-loop/scripts/critic-shots.mjs --url <ATTEMPT URL> \
    --out <run>/r<N>-<lens-slug> <FLAGS FOR THIS LENS>
  Viewpoints = viewports, scroll steps, interaction states. Zoom levels = full frames, detail
  crops, element crops, browser zoom.
  art direction: --viewports 1920x1080,1440x900,390x844 --steps 6 --crop <x,y,w,h> --selector <css>
  content & UX:  --steps 8 --interact --click <primary CTA selector>
  motion:        --frames 6 --video --interact   (one viewport is enough; the shared capture has the rest)
  responsive:    --viewports 1920x1080,1280x720,390x844 --page-zoom 200 --interact, then a SECOND
                 pass with its own folder: --reduced-motion --out <run>/r<N>-<lens-slug>-rm
ERRORS: console errors / uncaught exceptions; failed or 4xx/5xx requests for the build's own
assets; a promised state that is broken or missing (click does nothing, fallback never
appears); horizontal overflow or clipped text; overlapping UI; unreadable contrast; a layout
broken at any tested viewport or at 200% zoom; a keyboard trap you confirmed (the camera's
keyboard-trap flag is only a lead: a modal that Escape closes is fine); a dead page (not loaded).
```

**3D / WebGL**
```
EVIDENCE: the web block above, plus --expect-webgl, a long --wait (8000-20000) and --settle,
--frames 6 --video, and --crop on materials, edges and text over 3D. Viewpoints add the camera
angles the scene offers (drag / --hover / --click states); zoom levels add material and
silhouette crops. A one-screen page is labelled "wheel-driven (scroll journey or camera zoom —
compare w01 vs s00)":
  - scroll journey (igloo-like virtual scroll): a big --wheel (3000+).
  - OrbitControls scene: the wheel ZOOMS the camera, so big wheel steps end inside a blur.
    Use a small --wheel (e.g. 240) or --steps 1; the flag wheel-detail-loss warns you.
This flag set is slow (3+ min for three viewports): Bash timeout 600000 is mandatory.
ERRORS: everything in the web block, plus a blank or black canvas you confirmed (the camera's
blank-canvas flag is only a lead: a deliberate dark fade is fine), WebGL unavailable where 3D
is promised, a scene that never leaves its loader, z-fighting or missing textures visible in
a shot, a frame rate so low the video stutters on idle (confirmed in the shared capture).
```

**Game**
```
EVIDENCE: Unreal: unreal_status, then unreal_play and unreal_screenshot from several camera
positions and play states (spawn, mid-play, fail, win/end, pause/menu); read unreal_editor_log;
play the packaged build if one exists. Web game: the camera with --interact, --click <start>,
--frames 6 --video. Viewpoints = cameras and play states; zoom levels = wide shot, HUD/UI crop,
asset close-up. Write a short play log: controls tried, what happened, how it felt.
ERRORS: crash, hang or failed build/package; errors in the editor/runtime log; a softlock or
unwinnable state; controls that do nothing; missing or pink/placeholder assets; HUD clipped or
overlapping; frame rate stutter in normal play.
```

**Writing (essay, article, doc, research)**
```
EVIDENCE: read the work and the bar cold, three times, as three readers: a first-time reader,
a domain expert, a skeptic. Zoom levels = whole (arc, argument, does the ending pay off),
section (structure, transitions, each section's job), line (sentences, word choice, facts).
Check every factual claim, number, quote and link (fetch the links). Save notes per reader and
per level to <run>/r<N>-<lens-slug>/notes-*.md and cite them by file and line/paragraph.
ERRORS: a factual error; a misquote or wrong attribution; a broken link or citation; a claim
contradicted elsewhere in the text; missing required sections; spelling or grammar errors.
```

**CLI / API / library**
```
EVIDENCE: run the work on the shared inputs in <run>/bar/inputs/ and diff against the bar's saved
outputs. For a NEW edge case, run the bar on it too and save both (the §1 exception). Viewpoints
= new user (--help, first command, a typo), power user (flags, piping, big input), script/CI
caller (exit codes, stdout vs stderr, machine-readable output). Zoom levels = whole session,
one command's output, one edge case (empty input, huge input, unicode, bad path, no network).
Run the test suite. Save transcripts to <run>/r<N>-<lens-slug>/.
ERRORS: a crash or unhandled exception; wrong output; wrong exit code; a failing test; an
example in the docs that does not run; a documented flag that does not exist.
```

**Skill / prompt**
```
EVIDENCE: trace an agent following it cold: walk every step as written, as (1) an agent with
no context, (2) the user triggering it, (3) a reviewer. Zoom levels = whole flow (does it get
from trigger to deliverable), one step (is it actionable), one line (every command, path, flag,
tool name, API and link). Actually run every command and script (--help at least), check every
path exists, fetch every link, confirm every named tool/API exists. Save a trace log.
ERRORS: a command, script, path, tool or API that does not exist or fails; a broken link; two
instructions that contradict each other; a step an agent cannot act on; a required input never
defined.
```

## 3. Aggregate (orchestrator)

```
Round <N>: <lens A> 7.9 · <lens B> 8.8 · <lens C> 8.9 · <lens D> 9.0
Overall 8.7 (low: <lens A> 7.9) · errors: 1 (first-party + confirmed third-party for camera runs) · FAIL (errors: 1)
Top issues: 1. <from lens A, the lens under 8.0> 2. <regression> 3. <highest severity x gap>
```
Rules: round the mean to one decimal FIRST, round half up (8.55 → 8.6, 8.549 → 8.5); PASS
needs that rounded value ≥ 8.6 and zero errors. The only FAIL reasons are "mean not over 8.5"
and "errors: N". A lens under 8.0 never fails the round by itself; it supplies issue #1
(several under 8.0: lowest lens first), then regressions, then severity × gap below 8.5;
equal lens scores: higher severity first. Errors never include the bar's.

**Not loaded.** A critic whose camera reports `stats.loaded: false` (exit 1) returns
`score: null` plus the navigation error, and is never scored. The orchestrator first checks
whether the build itself is down: if it is, that is a build error, and the round FAILS and
counts. Otherwise it is a setup problem (wrong URL, server not started): fix the setup and
rerun that lens only. A void rerun does NOT consume a retry round.

## 4. Builder brief (one per cluster, all spawned in one message)

```
You are a BUILDER in a gauntlet loop, round <N> fixes. Fix the issues below. Do not score
or grade your own work; a separate panel does that.

Goal: <GOAL>. Quality bar: <BAR> (level of craft to reach, not a look to copy).
Your cluster: <CLUSTER NAME>.
You OWN ONLY these files (edit nothing else): <absolute paths>
<If isolation: "worktree": commit your changes on your branch before you finish; uncommitted
 work is lost.>

Ranked issues for your cluster (evidence files are in <run>/r<N>-*):
1. [<severity>] <what> — where: <where> — evidence: <file> — bar does: <...> — hint: <...>
2. ...

Errors to eliminate: <first-party errors in your files, with evidence>

STRENGTHS TO KEEP (these must still be true after your change):
- <strength>
- <strength>

When done, reply with a short list of what you changed per issue and anything you could not
fix and why. Do not claim a score.
```

## 5. Paste-ready prompt (self-contained, for another session)

Fill every `<PASTE ...>` from §2 so the prompt stands alone.

```
ultracode

Goal: <GOAL, one sentence>.

Quality bar: <NAMED BAR> — <URL / repo / how to fetch it>. It is real and it sets the level
of craft to BEAT (not a look to copy). Capture its evidence ONCE into <run>/bar before judging.

Build a first complete attempt. Then run the gauntlet. The rule: after each completed
attempt, a separate critic agent takes its own screenshots from several viewpoints and zoom
levels and scores the design and aesthetics from 0 to 10. Over 8.5 means AAA quality. A pass
is over 8.5 with zero errors. Below that, the builder gets the ranked issue list and tries
again up to four rounds.

EVIDENCE (medium: <MEDIUM>): <PASTE THE EVIDENCE BLOCK FOR THIS MEDIUM FROM §2b>
If the work has a URL, the camera is:
node C:/Users/honey/.claude/skills/gauntlet-loop/scripts/critic-shots.mjs --url <url> --out <dir>
[--viewports ... --steps N --frames N --video --interact --page-zoom 200 --crop x,y,w,h
--selector css] (writes shots + report.json; exit 1 / stats.loaded:false = no evidence, never
score; exit 3 / stats.partial = judge what was shot). Runs take minutes: always call Bash with
timeout 600000 or run_in_background. Each round, the orchestrator first shoots ONE shared
capture into <run>/r<N>/shared; every critic reads it AND runs its own targeted capture.
Not loaded: the critic returns score null + the navigation error; if the build is down the
round FAILS and counts, otherwise fix the setup and rerun that lens (a void rerun does not
use a retry round).

CRITIC PANEL: <3-5 lenses>. Each lens is a separate fresh critic agent (all spawned in one
message) that gathers its OWN evidence as above, reads the bar evidence from <run>/bar, and
scores 0-10 to one decimal. The bar is the 9-10 anchor; every deduction needs an evidence
file; ties go to the bar. Critics never see effort, the builder, or earlier scores. From
round 2, they get last round's strengths_to_keep as things that must still be true and flag
any regression as high severity. Critic output: <PASTE THE JSON SHAPE FROM §2a>

ERRORS (binary, any one blocks): <PASTE THE ERRORS BLOCK FOR THIS MEDIUM FROM §2b>
Only the build's errors count (for camera runs: first-party, plus third-party ones a critic
shows the build caused); the bar's errors never count.

SCORE: overall = mean of lenses, rounded (half up) to one decimal first, shown with the
lowest lens. PASS = that rounded value ≥ 8.6 AND zero errors; nothing else fails a round. Any
lens under 8.0 is the #1 issue (lowest lens first; ties by severity).

ROUNDS: round 1 = the panel on the first attempt. On a fail, up to four retry rounds
(rounds 2-5): merge critiques into ONE ranked list, split into clusters on disjoint files,
fix with parallel builder agents (each owns its files, gets strengths_to_keep, never
scores), integrate and smoke-test, then a FRESH panel. Stop at the first PASS or after
round 5.

After each round show: round #, each lens score, overall + lowest lens, error count,
PASS/FAIL, top three issues. If round 5 fails, report honestly what is left and what would
close it.
```

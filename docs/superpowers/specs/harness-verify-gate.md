# Harness verify gate — a build is done when it has been checked, not when it says so

**Date:** 2026-11-10
**Status:** approved by the owner 2026-11-10. Not built yet — the plan is `docs/superpowers/plans/harness-verify-gate.md`.
**Phase:** 1 of 5 in the harness upgrade (see "What comes after" at the end).

## What this is

Today a harness build is finished when the agent says it is. `build-jobs.mjs`
marks a job `done` the moment the agent's last message contains a `Repo:`,
`Live:`, `PR:` or `Preview:` line, and App Builder shows "Built" whenever the
thread goes idle after doing anything at all (`phaseOf` in
`src/lib/app-builder/build.ts`). The agent is asked to test its own work, in
prose, and nothing checks that it did.

This spec adds one thing: **the bridge checks the work itself, after the agent
claims to be finished, and the build is only "Built" when those checks pass.**
When they fail, the bridge hands the agent the evidence and the agent repairs
it, a bounded number of times. When the rounds run out, the build is shown as
what it is — built, but failing its checks — with the failing step on screen.

The end goal is the owner's: give the assistant an app idea and get back
something that works, without being the one who finds out it doesn't.

## What it is not (yet)

Phase 1 checks that the app **installs, compiles, passes its own tests, starts,
and that its pages load without errors.** It does not yet know what the app is
*supposed* to do, so it cannot tell that a feature is missing or that a button
does nothing. That needs the build contract (Phase 2) and the click-through
crawl (Phase 4). This phase is the floor those stand on.

## The decisions, and why

**The bridge runs the checks, not the agent.** Considered and rejected: a
stronger "verify before you finish" instruction or skill. That is what exists
now (`app-pipeline` Stage 4), and the builder grading its own work is the
weakness, not the cure. A check the bridge runs cannot be skipped, softened or
reported optimistically.

**It hangs off `turn_end` in `harness.mjs`, not off the Claude SDK's Stop
hook.** The Stop hook was the first idea and it is the wrong place: it exists
only on the Claude adapter, it dies with the SDK child on a bridge restart, and
DeepSeek has no equivalent. `emit()` already watches every `turn_end` for both
adapters (that is where the rate-limit pause lives), and `adapter.say()` already
sends a follow-up to either one. Hooking there gives one code path for Claude,
DeepSeek and unattended runs, and the job file makes it survive a restart.

**The app under test never sees the owner's keys.** `keys.mjs` loads every key
on this PC into the bridge's own environment, and a child process inherits it.
A freshly generated app must not be started with the owner's OpenRouter,
Supabase and Stripe keys in reach. The gate starts every command with a small
allowlisted environment (`PATH`, `SystemRoot`, `TEMP`, `HOME`/`USERPROFILE`
and the like, plus `CI=1` and the `PORT` it chose — not `NODE_ENV`, which each
tool sets for itself, and nothing from `.env.local`). That also turns the owner's
standing rule — *apps must work with no keys set* — into something the gate
proves on every build instead of something the brief asks for. One honest
exception: a worktree of the hub has the repo's `.env.local` **copied into it**
when it is cut, and Next reads that file from disk, as every existing preview
already does. The scrubbed environment fully protects a new project; for a hub
worktree it only keeps the bridge's own process environment out.

**It never installs into a hub worktree.** A hub worktree's `node_modules` is a
junction to the main checkout (the README's "junction that bit"). `npm install`
there writes into the owner's real packages. The gate installs only in a
project folder (`worktree.project`), where the folder owns its own packages.

**It runs only what the thread was already allowed to run.** The gate executes
scripts the agent wrote (`npm run build`, `npm test`). On a thread whose trust
level lets it run commands without asking — trusted, auto, full, a project, or
unattended — that is nothing new. On a `strict` or `ask` thread it would be a
way around the permission gate, so there it parks **one** card, "Run the checks
on this build", through the existing `gate()`; refused or timed out means the
build is marked unverified, never silently passed.

**The crawl looks, it does not touch.** Phase 1 only navigates: `GET` to
same-origin pages, in a fresh headless context. It never clicks, types or
submits, and it never uses the signed-in profile in `out/browser-profile`.
Clicking is Phase 4, where there is a contract saying what a click should do.

**Three repair rounds, and it stops early when nothing changes.** Each failed
check becomes one message to the agent. If the same set of failures comes back
twice in a row the gate stops rather than spending a third round on a fix that
is not landing. `make-this-better`'s finding applies here too: past two or
three rounds, more change is usually churn.

**The owner can always overrule it.** "Use it anyway" is one press. A gate that
cannot be overruled gets switched off.

## What the gate runs

One function decides the list from what is in the folder, so the same rules are
tested and run. `planChecks({ pkg, names, project, base, has })` returns the
ordered steps and how to start the app:

| Step | Runs when | Command | Counts as failure |
|---|---|---|---|
| `install` | project folder with dependencies and no `node_modules` | the lockfile's manager (`npm ci` / `pnpm install --frozen-lockfile` / `bun install`) | non-zero exit |
| `typecheck` | `tsconfig.json` exists and TypeScript is a dependency | `node node_modules/typescript/bin/tsc --noEmit` — never `npx`, so nothing is downloaded | non-zero exit |
| `lint` | a `lint` script exists | `npm run lint` | **never** — recorded as advice in the report |
| `test` | a `test` script exists | project: `npm run test` (with `CI=1`, so it cannot sit in watch mode). Worktree with vitest: `node node_modules/vitest/vitest.mjs run --changed <base>` — no file names on a command line | non-zero exit |
| `build` | project folder with a `build` script | `npm run build` | non-zero exit |
| `boot` | always | project: `npm run start` on a free port (falls back to `dev` when there is no `start`). Hub worktree: the existing `startPreview` (`scripts/dev-preview.mjs`) | exits early, or does not answer in 3 minutes |
| `crawl` | boot answered | Playwright, below | any page failure, below |
| `live` | the turn printed `Live:` or `Preview:` with an address (`Preview: none` skips it) | one `GET` of that address | not 2xx/3xx; a 401 or a redirect to `vercel.com/sso` fails with the "turn off Vercel Authentication for previews" sentence the `app-builder` skill already uses |

A hub worktree skips `install` and `build` on purpose: a full `next build` of
the hub is minutes of laptop and proves little that typecheck, the related
tests and a live preview do not.

All static steps run even when an earlier one fails, so one repair round can
fix a type error and a failing test together. `boot` and `crawl` are skipped
when `build` failed.

**The crawl.** Start at `/` (plus any `verifyPaths` the thread was started
with — a client edit passes the app's own route). In a **new project**, follow
same-origin `<a href>` links breadth-first, at most 25 pages and 3 levels deep.
In a **worktree of an existing site**, follow no links at all: the hub's home
page links to forty unrelated apps, and an edit must not fail for an error that
was already there. Pages load at 1280 px; the home page is also loaded at
390 px. For each page:

- the document's own status is 400 or above → failure
- an uncaught page error → failure
- a `console.error` → failure (this is where hydration errors show up)
- a same-origin request that fails outright or answers 500 or above → failure
- a same-origin page link or static file that answers 404 → failure
- a 4xx from `/api/*` → **recorded, not failed.** A signed-out `401` is correct
  behaviour, and Phase 1 cannot tell which ones are. Phase 2's contract can.
- at 390 px, the page scrolls sideways → failure (checklist U1)

Two screenshots are kept per run — home at desktop width and at 390 px.

Every step has a ceiling (install and build 10 minutes, tests 10, typecheck 5,
boot 3, crawl 3) and is killed as a tree with the `killTree` that
`harness-preview.mjs` already has. One gate runs at a time across the whole
bridge; a second waits its turn.

## The loop

```
agent's turn ends with a finish line          ─┐
  └─ job.verify = { state: "checking", run: n }│  written to build-jobs.json first
  └─ run the steps, emit progress              │
       ├─ all pass  → verify.state = "passed"  → job.status = "done"
       └─ any fail  → rounds < 3 and not the same failures as last time?
              ├─ yes → say(repairPrompt(report)) → agent works → turn ends → again
              └─ no  → verify.state = "failed" → job.status = "unverified"
```

- **When it runs.** On a `turn_end` with no error, on a `durable` thread
  (App Builder builds and Client Review edits; `verify: "off"` switches it off;
  an ordinary chat thread is never checked) when the turn's text contains a
  finish line. A turn
  that ends *without* a finish line has not claimed anything, so nothing is
  checked and the build is not "Built" either (see the page states below).
- **The repair message** names each failure with its step, what was run, the
  page it happened on, and the tail of the output (at most 1,200 characters
  each, at most 8 failures, the rest counted). It says to fix the cause, not to
  delete or weaken a test to get past it, and to end with the same finish lines
  again when done.
- **A restart mid-check re-runs the check.** On resume, a job whose
  `verify.state` is `"checking"` goes straight back into the gate. It does not
  get `resumePrompt`, because the agent had already finished its turn.
- **A rate limit during repair** is already handled: the repair turn ends on
  the limit, the existing pause-and-retry sends `resumePrompt`, and the next
  finish line triggers the gate again.

## What is recorded

`out/verify/<thread id>/<run>/report.json`, beside the bridge and never in the
repo, with the two screenshots:

```json
{
  "run": 2, "startedAt": 0, "ms": 0, "passed": false,
  "steps":   [{ "id": "typecheck", "ok": true, "skipped": false, "ms": 0, "tail": "" }],
  "pages":   [{ "url": "/", "status": 200, "errors": [] }],
  "advice":  ["lint: 3 warnings"],
  "failures":[{ "id": "crawl:/settings:pageerror", "step": "crawl", "title": "…", "evidence": "…" }]
}
```

A failure's `id` is its fingerprint: the step, the page, and a hash of the
evidence with paths, timestamps and standalone numbers flattened (an error code
such as `TS2322` is kept — it is the error). Comparing the set of ids between
two runs is how "nothing changed" is detected.

Three new event kinds go through the same ring and into the job's record:
`verify_start` `{run}`, `verify_step` `{id, ok, ms}`, `verify_end`
`{run, passed, failures}`. The page does not fold them — it reads
`summary.verify`, which rides every poll already — so `model.ts` is untouched.
Each verdict is also said as a plain `note`, so the existing Harness console
shows it with no change.

## What the owner sees

`summary()` gains `verify: { state, run, rounds, failures, report } | null`, and
`ThreadSummary` in `src/lib/new-jarvis/harness/types.ts` gains the same field.
`phaseOf` in `build.ts` gets three new phases and one changed rule:

| Phase | Label | When |
|---|---|---|
| `checking` | "Checking it works" | `verify.state === "checking"` |
| `working` (unchanged) | "Fixing what the checks found (round 2 of 3)" | busy, and `verify.rounds > 0` |
| `unverified` | "Built, but the checks are failing" | `verify.state === "failed"` |
| `unfinished` | "Stopped before it finished" | verify is on, the thread is idle, and its last turn printed no finish line — it asked something or gave up; its last words are shown |
| `done` | "Built" | **only** `verify.state` is `"passed"` or `"accepted"`, or the thread was started with verify off |

Under an `unverified` build the panel lists the failing steps in plain words
with the two screenshots, and offers **Check again** and **Use it anyway**.
`useAppBuilder` saves a build's repository and live address only on
`phase === "done"`, and the steps after it (moving the app into the hub, for
one) read that saved record — so an unverified build stops there with no
further change.

**The agent is told the check is coming.** `buildBrief`'s `<finish>` block and
the client-edit prompt in `autoBuild.ts` each gain one sentence: after the last
message the PC checks the build itself and sends back whatever fails. Without
it, a repair message reads to the agent like a new, unrelated request.

Three routes, all behind the token like every other harness route:

- `POST /harness/verify` `{id}` — run the gate now (Check again)
- `POST /harness/verify/report` `{id}` — the latest report
- `POST /harness/verify/accept` `{id}` — the owner's "Use it anyway"; sets
  `verify.state = "accepted"` and the job `done`, recorded with a note

## Unattended agents

A 24/7 agent with `SHIP: auto` currently lands and pushes when its turn ends.
With the gate, `agents-wake.mjs` asks the bridge for **one check**
(`POST /harness/verify`) once everything else would have let the run ship, and
waits for `verify.state` to settle. **`auto` falls back to `review` unless it
is `"passed"`** — one more reason beside the three it already has (timed out,
marked blocked, dirty checkout) — and the run's recorded outcome names the
failing checks. There are no repair rounds here in Phase 1: nobody is watching,
and a `review` hand-back is the honest result.

## Files

| File | Change |
|---|---|
| `tools/jarvis-bridge/harness-verify.mjs` | **new** — the pure rules: `planChecks`, `scrubEnv`, `fingerprint`, `afterRun`, `repairPrompt`, `judgeResponse` |
| `tools/jarvis-bridge/harness-verify-run.mjs` | **new** — the side effects: run a step, start the app, crawl it, check the live address, write the report |
| `tools/jarvis-bridge/harness-verify-loop.mjs` | **new** — the loop: queue, permission card, decide, repair or stop, accept |
| `tools/jarvis-bridge/harness-verify*.test.mjs` | **new** — one test file per module |
| `tools/jarvis-bridge/fixtures/verify/{clean,build-fails,page-throws,dead-link,prints-env,static}/` | **new** — tiny apps whose `build` and `start` are plain `node` scripts, so the tests need no install and no Next |
| `tools/jarvis-bridge/harness.mjs` | the `turn_end` hook in `emit`, `verify` in `summary()`, the three handlers, re-run on resume |
| `tools/jarvis-bridge/build-jobs.mjs` | `verify` on the job; a finish line sets `claimed` instead of `done` when verify is on; `unverified` status (not resumable) |
| `tools/jarvis-bridge/harness-preview.mjs` | export `killTree`; nothing else |
| `tools/jarvis-bridge/server.mjs` | the three routes |
| `tools/jarvis-bridge/agents-wake.mjs` | one check before `SHIP: auto`; `auto` needs a pass |
| `src/lib/new-jarvis/harness/types.ts` | `VerifySummary` and `ThreadSummary.verify` |
| `src/lib/app-builder/build.ts` (+ `build.test.ts`) | the three phases, the changed `done` rule, `phaseLabel`, one sentence in `<finish>` |
| `src/lib/client-review/autoBuild.ts`, `liveBuild.ts` | the same sentence and `verifyPaths` in the client-edit start; `finishOf` knows the new phases |
| `src/lib/app-builder/useBuild.ts` | Check again, Use it anyway, loading the report |
| `src/components/app-builder/` (`BuildStatus`, `MoveIntoHub`, `Blueprint`, `AppBuilder`, css) | the failing-steps list, the two screenshots, the two buttons, the new phases |
| `tools/jarvis-bridge/README.md`, the `jarvis-harness` skill | a section each |

No new dependency: Playwright is already in `tools/jarvis-bridge/package.json`.

## How we will know it works

Each of these is a test or a thing a person can watch, not an opinion:

1. The `build-fails` fixture cannot reach "Built": the gate fails it on `build`
   with the compiler's own error as evidence, and does not try to start it.
   (test — the fixture fails at `build` rather than `typecheck` so the tests
   need no TypeScript install; the real typecheck step is seen in 8.)
2. The `page-throws` fixture fails `crawl`, and the report names the page. (test)
3. The `dead-link` fixture fails `crawl` on the 404. (test)
4. The `clean` fixture passes, the job becomes `done` only then, and a report
   and two screenshots exist on disk. (test)
5. The `prints-env` fixture's page lists the variable names it can see; none of
   the names `/health` reports as the owner's keys appear. (test)
6. The same failures two checks in a row stop the loop after the second
   check, with one repair message sent, not three. (test, with a stub gate)
7. Killing the bridge during a check and starting it again re-runs the check
   and sends no brief. (test on the job store + one manual run)
8. One real App Builder build on Claude and one on DeepSeek each show the
   *Checking it works* phase and a report. (manual, on this PC)
9. A hub worktree thread never runs `npm install`. (test on `planChecks`)

## Checklist codes this closes

R1 (never a white or broken page — a page that throws now fails the build), R4
(works with no key, proven by the scrubbed environment), U1 (fits a phone, by
the 390 px load), O1 (typecheck and tests pass before every deploy — checked by
the bridge instead of promised by the agent).

## Defaults chosen here — say if any should change

- Repair rounds: **3**, stopping at 2 when nothing changed.
- Lint: **advice only**. It never fails a build.
- Hub worktrees: **no full `next build`**; typecheck, related tests and a live
  preview instead.
- Verify is **on** for App Builder builds, Client Review edits and unattended
  agents, **off** for an ordinary Harness chat thread unless asked for.
- **One off switch for all of it:** a file named `verify-off` in
  `tools/jarvis-bridge/out/`, like `agents-off`. While it exists, builds finish
  on their own word as before and the 24/7 runner ships unchecked. The gate is
  built with this file in place — the live helper runs from the folder it is
  edited in, so a restart mid-build must not switch a half-built gate on — and
  it is deleted only at the first supervised run.

## A limit worth knowing

The brief tells the agent to deploy and then print `Live:`, and the gate runs
after that line. So a build that fails its checks may already be at a public
address. Phase 1 does not reorder that: it stops the build being called
"Built", being saved as the app's result, and being auto-landed — it does not
un-deploy anything. Moving the deploy to after a pass belongs with Phase 2,
when the brief is restructured around the contract anyway.

The same holds, more sharply, for a Client Review edit: its prompt
(`autoBuild.ts`) tells the agent to **merge its own pull request** before it
prints `PR:`/`Preview:`. For those, the gate stops the preview being published
to the client; it does not stop the merge. Whether edits should wait for a pass
before merging is the owner's call and is not changed here.

## What is not known yet

- How long the gate takes on this laptop. Nothing was measured; the ceilings
  above are limits, not estimates. The first real builds should record `ms` per
  step so the ceilings can be tightened.
- Whether `npx tsc --noEmit` on a hub worktree is quick enough to run on every
  client edit. If it is not, the hub's step becomes the related tests plus the
  preview crawl.
- How noisy `console.error` is on real generated apps (third-party scripts,
  dev-only warnings). If it produces false failures, the rule narrows to errors
  raised by same-origin scripts.

## What comes after

| Phase | Adds | Where the idea comes from |
|---|---|---|
| 2 | The build contract and ledger: features, click-through flows, pages, API, tables and access rules, ordered tasks — and acceptance specs written from it by a verifier the builder cannot edit | MetaGPT's PRD → design → task schemas; OpenHands' rule that builders do not edit verify specs |
| 3 | Stuck detection on the event ring and a spend ceiling per build | OpenHands' stuck detector; MetaGPT's duplicate-response guard |
| 4 | The click-through crawl (controls that do nothing), API and database probes, unwired-code detection | super-qa's route crawl; `knip` |
| 5 | A different model for the verifier than for the builder | OpenHands' goal judge |

Each phase plugs into the gate built here: a new step in `planChecks`, a new
kind of failure in the same report, the same repair loop.

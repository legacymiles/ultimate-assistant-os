---
name: software-factory
description: The owner's way to run super-board (github.com/EricTechPro/super-board) — the GitHub Project board where cards flow Backlog → Ready → Build → QA → Review → Done as merged PRs — with Felix built in (every card states its end goal and outside judges before it's built, and every run ends with the next rung proposed) and the owner's safe defaults (a human approves every merge, cards land in Backlog, Jarvis's logged errors become bug cards). Use when the user says "software factory", "the board", "super board", "send to board", "put this on the board", "run the board", "let agents build the backlog", "pro team", or wants a pro team to tie up a project's loose ends. Nicknames: software factory, the factory, the board, super board, Jarvis Factory, pro team, dev team, send to board.
license: MIT
metadata:
  author: legacymiles
  category: Build & Ship, Planning
  nicknames: software factory, the factory, the board, super board, Jarvis Factory, pro team, dev team, send to board
  built-in: felix
  upstream: https://github.com/EricTechPro/super-board (MIT, by Eric Tech)
---

# Software factory (super-board, the owner's way, Felix built in)

super-board turns a GitHub Project into a dev team: an orchestrator plans waves, a **Builder**
opens a PR in a worktree, a **Tester** gathers evidence (screenshots, logs, test reruns) or
bounces the card, a **Reviewer** re-runs the tests, checks the diff adversarially and merges —
or hands to a human. The board is the only state, so a run survives restarts.

This skill is the entry point: it gets super-board installed and set up right, makes sure every
card is worth building (the Felix gate), runs the board, and closes each run by proposing the
next rung (the Felix review). The raw super-board skills (`/super-board`, `/super-build`,
`/super-qa`, `/super-review`, `/super-collect`, `/ui-refine-loop`, `/visual`, `/git-sync`) live
in a project's `.claude/skills/` and are what this one calls.

## The owner's defaults — always

- **A human approves every merge**: `human_approves_merge: true` and
  `merge_policy.default: "human"`. Only the owner may change this, by saying so.
- **No auto-merge to production**: `allow_auto_on_production: false`.
- **Money, auth and destructive-schema changes always go to the owner** (`always_human`); in the
  Jarvis hub `middleware.ts`, `appGate.ts` and the vault count as auth.
- **New cards land in Backlog.** The owner moves cards to Ready; nothing builds on its own.
- **Logged errors are a bug source**: the hub's `/api/site-errors/feed` is wired as a
  super-collect custom source (`jarvis-errors`, bearer token `JARVIS_ERRORS_TOKEN`), so crashes
  on the hub and on client sites that carry `jarvis-errors.js` become verified Backlog cards.
- Never `--protect-main` here: the owner wants Claude to push its own work to main.

## Felix, built in

Felix (the `felix` skill) is the "what is this for, and how will we know" layer. Here it does
three jobs; its core is written out below so this skill never runs without it.

### 1. Writing a card — the end goal first

Every card states, in super-board's ticket format:

- **Problem**: the end goal it serves, from the user's side — and the goal beyond it.
- **The user's features, the user's way** in Fix — kept as asked; the bar is raised around them.
- **Acceptance Criteria**: 2–5 outside judges — a test that fails first then passes, a
  measurement, a person completing the task, a logged-error count. Never "works well".
- **Checklist**: the website backend checklist lines it closes (felix ›
  `references/website-backend-checklist.md`), e.g. R2, U1.
- One card per PR under ~400 changed lines; a bigger plan is split into a ladder of cards.

### 2. The Felix gate — before anything moves to Ready

Run `/super-board lint`, then hold every Ready candidate to the gate. A card **fails** if it
has no end goal in Problem, fewer than two checkable criteria, a criterion nobody outside the
model could check, or (for anything users touch) no checklist line. For each failing card,
rewrite it with Felix's Depth questions — what would a top professional do here, from what raw
material, with which tools, judged by what — show the owner the exact edit, and save only what
they approve. Cards stay in Backlog until they pass; agents never spend tokens on a vague card.

### 3. The Felix review — after a run, propose the next rung

When the board drains (or a run stops), look at what shipped and ask Felix's Altitude question:
*what's the goal beyond the goal?* Propose up to three next-rung cards — "fix the cause, not the
instance", then "make it keep itself right" — using real evidence only: open crashes in the
`jarvis-errors` feed, unfinished rows in Jarvis › In Queue, bounced cards and their review
findings, Improvements ideas. File them to **Backlog** with their evidence, never to Ready. This
is the self-improving loop: shipped work → logged reality → the next, higher card.

Felix's Range applies to the lanes too: when a card touches auth, payments or personal data, ask
super-review for a security pass; when it is UI, have super-qa capture phone (390 px) and
desktop shots and run `/ui-refine-loop` if the owner wants polish.

## Where it can run

super-board talks to GitHub Projects through GraphQL, and **cloud Claude Code sessions block
GitHub GraphQL**. Run the board from Claude Code on the owner's PC or VPS (both Windows):

- Needs: Git for Windows (its Git Bash provides `bash` 5), `gh` logged in with the `project`
  scope, `jq`, Python 3, Node. In the Jarvis hub, `scripts/super-board-setup.ps1` installs and
  checks all of it and creates the board in one go.
- In a cloud session you can still write Felix cards and file them as GitHub issues through the
  REST API (Jarvis's "Send to board" does this); the PC/VPS run picks them up.

## Steps

1. **Is it installed?** Look for `.claude/skills/super-board/SKILL.md` in the project.
   - The Jarvis hub (`legacymiles/ultimate-assistant-os`) already has it committed, plus its
     config at `.claude/super-board/configs/ultimate-assistant-os.json`.
   - Otherwise: `git clone --depth 1 https://github.com/EricTechPro/super-board /tmp/super-board
     && bash /tmp/super-board/install.sh <project-dir>` (on Windows from Git Bash). Add hooks
     unless the project has its own `.claude/settings.json` to protect.
2. **Is there a board?** If the config's `project.number` is `0`, create one with the columns
   Backlog, Ready, Building, QA, Review, Blocked, Done (in the hub:
   `powershell -ExecutionPolicy Bypass -File scripts\super-board-setup.ps1`, which writes the
   number back into the config).
3. **Onboard once**: `/super-board onboard`, answering with the defaults above.
4. **Fill the board**: `/super-collect` files Backlog cards from GitHub issues, PRs and the
   `jarvis-errors` feed; Jarvis's "Send to board" adds Felix cards from Goal check, Improvements,
   In Queue and Site errors.
5. **Felix gate** (above), then the owner moves the cards they want to Ready.
6. **Run**: `/super-board run <slug>`. Check with `/super-board status`; stop gracefully with
   `/super-board stop`.
7. **Felix review** (above).
8. **Report** in plain words: what merged, what's waiting for the owner's approval, what bounced
   and why, and the next-rung cards proposed.

## Card template

```markdown
Title: <emoji> [<kind>] <scope>: <what>      (≤ 70 chars, e.g. ✨ [feature] deck: In Queue widget)

## Problem
<the end goal it serves, from the user's side, 1–3 sentences>
Goal beyond the goal: <the next rung>

## Context
- **Where:** <page>, `<route>`
- **Who:** <who sees it>
- **Checklist:** <backend-checklist line(s) this closes, e.g. R2, U1>

## Fix
<the intended change in 1–3 lines, keeping the user's features as they described them>

## Acceptance Criteria
- [ ] <checkable outcome a test or measurement can assert>
- [ ] <…2–5 total; never "works well" or "is fast">

## Risk
🟢 **Low** · <one line>

## Blocked by
- None.
```

Labels: the kind (`bug`, `feature`, `ux`, `tests`, `docs`, `tech-debt`) plus `felix`; add
`money`, `auth` or `schema` when it touches those, so the merge goes to the owner.

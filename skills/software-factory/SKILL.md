---
name: software-factory
description: Installs and runs super-board (github.com/EricTechPro/super-board) — the autonomous GitHub Project board where cards flow Backlog → Ready → Build → QA → Review → Done as merged PRs — on any of the owner's projects, with the owner's safe defaults (a human approves every merge, Felix-style tickets, Jarvis's logged errors as a bug source). Use when the user says "software factory", "super board", "super-board", "put this on the board", "send to build", "run the board", "let agents build the backlog", or wants a pro team to tie up a project's loose ends.
license: MIT
metadata:
  author: legacymiles
  upstream: https://github.com/EricTechPro/super-board (MIT, by Eric Tech)
---

# Software factory (super-board, the owner's way)

super-board turns a GitHub Project into a dev team: an orchestrator plans waves, a **Builder**
opens a PR in a worktree, a **Tester** gathers evidence (screenshots, logs, test reruns) or
bounces the card, a **Reviewer** re-runs the tests, checks the diff adversarially and merges —
or hands to a human. The board is the only state, so a run survives restarts.

This skill wraps it with the owner's defaults. The full super-board skill set (super-board,
super-build, super-qa, super-review, super-collect, ui-refine-loop, visual, git-sync) lives in a
project's `.claude/` once installed; this skill gets it there and sets it up right.

## The owner's defaults — always

- **A human approves every merge**: `human_approves_merge: true` and
  `merge_policy.default: "human"`. Only the owner may change this, by saying so.
- **No auto-merge to production**: `allow_auto_on_production: false`.
- **Money, auth and destructive-schema changes always go to the owner** (`always_human`), and
  for the Jarvis hub `middleware.ts`, `appGate.ts` and the vault count as auth.
- **New cards land in Backlog.** The owner moves cards to Ready; nothing builds on its own.
- **Tickets are written the Felix way** (see the `felix` skill): the end goal in Problem, the
  outside judges as 2–5 checkable Acceptance Criteria, the backend-checklist line it closes, a
  type label, one card per PR under ~400 changed lines.
- **Logged errors are a bug source**: the hub's `/api/site-errors/feed` feed is wired
  as a super-collect custom source (`jarvis-errors`, bearer token `JARVIS_ERRORS_TOKEN`), so
  crashes on the hub and on client sites that carry `jarvis-errors.js` become verified Backlog
  cards.
- Never `--protect-main` here: the owner wants Claude to push its own work to main.

## Where it can run

super-board talks to GitHub Projects through GraphQL, and **cloud Claude Code sessions block
GitHub GraphQL**. Run the board from Claude Code on the owner's PC or VPS (both Windows):

- Needs: Git for Windows (its Git Bash provides `bash` 5), `gh` logged in with the `project`
  scope, `jq`, Python 3, Node. In the Jarvis hub, `scripts/super-board-setup.ps1` installs and
  checks all of it and creates the board in one go.
- In a cloud session, you can still write tickets (Felix format) and file them as GitHub issues
  through the REST API; the PC/VPS run picks them up.

## Steps

1. **Is it installed?** Look for `.claude/skills/super-board/SKILL.md` in the project.
   - The Jarvis hub (`legacymiles/ultimate-assistant-os`) already has it committed, plus its
     config at `.claude/super-board/configs/ultimate-assistant-os.json`.
   - Otherwise install it: `git clone --depth 1 https://github.com/EricTechPro/super-board
     /tmp/super-board && bash /tmp/super-board/install.sh <project-dir>` (on Windows run it from
     Git Bash). Add hooks unless the project has its own `.claude/settings.json` to protect.
2. **Is there a board?** If the config's `project.number` is `0`, create one with the columns
   Backlog, Ready, Building, QA, Review, Blocked, Done (in the hub: run
   `powershell -ExecutionPolicy Bypass -File scripts\super-board-setup.ps1`, which writes the
   number back into the config).
3. **Onboard once**: `/super-board onboard`. Answer with the defaults above; it writes
   AGENTS.md, the issue-tracker doc and the pre-flight file.
4. **Fill the board**: `/super-board lint` flags cards with vague criteria before agents spend
   tokens on them. Use Felix to sharpen any card it flags. `super-collect` files Backlog cards
   from GitHub issues, PRs and the `jarvis-errors` feed.
5. **Run**: `/super-board run ultimate-assistant-os` (or the project's slug). Check with
   `/super-board status`; stop gracefully with `/super-board stop`.
6. **Report** to the owner in plain words: what merged, what's waiting for their approval, what
   bounced and why.

## Writing a card (when the owner says "send this to the board")

```markdown
Title: <emoji> [<kind>] <scope>: <what>      (≤ 70 chars, e.g. ✨ [feature] deck: In Queue widget)

## Problem
<the end goal it serves, from the user's side, 1–3 sentences>

## Context
- **Where:** <page>, `<route>`
- **Who:** <who sees it>
- **Checklist:** <backend-checklist line(s) this closes, e.g. R2, U1>

## Fix
<the intended change in 1–3 lines>

## Acceptance Criteria
- [ ] <checkable outcome a test or measurement can assert>
- [ ] <…2–5 total; never "works well" or "is fast">

## Risk
🟢 **Low** · <one line>

## Blocked by
- None.
```

Labels: the kind (`bug`, `feature`, `ux`, `tests`, `docs`, `tech-debt`) plus `felix` when Felix
wrote it; add `money`, `auth` or `schema` when it touches those, so the merge goes to the owner.

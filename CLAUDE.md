@AGENTS.md

# Claude Code additions

Everything in `AGENTS.md` above applies to you. This part adds only what Claude Code, running
on the owner's PC or VPS, can reach and other AI tools cannot. **Per-app detail is not in this
file:** it lives in `docs/apps/<slug>.md`, which Projects Timeline also shows (see below).

## Where things live — Claude-only

| Need | Go to |
|---|---|
| **What an app or website does, every feature, how it looks, every edit** | **Projects Timeline** (`/apps/projects-timeline`, also Jarvis › Toolbox). Each project shows the repo doc (`docs/apps/<slug>.md`: features with their files, look, code map, owner's rules), the owner's own features and Knowledge Inbox, and the edit log from git. Its **Super Prompt** builds a *Build new*, a *Change it* (redesign / remix / add, with every feature kept) or a *Repo brief* (an `AGENTS.md` for any other repo). Start a redesign or remix there |
| This machine: which local folder holds which branch, which paths are dead | `~/.claude/MAP.md`. **The same repo is checked out several times on different branches; one of them is weeks behind `main`.** |
| What past sessions learned | the `jarvis-memory` connector: `get_router` → `search_memory`; on this PC also `~/.claude/memory/MEMORY.md` (read the index, not the folder) |
| Requests the owner typed for Claude Code | In Queue, through the connector: `queue_list`, `queue_start`, `queue_note`, `queue_complete` (completing removes it), `queue_add`. **When you finish work, check `queue_list` for a request it satisfies and complete it.** How it works: `docs/SYSTEMS.md` › In Queue |
| Video back from the PC for a queue job | `queue_video_link`, then `queue_complete` with `video: true` |
| What a workflow learned last run | `get_findings` before running it, `add_finding` after |
| The owner's skills | `~/.claude/skills/` · copies in this repo's `skills/` · the skill store behind the connector (`get_skill`) |
| super-board | committed under `.claude/` (skills, bin, workflows), config `.claude/super-board/configs/ultimate-assistant-os.json` (`human_approves_merge: true`, cards land in Backlog). Needs GitHub GraphQL: run it from Claude Code on the PC/VPS, not a cloud session. One-time setup `scripts/super-board-setup.ps1` |
| Preview servers | `.claude/launch.json` — one port per app; `node scripts/dev-preview.mjs <port> --no-auth` |
| The AIS-OS kit this structure comes from | `C:\Users\honey\AIS-OS` (clone) · skill `ai-os-dashboard` |

## Skills to use here

- **Every new app or UI gets a design skill, unasked**, before any UI code:
  `interactive-web-studio` is the default for everything, and `impeccable` closes the look pass.
  Say which one is driving the look. Never auto-pick a skill that costs money or renders footage
  (`h3-scroll-world`, `scroll-world`, `scroll-craft`, `imagegen-frontend-*`, `image-to-code-skill`).
  Full rule: the global `~/.claude/CLAUDE.md`.
- Building or changing an app: the `app-pipeline` skill, held to the `website-build-checklist`
  skill (its rules also live in Jarvis › Profile › Backend checklist, `docs/SYSTEMS.md`).
- Felix (`skills/felix`), `prompt-enhancer` and `software-factory` are the "pro team" loop
  (`docs/SYSTEMS.md` › Felix, prompt enhancer, super-board).
- **Creating or changing a skill:** write the complete SKILL.md and save it with the connector's
  `save_skill`. That is the one home every device syncs from (`src/lib/jarvis/server/skills.ts`;
  PC/VPS pull it with `scripts/skill-sync.mjs`). Files under `skills/` alone reach no other device.

## How to work with the owner

- Be direct and concise. Lead with what needs action.
- When a decision is made, offer to log it in `aios/decisions/log.md`.
- After a change to any app: update its `docs/apps/<slug>.md`, run `node scripts/apps-index.mjs`,
  commit as "<App>: <what changed>", then `npm run timeline:log` and commit
  `src/lib/timeline/feature-log.json` with it. Projects Timeline then shows the change by itself.
- Default Shift: for any new task, ask "to what extent could AI be leveraged here?"

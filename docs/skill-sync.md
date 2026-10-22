# Skills everywhere — one home for every skill

Every skill lives in **Jarvis**. Every device reads from it and writes to it, so a skill made
anywhere is never stuck on the device that made it.

```
                       ┌────────────── Jarvis skill store ──────────────┐
phone / claude.ai ──── save_skill (connector) ──▶│  one row per skill:    │──▶ Skills library on the website
any cloud session      list_skills / get_skill ◀─│  SKILL.md + references │
                                                 └───────▲────────┬───────┘
PC  ── Stop hook: push ──────────────────────────────────┘        │
VPS ── SessionStart hook: pull ◀──────────────────────────────────┘
```

| Where you are | What you do | How it reaches everything else |
|---|---|---|
| Claude Code on your **phone**, **claude.ai**, any Claude Code **cloud** session | Ask for a skill. Nothing to install. | The jarvis-memory connector's `save_skill` stores it in Jarvis. |
| Claude Code on your **PC** or **VPS** | Run one setup command once per machine. | Hooks pull every skill at session start and push new/edited ones at the end of a turn. |
| The **Jarvis website** | Nothing. | The Skills library reads the same store, so new skills show up right away. |

## Set up (once per machine, PC and VPS)

The phone needs nothing beyond the memory connector (Jarvis › Memory › *Same memory everywhere*).
For each computer, in the hub folder:

```bash
npm run skills:setup
```

No token to paste: setup reads it from the jarvis-memory connector you already added to Claude Code
on that computer (`~/.claude.json`, user or project scope, or a project's `.mcp.json`) and never prints
it. On a computer without the connector, add it at the end: `npm run skills:setup -- --token <TOKEN>`.

Jarvis › Memory › **Skills everywhere** shows this command with your token filled in, plus a
**Generate** button for a fresh token. The token is the same `JARVIS_MCP_TOKEN` the memory connector
uses: set it in Vercel once, then use it in this command on every machine.

What the command does on that machine:

1. Saves the token and the site address to `~/.claude/jarvis-skill-sync.json`, so every session on
   this machine can reach Jarvis without anything in the shell environment.
2. Merges two hooks into `~/.claude/settings.json`, using **this machine's own** node and script
   paths. Nothing is hand-edited, and it's the same on Windows and Linux:
   - `SessionStart` → `pull`: every skill in Jarvis is on disk before you start.
   - `Stop` → `push`: a skill you made or edited this turn is saved to Jarvis.
3. Checks the token works, then brings the machine and Jarvis level. The **first** run also adds the
   skills already committed in the hub repo's `skills/` folder, so everything you already had lands
   in the one home.

It's safe to re-run. It replaces only its own hooks and keeps everything else in `settings.json`.

## How it stays safe

- **No git, no repo access.** Sync is HTTPS to `/api/jarvis/skills` with the bearer token, the same
  check the memory connector uses.
- **Never loses work.** A local edit you haven't pushed yet is never overwritten by a pull. A newer
  version saved from another device (say, your phone) is never overwritten by a push; it's pulled
  first.
- **Idle is free.** When nothing changed locally since the last sync, the end-of-turn hook makes no
  network call.
- **Nothing escapes the skills folder.** Skill names and reference paths are checked before anything
  touches the disk (`src/lib/jarvis/skillFormat.mjs`), so a skill can only write inside
  `~/.claude/skills/<its-name>/`.
- **Never deletes a skill.** Updating a skill makes its folder match Jarvis's version, so a text
  reference the new version dropped is removed. Images and other assets in the folder are never
  touched.
- **Never blocks a session.** On any error the script reports it and exits 0.

## What travels

`SKILL.md` plus the text files under `references/` (md, txt, json, yaml, csv, html, css, js, ts, py),
each up to 256 KB, and up to 1.5 MB per skill. Images, fonts and rendered media stay on the machine
that has them.

## Skill usage (how often each skill is called)

Jarvis › Skills has a **Usage** filter (Any · Top 10 · Used · Never used), a **Most used** sort, and a
call count on every skill. Calls are counted in three places:

- **Claude Code on the PC/VPS**: a `PostToolUse` hook on the Skill tool and a `UserPromptSubmit`
  hook for a typed `/<skill>` both run `skill-sync.mjs usage` (async, silent). Only the skill's name,
  the time and the tool-use id are sent, never the prompt.
- **The connector**: every `get_skill`.
- **Jarvis Studio**: every chat turn that runs a workflow (`studio:<id>`).

Nothing to set up: `install` writes the usage hooks, and on a machine set up earlier the next `pull`
(the SessionStart hook) adds them by itself and counts that machine's past calls once from its
session transcripts (`usage-backfill`, in the background, once per machine — the server refuses a
second backfill from the same host; `--force` redoes it).

## By hand

```bash
npm run skills:pull     # Jarvis -> this machine
npm run skills:push     # this machine -> Jarvis
npm run skills:sync     # push, then pull
npm run skills:push -- --check   # what would change; changes nothing
npm run skills:push -- --git     # also mirror into the repo's skills/ and commit (optional backup)
```

## Where the pieces are

- `src/lib/jarvis/skillFormat.mjs`: what a skill is, plus the one hash every writer agrees on.
  Shared by the server and the script.
- `src/lib/jarvis/server/skills.ts`: the store. One `jarvis_memories` row per skill (source
  `skill`, key `~/.claude/skills/<name>`). It's searchable in Memory, and the full body lives in
  `meta`.
- `src/app/api/jarvis/memory/mcp`: the connector, with `save_skill`, `list_skills` and `get_skill`.
- `src/app/api/jarvis/skills`: the same store over plain HTTP, for the script.
- `scripts/skill-sync.mjs`: install, pull and push for the PC and VPS, plus the `usage` hook and
  `usage-backfill`.
- `src/lib/skills/usage.ts` (pure, tested) + `src/lib/skills/server/usageStore.ts`: the call counts,
  one `app_state` row (`jarvis:skill-usage`). Written by `/api/jarvis/skills/usage` (token), read by
  `/api/skills/usage` (session) through `useSkillUsage.ts`.

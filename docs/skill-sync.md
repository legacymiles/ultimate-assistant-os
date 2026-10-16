# One skill library, everywhere

A skill you create in a Claude Code session is just a folder in `~/.claude/skills` on **that one
machine**. `scripts/skill-sync.mjs` keeps three places in step so you never copy skills by hand:

```
~/.claude/skills  (this machine)  ──push──▶  hub repo  skills/  ──deploy──▶  Jarvis website
        ▲                                        │
        └────────────────pull────────────────────┘   (every other machine)
```

- **push** mirrors `~/.claude/skills` into the repo's `skills/` folder, commits, and pushes. Vercel
  redeploys and the Skills tab / Toolbox on the deployed hub shows the new skill (the scan route
  reads repo `skills/`, the only source that survives a deploy).
- **pull** does `git pull` and lays the committed skills back into `~/.claude/skills`, so a skill
  written on the VPS is active in Claude Code on the PC too.

It only ever **adds or updates** — it never deletes a skill, so a mirror can't wipe the source. Only
`SKILL.md` and the text files under `references/` travel; rendered assets and files over 256 KB stay
put (same rule as `sync-skills.mjs`).

## Easiest: one command per machine

In your hub folder, on each machine (PC and VPS, Windows or Linux):

```bash
npm run skills:setup -- --token YOUR_JARVIS_MCP_TOKEN
```

That writes this machine's config (`~/.claude/jarvis-skill-sync.json`) and merges the two hooks
below into `~/.claude/settings.json` with this machine's own resolved paths — nothing hand-edited —
then pulls your skills right away. It's idempotent: re-running replaces only its own hooks and keeps
everything else. Jarvis › Memory › **Skills everywhere** shows the command with your token filled in
and a Generate button for a fresh one. Leave the token off to set it later (`--token` again, or the
`JARVIS_MCP_TOKEN` env var); without a token, skills still sync but aren't written to memory.

## Run it by hand

```bash
node scripts/skill-sync.mjs push     # after writing a skill
node scripts/skill-sync.mjs pull     # to pick up skills made elsewhere
node scripts/skill-sync.mjs sync     # pull then push
node scripts/skill-sync.mjs push --check   # show what would happen, change nothing
```

## Make it automatic (Claude Code hooks)

Add these to your Claude Code settings so every session self-syncs. Put them in the user settings
(`~/.claude/settings.json`) to cover every project, or in this repo's `.claude/settings.json` to
scope them here. Merge into any `hooks` you already have.

**On the PC** (`C:\Users\honey\Projects\ultimate-assistant-os`):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node C:/Users/honey/Projects/ultimate-assistant-os/scripts/skill-sync.mjs pull --quiet" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node C:/Users/honey/Projects/ultimate-assistant-os/scripts/skill-sync.mjs push --quiet" } ] }
    ]
  }
}
```

**On the VPS** (Windows / PowerShell): same JSON, with the path to wherever the hub repo is cloned
on the VPS. The script is plain Node and runs the same on Windows and Linux — only the repo path
differs. Node must be on `PATH`; a `git push` must have credentials configured (you already push
from the PC, so this is usually already true).

`SessionStart → pull` means every new Claude Code session, on any machine, opens with the latest
skills. `Stop → push` means a skill written during a session is committed and deployed when the
turn ends. Both are no-ops when nothing changed, and a hook can never block the session — on any
error the script reports and exits 0.

## Skills in memory

On a `push`, each changed skill is also written into the **shared memory** (the same rows as
Jarvis › Memory, reached by claude.ai and the VPS), so "what skills do I have / is there a skill
for X" is answerable from memory on any surface — one row per skill: `Skill: <name>` + its
description. This needs the memory token the connector already uses:

- `JARVIS_MCP_TOKEN` — same token as the Memory connector. Without it, skills still mirror and
  deploy; only the memory write is skipped (the script says so and carries on).
- `JARVIS_MEMORY_URL` — optional; defaults to the deployed hub
  (`https://ultimate-assistant-os.vercel.app/api/jarvis/memory/mcp`), so the write lands in the one
  shared store whichever machine runs it.

Pass `--no-memory` to skip this step for a run. Writes are de-duplicated server-side, so re-running
`push` on an unchanged skill adds nothing; editing a skill's description writes a fresh row.

## Why "across all sessions"

Claude Code loads skills from `~/.claude/skills` at session start. Once a skill is in the repo,
`pull` puts it there on every machine, so it's discoverable in every session — not just the one
that created it. The deployed Jarvis website reads the same `skills/` folder, so the library you
see in the browser is the same set. (This is the skill layer; the shared **memory** across
claude.ai, the VPS and Jarvis is the separate `/api/jarvis/memory/mcp` setup — see
[[cross-tool-memory]].)

## First-time: adopt a skill that only exists on the VPS

If `rea` (or any skill) was created on the VPS and isn't here yet, run `push` **on the VPS** once.
It lands in the repo and deploys; every other machine gets it on its next `pull`.

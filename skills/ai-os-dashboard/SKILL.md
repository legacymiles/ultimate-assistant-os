---
name: ai-os-dashboard
description: Set up a personal AI Operating System (the AIS-OS "Four Cs" kit — Context, Connections, Capabilities, Cadence) for the user or for someone else, and give them a dashboard of it. Use this WHENEVER someone wants to onboard a person onto an AI OS, "set up my AI OS", "onboard me / onboard my friend", "build a dashboard of my info", organise a Claude Code folder so Claude finds things faster, install or refresh a New Dashboard export, or mentions AIS-OS, Nate Herk's kit, the Four Cs, the Three Ms, /onboard, /audit, /grill-me, /level-up or /link. Runs the 7-question onboarding in chat, writes the Day-1 context files, and produces a profile JSON the hub's New Dashboard app (/apps/new-dashboard) imports.
---

# AI OS Dashboard

Wraps the **AIS-OS kit** (github.com/nateherkai/AIS-OS — MIT, © 2026 Nate Herk; The Four Cs of an AI OS™
and The Three Ms of AI™ are his trademarks — keep the attribution line in anything you generate).
The full kit is cloned at `C:\Users\honey\AIS-OS`; the parts this skill needs are copied into
`reference/` next to this file, so it works even if that clone is gone.

The companion app is **New Dashboard** in the owner's hub (`src/components/new-dashboard/`,
route `/apps/new-dashboard`). It runs the same onboarding as a form, shows the Four Cs, answers
"what should I focus on this week?", and exports the files below. This skill is the chat-side twin:
same questions, same files, same JSON — so a person can be onboarded either way.

## Pick the mode

| The user says | Mode |
|---|---|
| "onboard me / onboard <name> / set up an AI OS for …" | **A. Onboard** |
| "install my export", pastes or points at an `*-ai-os.md` bundle | **B. Install an export** |
| "organise my Claude Code folder", "make it easier for you to find things" | **C. Organise a folder** |
| "audit my AI OS", "level up", "grill me", "link this in" | **D. Kit skills** |

## A. Onboard (in chat)

1. Ask for the person's first name and where their AI OS folder should live (default: a new folder
   they name; for the hub owner it is `aios/` in the hub repo). If it's the hub owner, read
   `aios/` and the memory index first and **offer what you already know as editable suggestions** —
   never ask what you already know, never present a guess as fact.
2. Run the 7 questions **one at a time**, exactly as in `reference/skills/onboard/SKILL.md` Step 2.
   Hard rules from the kit:
   - 7 questions, no Q8.
   - Q2 voice samples must be **pasted** from real writing. If they start typing a sample, stop them
     and ask for a raw paste. This is the one rule you do not bend.
   - Q3: push back on vague priorities — make them name a number, a deadline or a deliverable.
   - Checkpoint each answer into `<folder>/aios-intake.md` as you go.
3. Write the Day-1 file set in one batch (kit Step 3): `context/about-me.md`,
   `context/about-business.md`, `context/priorities.md`, `references/voice.md`, `connections.md`
   (7 domains, all "not yet connected"), `decisions/log.md`, and a `CLAUDE.md` operating manual.
   If files exist, back them up to `archives/intake-<timestamp>/` first. Never overwrite the hub
   repo's root `CLAUDE.md` — it is the hand-kept routing manual; put personal context in `aios/`.
4. Write `<folder>/<name>-ai-os-profile.json` in the schema below and tell them: open New Dashboard
   → **Import** → pick that file, to get the visual dashboard.
5. Close with the kit's three-line screen: Day 1 done / today ask "what should I focus on this week?"
   / Day 2 wire one connection, Day 7 audit. When they ask the focus question, answer only from the
   new files: 3 bullets tied to their priorities, one Monday pick with a reason, and the Default Shift
   question ("to what extent could AI be leveraged here?").

### Profile JSON (what New Dashboard imports)

```json
{
  "name": "Sam",
  "onboarded": true,
  "intake": {
    "q1": "who / what / for whom",
    "q2": ["pasted sample 1", "pasted sample 2"],
    "q3": ["priority 1", "priority 2", "priority 3"],
    "q4": "where money lands", "q5": "where they talk to people",
    "q6": "where notes/docs live", "q7": "what eats the week + where work is tracked"
  },
  "connections": [
    { "domain": "Revenue / Financials", "tool": "Stripe", "mechanism": "not-connected", "lastChecked": "" }
  ],
  "capabilities": [{ "name": "/skill", "trigger": "phrase", "output": "what it makes" }],
  "routines": [{ "name": "Morning brief", "schedule": "Weekdays 7am", "lastRun": "" }],
  "decisions": [{ "date": "2026-09-18", "title": "…", "decision": "…", "why": "…" }]
}
```

Domains, in order: Revenue / Financials, Customer interactions, Calendar, Communication,
Project / task tracking, Meeting intelligence, Knowledge / files. Mechanism is one of
`not-connected | mcp | script | export | key+ref`. Only `name` is required; the importer
(`coerceProfile` in `src/lib/new-dashboard/export.ts`) fills the rest with defaults.

## B. Install an export

New Dashboard → Export → "All files (one .md)" gives one bundle with `<!-- ===== path ===== -->`
markers. Split it with:

```text
node <this-skill>/scripts/install-export.mjs <bundle.md> <target-dir> [--skip CLAUDE.md] [--dry]
```

Run `--dry` first and show the list. For the hub owner the target is the hub repo's `aios/` and
you pass `--skip CLAUDE.md` (root manual is hand-kept; merge any new facts into it by hand instead).
Existing files are backed up to `archives/export-<timestamp>/` automatically.

## C. Organise a Claude Code folder

Goal: any session finds anything in one hop. Follow `reference/EXPANSIONS.md` — flat with good
names beats deep nesting; never add `misc/`, `tmp/`, `notes/`, `inbox/`; never delete — move to
`archives/` (or ask).

1. Survey: top-level listing, `git ls-files` vs untracked, what the project is.
2. Write or update a root `CLAUDE.md` **routing manual**: a "need → go to" table, name mismatches
   (route vs folder), rules that bite, how to work with the owner. Link, don't copy, changing facts.
3. Put personal context in one place (`aios/` or `context/`), never parallel copies.
4. Move clutter (loose screenshots, scratch files) into `docs/…` or `archives/`; `git mv` tracked
   files; grep for references before moving anything.
5. Ask before deleting anything, including regenerable build caches.
6. Log the change in `decisions/log.md`.

## D. Kit skills

The kit's other skills are bundled read-only in `reference/skills/`: `audit` (evidence-based Four-Cs
score, saves dated reports to `audits/`), `grill-me` (one question at a time, checkpoint every answer
to `brainstorms/`), `level-up` (weekly Three Ms interview → one shipped artifact), `link` (add the
smallest route to the operating manual). When asked for one, read its `SKILL.md` (and the files it
links) and follow it, mapping the kit's default paths onto the actual project's routes — in the hub
repo that means `aios/` for context and the root `CLAUDE.md` for routing. After an audit or level-up,
log a decision whose title contains "audit" / "level-up" so New Dashboard's day plan ticks it off.

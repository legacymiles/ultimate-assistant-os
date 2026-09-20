---
name: prompt-architect-skill
description: "Custom skill that interviews a vague idea into an amazing build prompt, then hands off to gauntlet-loop"
metadata: 
  node_type: memory
  type: reference
  originSessionId: bfe65104-6916-4b3a-b678-ae8ceaa53e2f
  modified: 2026-08-14T19:35:42.105Z
---

**prompt-architect** (`~/.claude/skills/prompt-architect/`) — the user's custom skill that turns a vague website/app idea into an amazing, build-ready prompt via a short **adaptive interview** (round 1 ≈3 questions → round 2 ≈2-3 gap-closing follow-ups + a proposed **named quality bar**), then hands off to [[gauntlet-loop-skill]] ("both in sequence": sharpen the prompt, then the emitted prompt's Quality-gate section governs the build). Ecosystem-aware: a skill-router maps the idea's vibe → the user's own design skills (interactive-web-studio / exploded-showcase / webgl-trail-reveal / capcut-design / website-redesigner). A **portable** variant strips personal skill/gauntlet references for shareable prompts.

Principle baked in: it is a **prompt factory, not a builder** — output is a great prompt + gauntlet handoff, because Claude Code + the user's skills is already the best builder.

Canonical build-prompt template lives in `references/build-prompt-template.md` — the single source of truth the OS web surface implements ([[blueprint-app]], the app rebranded to "Prompt Architect" at `/apps/prompt-architect` in [[ultimate-assistant-os-portfolio]]). Design spec: `docs/superpowers/specs/2026-08-13-prompt-architect-design.md`. (An earlier pod-play-connect copy was removed on 2026-08-14 — the OS is the portfolio, not pod-play-connect.)

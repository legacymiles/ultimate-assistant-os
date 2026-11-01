---
name: interactive-web-studio
description: "Custom skill the user built for generating premium, cinematic, interactive Awwwards-level websites"
metadata: 
  node_type: memory
  type: project
  originSessionId: 655c7151-3e98-4d57-b305-556f8e992526
---

The user authored a permanent Claude Code skill **interactive-web-studio** at `~/.claude/skills/interactive-web-studio/` (created 2026-06-28). Purpose: design/build premium, cinematic, highly interactive websites (motion, WebGL/Three.js, GLSL shaders, Lenis smooth scroll, magnetic cursors, scroll-driven storytelling); core ethos "never ship boring."

Structure: lean `SKILL.md` (invent→direct→code workflow + guardrails) + `references/experience-invention.md` (the "Creative Experience Studio Brain" invention playbook — toy mechanics, surprise moments, game-design thinking; merged 2026-07-05), `references/effects-library.md` (copy-paste effect code), `references/tech-stack.md`, `references/art-direction.md`. Shipped with the hand-written description (the auto-optimizer was [[skill-creator-optimizer-blocked]]). Signals the user is into building interactive front-end experiences. Trigger-eval queries kept in the sibling `interactive-web-studio-workspace/`.

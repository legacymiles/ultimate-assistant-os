---
name: blender-to-web-skill
description: "user's universal blender-to-web skill (Blender → GLB → Three.js living hero up to world-class immersive tier); gauntlet-looped 5 rounds 2026-09-18, final 7.9 (fail) then errors fixed"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 35384211-1d54-4b35-8968-5b82e3c9e2c9
  modified: 2026-09-18T18:32:42.800Z
---

Installed 2026-09-18 at `~/.claude/skills/blender-to-web` (from github.com/cth9191/blender-to-web, originally a Codex skill; video walkthrough youtube RhGiG-yZP-c covers the same repo workflow).

- **User wants it universal:** no LUMA / robotic iris / charcoal+yellow defaults. Brand, product, shapes, colors, logo, fonts: Given = locked, Missing = invented. Literal (real product) vs metaphor (sculpture) mode.
- **User's clarification:** igloo.inc = example of top-tier QUALITY only; sites must never look like igloo. Tier 3 is called "world-class / immersive", igloo-tier.md keeps the filename but derives every discipline from the brand.
- Flow: Stage 0 brief → Stage 1 three divergent mockups (STOP) → 2a previs (tier 3, STOP) → Blender build (STOP) → Three.js site → polish → Stage 5 gauntlet via [[gauntlet-loop-skill]].
- Files: SKILL.md, references/brief.md (slots, genres, divergence table, prompts), igloo-tier.md (disciplines, storyboard, scroll/a11y rules), recipes.md (technique code + canonical numbers, ~1600 lines, TOC at top), recipes-world.md (materials bake, interiors, content scene, loader, portrait, fonts, SEO, sound, cursor), scripts/ mockups.mjs (OpenRouter `google/gemini-3.1-flash-image`, verified), bake_lightmap.py (+ --verify-glb runs without Blender), export_camera_path.py, blender_device.py.
- Number-ownership rule: each number in exactly one place (recipes.md technique / recipes-world.md own sections / igloo-tier.md intent+budgets).
- **Gauntlet history:** 6.35 → 7.55 → 8.0 → 8.3 → 7.9 (round 5 technical critic found new rendering bugs). The 6 round-5 errors were fixed afterwards but NOT re-scored. Known open items: no "logo as centerpiece" mode, no Blender-missing preflight, high-key tone mapping/post preset, ambient particles recipe, sound toggle doesn't fade in current scene, reduced-motion loop resize/portrait/crossfade wiring.
- **Blender is not installed on this PC**, so no bpy code in the skill has ever been run; only syntax and GLB verification were tested.

---
name: website-redesigner-skill
description: "user's custom skill that turns a URL into 3 redesign directions + a functionality-preserving build prompt"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 94d9b0e9-9e98-44b4-a1c8-3b5096015019
  modified: 2026-08-08T19:02:06.884Z
---

Custom user skill at `~/.claude/skills/website-redesigner/` (SKILL.md + references/directions.md). Created 2026-08-08.

Given a URL: (1) analyze the page + capture a **functionality inventory** (what every form/button/flow does), (2) propose **3 distinct redesign directions** spanning restrained→expressive→experimental, each driven by one of the user's design skills ([[interactive-web-studio-skill]], capcut-design, [[webgl-trail-reveal-skill]], exploded-showcase) and naming a real "site to beat", (3) output a paste-ready build prompt that rebuilds the site with the new design while keeping functionality identical.

Honest core distinction baked in: **own site** → prompt edits the real source (functionality truly preserved); **any external URL** → front-end reconstruction + behavior spec (their backend can't be reproduced). Pairs with [[gauntlet-loop-skill]] (beat-the-reference-bar loop). references/directions.md has palette/type presets + skill→direction mappings.

Shipped as a live public tool too — see [[redesigner-portfolio-app]].

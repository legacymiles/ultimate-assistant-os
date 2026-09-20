---
name: gauntlet-loop-skill
description: "user's custom gauntlet-loop skill — universal critic PANEL + parallel builder squad, scored 0-10, pass = rounded mean ≥ 8.6 (over 8.5) with zero errors, round 1 + up to 4 retries; critic-shots.mjs camera"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 35384211-1d54-4b35-8968-5b82e3c9e2c9
  modified: 2026-09-18T18:32:33.918Z
---

Custom user skill at `~/.claude/skills/gauntlet-loop/` (SKILL.md, references/templates.md, references/bars.md, scripts/critic-shots.mjs). Originally adapted from github.com/robonuggets/gauntlet-loop; rebuilt 2026-09-18.

**User's rule (keep verbatim):** "After each completed attempt, a separate critic agent takes its own screenshots from several viewpoints and zoom levels and scores the design and aesthetics from 0 to 10. Over 8.5 means AAA quality. A pass is over 8.5 with zero errors. Below that, the builder gets the ranked issue list and tries again up to four rounds." The user also wants the task decomposed into lenses → multiple critic agents in parallel → multiple builder agents fixing disjoint files in parallel.

- **Universal:** any medium (sites, 3D, games, writing, CLI, skills). The user was explicit: igloo.inc was only an example of top-tier QUALITY; the bar is chosen per task/genre and judges craft, never resemblance.
- Precise rules live in SKILL.md: mean rounded half-up to one decimal, lowest lens reported, lens < 8.0 = issue #1, bar errors never count, heuristic flags need confirmation, shared capture per round + each critic's own capture, round 1 + retries 2–5, then honest report.
- `scripts/critic-shots.mjs` (playwright-core installed in the skill folder, uses installed Chrome, real GPU works headless on this PC's RTX 3050): viewports × scroll/wheel steps, detail crops, --page-zoom, --interact, --frames/--video, Tab pass, first/third-party error tagging, --max-ms budget. Long runs need Bash timeout 600000. igloo.inc needs `--wait 20000 --settle 2500 --wheel 3000`.
- **Gotcha:** writing JS/regex patches through a bash heredoc here mangled `\n` escapes; write patch scripts with the Write tool instead.

Used on [[blender-to-web-skill]] (5 rounds, see that note). Siblings: [[interactive-web-studio-skill]], [[webgl-trail-reveal-skill]].

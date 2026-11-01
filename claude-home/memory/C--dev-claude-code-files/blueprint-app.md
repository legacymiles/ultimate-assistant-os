---
name: blueprint-app
description: Prompt Architect app (formerly Blueprint) at /apps/prompt-architect — vague idea → adaptive interview → amazing build prompt + gauntlet handoff
metadata: 
  node_type: memory
  type: project
  originSessionId: 0c8cbeff-8c02-4e5c-8682-7ba90e3fb85c
  modified: 2026-08-14T19:34:28.422Z
---

**RENAMED (2026-08-14): Blueprint → "Prompt Architect".** The page route is now `/apps/prompt-architect` (catalog slug `prompt-architect`); the old `/apps/blueprint` route folder was deleted. Internal code still lives under `src/components/blueprint/` + `src/lib/blueprint/` and the API is still `src/app/api/blueprint/route.ts` (folder names unchanged). The [[ultimate-assistant-os-portfolio]] hub is the home.

**Prompt Architect** is a hub app at `/apps/prompt-architect` (category AI). It takes a rough idea and walks the user through a 4-step flow — Intake → Clarify → editable Overview canvas → Deliverable — producing an optimized Claude Code prompt, an exportable markdown spec, and a one-click **Save to Projects Timeline** (maps core/supporting features onto a real Project + stores the prompt as a `kind:"idea"` Knowledge entry).

Architecture: one route `src/app/api/blueprint/route.ts` dispatches on a `stage` field (`clarify`|`clarify2`|`synthesize`|`prompt`) through the Vercel AI Gateway, each stage with an offline heuristic fallback in `src/lib/blueprint/`. Same pattern as the `regenerate`/`ingest` routes. Design specs: `docs/superpowers/specs/2026-07-11-blueprint-design.md` and the 2026-08-13 Prompt Architect upgrade.

**Prompt Architect upgrade (2026-08-13):** Blueprint is now the web surface of the [[prompt-architect-skill]] methodology. Added: **adaptive round-2 clarify** (in-panel "Go deeper" appends follow-ups + proposes a named **quality bar**); Overview gained `design_direction`, `quality_bar`, `recommended_skills` (a `src/lib/blueprint/skill-router.ts` maps the idea's vibe → the user's design skills); the prompt template gained Design-direction, Recommended-approach, and Quality-gate sections; a **portable toggle** strips personal skill/gauntlet references; a **"Copy for Gauntlet"** tab exports an `ultracode /loop` Builder-vs-Critic handoff (`assembleGauntletHandoff`). Verified end-to-end on the offline path.

**Gotcha:** `.env.local` has no `AI_GATEWAY_API_KEY`, so it runs the **heuristic** path, which produces rough auto-titleized feature names (e.g. "my Coffee Roastery Where People"). Set `AI_GATEWAY_API_KEY` (optionally `AI_MODEL`) for clean AI-written overviews and prompts. The canvas is fully editable regardless.

Related: shares the core/supporting + AnalystResult vocabulary with Projects Timeline. Built with [[interactive-web-studio-skill]]. Implements [[prompt-architect-skill]]; feeds [[gauntlet-loop-skill]]. Lives in [[ultimate-assistant-os-portfolio]] alongside [[website-redesigner-app]].

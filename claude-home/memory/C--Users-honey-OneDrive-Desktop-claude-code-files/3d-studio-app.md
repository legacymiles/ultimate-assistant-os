---
name: 3d-studio-app
description: 3D Studio Video Creator at /apps/3d-studio — AI animation director (prompt → plan → Mixamo/Cascadeur/Blender routing → in-browser animatic + export → Blender render on the PC via tools/studio3d-builder + animation-director skill); Next 10MB middleware body cap gotcha
metadata: 
  node_type: memory
  type: project
  originSessionId: 8f83621c-f1b7-4b62-b89f-72d72e4d9a7e
  modified: 2026-09-15T02:49:17.854Z
---

Built 2026-09-14 at the user's request ("call this website 3d studio video creator"). Same
split as [[game-creator-app]]: the website plans and shows; the PC renders.

**Where:** `src/lib/studio3d/` (types, `tools/registry.ts` = the modular tool list, `director/`
motion.ts routing rules + heuristic.ts offline director + llm.ts AI director + normalize.ts
which enforces the rules on any plan, `animatic/engine.ts` Three.js previz), components in
`src/components/studio3d/`, API `src/app/api/studio3d/`, builder `tools/studio3d-builder`
(`npm run builder` / `doctor`), skill `~/.claude/skills/animation-director` (+ `scripts/studio_lib.py`
Blender helpers). Preview config `3d-studio-preview-3231`. Tests: `npx vitest run src/lib/studio3d`,
`npm test` in the builder.

**Routing rules (also in skill references/routing.md):** object → Blender; creature → Cascadeur
(Mixamo rigs bipeds only); stunts/falls/fights/contact → Cascadeur; everyday humanoid → Mixamo
clip; unknown specific humanoid motion → Cascadeur. normalizePlan corrects a model or a click that
breaks them.

**Gotchas found while verifying:**
- Next.js 15 keeps only the first **10 MB** of any body that passes through middleware, and the hub's
  matcher deliberately covers all /api. Rendered videos go up in 8 MB chunks on a local hub
  (octet-stream + `op:"assemble"`), signed Storage links on a deployed hub. Game Creator's 8 MB
  screenshots never hit this.
- A hidden tab stops requestAnimationFrame, so animatic export freezes; the recorder now pauses
  with it. The Browser pane counts as hidden when not shown — export tests need it visible.
- MediaRecorder WebM has no duration metadata (plays, scrubs poorly) — fine for the animatic.

**Shipped 2026-09-14:** commit 6240a67 pushed (only studio files — catalog.ts shared a God's Eye
hunk from another session, staged partially), Vercel production READY.
**Setup done:** uv via astral per-user installer (`~/.local/bin`), Blender MCP registered user-scope
(`uvx blender-mcp`, package pre-cached), add-on downloaded to `Documents/3D Studio/_setup/`.
winget Blender install hung on a UAC prompt, so portable Blender 5.2.1 goes to
`%LOCALAPPDATA%/Programs/Blender Foundation/blender-5.2.1-windows-x64` (detect.mjs scans there).

**Blender MCP working 2026-09-14:** add-on module `blender_mcp_addon` (sidebar tab "MCP for Blender",
button "Connect to Claude" — NOT "BlenderMCP"). User couldn't find it, so desktop shortcut
"Blender (MCP on)" runs `Documents/3D Studio/_setup/start_blender_mcp.py`, which starts the server on
a timer; port 9876 answered get_scene_info. `claude mcp get blender` = Connected. A studio_lib smoke
render (24 frames → MP4) passed on 5.2.1; the stand-in rig's arms don't show (unfixed).

**Not verified:** no full job render ever ran — Blender, uv, Cascadeur and a Mixamo library are
NOT installed on this PC (doctor, 2026-09-14). The builder protocol was verified with a simulated
builder; studio_lib.py is syntax-checked only. Headless `claude -p` credit blocker from
[[game-creator-app]] likely applies here too. Mixamo has no API and needs Adobe sign-in, so clips
come from a local library the user downloads.

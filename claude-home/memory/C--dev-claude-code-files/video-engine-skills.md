---
name: video-engine-skills
description: "One engine, one skill, no crossover — unreal-cinematics (UE video) vs unreal-game-builder (UE games), blender-studio + 16 blender-* sub-skills, 12 remotion-*, 21 hyperframes; routing rule lives in the global CLAUDE.md"
metadata: 
  node_type: memory
  type: reference
  originSessionId: a253e276-881a-4318-9f90-ba0bbf094d6f
  modified: 2026-09-20T00:31:19.973Z
---

Installed 2026-09-19 into `~/.claude/skills/`, with a routing table added to
`~/.claude/CLAUDE.md` so the right one always fires:

| Engine named | Skill |
|---|---|
| Unreal — **video / cinematic** | `unreal-cinematics` |
| Unreal — **playable game** | `unreal-game-builder` |
| Blender — anything | `blender-studio` (router for the `blender-*` sub-skills) |
| Remotion | `remotion-best-practices` |
| HyperFrames | `hyperframes` |

The rule the owner asked for: **never use one engine's skill for another engine**, and "3D" alone is
not a trigger — route on the engine actually named.

- **`unreal-cinematics`** — written here. Vendors BoldPhoenix/UnrealMCP under `vendor/`.
  **Registered and verified 2026-09-19**: Python 3.12 venv (3.11 itself is not installed on this PC,
  and the package only needs >=3.11), `pip install -e .`, Epic's `remote_execution.py` copied out of
  UE 5.8, registered as MCP `unrealmcp` with `UNREAL_PROJECT_DIR` = the DeadCity project under
  Documents. The handshake returns **74 tools**, not the README's 35 — it also carries Sequencer
  keyframe editing, Control Rig, mocap import/retarget, PIE control and automation tests, so call
  `tools/list` rather than trusting the README. Each UE project still needs Python Editor Script
  Plugin + Enable Remote Execution turned on in its own Project Settings. Epic's built-in `unreal`
  MCP stays the project/asset layer; this bridge is the render path.
- **Blender** — 5.2.1 LTS installed 2026-09-19 (winget). Install the addon with
  `uvx blender-mcp install-addon`, **never** by hand-copying `addon.py` from GitHub: the installer
  writes the version matching the MCP server (protocol 7), while a hand-copied one loaded as a stale
  1.6 alongside an older `blender_mcp_addon.py`. Only one copy may be enabled — two both bind port
  9876 and the second silently loses. `blendermcp_auto_start_server` defaults to true, so the socket
  comes up when Blender opens; no "Connect to Claude" click needed. A stale connection from a
  previous Blender process errors once and works on retry. The package is being renamed
  `blender-mcp` → `mcp-for-blender`; the old name still works through a wrapper. Telemetry consent
  is ON by default in that addon.
- **`blender-studio`** — written here. Routes to 16 `blender-*` skills from
  kevinbadi/blender-skills (turntable, perfect-loop, dynamic-full-loop, slow-zoom, dolly-rotate,
  crane-shot, polyhaven-*, product-polish, image-to-3d, threejs-export, toolkit), all renamed with a
  `blender-` prefix and their frontmatter `name:` rewritten to match the folder.
- **Remotion** — all 12 `remotion-*` skills from remotion-dev/skills, verbatim.
- **HyperFrames** — all 21 from heygen-com/hyperframes, verbatim (names like `slideshow`, `figma`,
  `media-use` kept as-is because the `/hyperframes` router cross-references them by name).

Cloning gotcha: both remotion-dev/skills and heygen-com/hyperframes hit Windows long-path limits in
a deep folder — clone to a short path (`/c/vsa`) with `-c core.longpaths=true`.

These are the skills [[video-studio-arena-app]] executes.

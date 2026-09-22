---
name: unreal-cinematics
description: Produce video in Unreal Engine — cinematic sequences, animated films, trailers, product films, in-engine shots and virtual production — by driving a live UE editor over MCP, building the scene, authoring it in Sequencer, and rendering through Movie Render Queue to an MP4. Use this WHENEVER the request involves Unreal Engine and a video, animation, cinematic, trailer, shot, camera move, render, machinima, virtual production or "render this in Unreal", and whenever a Video Studio Arena job picks the Unreal method. For a PLAYABLE game rather than a video, use `unreal-game-builder` instead. Never use this skill for Blender, Remotion, HyperFrames or an AI video model — they have their own skills.
---

# Unreal Engine cinematics

Unreal is the engine for **3D video with authored, repeatable content**: real characters and
environments, a camera you control frame by frame, deterministic re-renders, and no generative
drift between takes. If the user wants the same character to look identical in shot 1 and shot 9,
this is the route.

## Scope — read this before doing anything

| Ask | Skill |
|---|---|
| A video / cinematic / animation rendered in Unreal | **this skill** |
| A playable game or level in Unreal | `unreal-game-builder` |
| Anything in Blender | `blender-studio` (and its `blender-*` sub-skills) |
| Motion graphics, typography, charts, explainers | `remotion-best-practices` / `hyperframes` |
| Generative AI footage | `higgsfield-models` / the H3 route |

Unreal only. Do not reach for this skill because a prompt says "3D" — say "3D in Unreal", or route
to the Blender skills.

## The two bridges

There are two MCP servers that talk to Unreal on this machine. They are not interchangeable.

### 1. `unreal` — Epic's built-in UE 5.8 MCP (already registered)

Tools: `unreal_status`, `unreal_new_project`, `unreal_open_project`, `unreal_add_assets`,
`unreal_find_assets`, `unreal_play`, `unreal_screenshot`, `unreal_game_shot`, `unreal_package`,
`unreal_editor_log`, plus Epic's toolsets via `list_toolsets` / `describe_toolset` / `call_tool`.

Good at: creating and opening projects, importing assets, PIE, packaging. This is the **project
and asset** layer. Start every job with `unreal_status`.

### 2. `unrealmcp` — the vendored cinematic bridge (`vendor/`, from BoldPhoenix/UnrealMCP)

**Set up and registered on this machine (2026-09-19).** 74 tools over the editor's Python Remote
Execution, purpose-built for film work. This is the **shot authoring and rendering** layer, and the
reason this skill exists:

- **Sequencer authoring** — `create_sequence`, `animate_actor`, `play_animation` (skeletal),
  `add_camera_cut`, `add_audio`, `add_fade`, `set_actor_visibility_track`,
  `add_shot` (master / sub-sequence), `sequence_inspect`.
- **Render** — `render_sequence` and `render_status` (Movie Render Queue, async request → poll).
- **Camera / DoF** — `set_camera` with aperture, focal length, focus method and focus distance.
- **Eyes** (anti-stale `SceneCapture2D`, returns real images) — `eyes_mirror`, `eyes_focus`,
  `eyes_look`, `eyes_overview` (top-down orthographic floor plan). Use these to *look* at the
  scene, never a desktop screenshot.
- **Actors** — `spawn_actor`, `set_property`, `move_actor`, `delete_actors`.
- **Assets** — `asset_search`, `asset_save`, `asset_edit`, `asset_import`, `material_instance`,
  `asset_dependencies`, `asset_referencers`.
- **Editor** — `get_status`, `get_level_actors`, `open_level`, `save_level` (`.umap`-guarded),
  `run_console_command`, `get_output_log`, `log_search`, `restart_editor`, `execute_python`
  (escape hatch), plus PIE control (`start_pie`, `stop_pie`, `is_pie_running`).
- **Beyond the README's 35** — the build here also carries Sequencer keyframe editing
  (`seq_keyframe`, `seq_get_keys`, `seq_remove_key`, `seq_list_channels`, `seq_set_default`),
  Control Rig (`cr_add_track`, `cr_bake_anim`, `cr_list_controls`), mocap (`import_mocap`,
  `retarget_anim`), viewport control (`get_viewport_camera`, `set_viewport_camera`,
  `focus_viewport`, `screen_to_world`), project settings introspection and the automation-test
  tools. Call `tools/list` if you need the current roster rather than trusting this page.

Two behaviours it guarantees by construction, both of which have burned people before:
levels always save as `.umap` (never a duplicate `.uasset` that causes stale-level loads), and
every mutation does `Modify(True)` + dirties + saves through the real editor path, so spawned and
edited actors survive a reload.

## The cinematic bridge is already connected

Done on this machine on 2026-09-19 — a Python 3.12 venv at `vendor/.venv`, the package installed
editable, Epic's `remote_execution.py` copied in from UE 5.8, and the server registered in Claude
Code as `unrealmcp` with `UNREAL_PROJECT_DIR` pointing at
`C:\Users\honey\Documents\Unreal Projects\DeadCity`. The handshake was verified: 74 tools, every
cinematic one present.

**Still needed in each UE project you drive:** enable the **Python Editor Script Plugin**, and
**Project Settings → Plugins → Python → Enable Remote Execution** (multicast `239.0.0.1:6766`,
bind `127.0.0.1`). Allow `python.exe` through the firewall on first run. Without that the bridge
starts fine but finds no editor to talk to — check `get_status` before blaming anything else.

`UNREAL_PROJECT_DIR` only matters for `restart_editor` and project resolution; every other tool
attaches to whichever editor multicast discovery finds. Point it somewhere else by re-registering
the server with a different `-e UNREAL_PROJECT_DIR=...`.

### Rebuilding it from scratch

```powershell
cd "$env:USERPROFILE\.claude\skills\unreal-cinematics\vendor"
py -3.12 -m venv .venv          # 3.11+ — 3.11 itself is not installed here
.venv\Scripts\pip install -e .
```

Epic's Remote Execution client is **not** redistributed in the repo (Copyright Epic Games), so it
is copied out of the engine install (adjust the version):

```powershell
Copy-Item "C:\Program Files\Epic Games\UE_5.8\Engine\Plugins\Experimental\PythonScriptPlugin\Content\Python\remote_execution.py" "$env:USERPROFILE\.claude\skills\unreal-cinematics\vendor\src\unreal_mcp\vendor\remote_execution.py"
```

```bash
claude mcp add unrealmcp -s user -e "UNREAL_PROJECT_DIR=C:\Users\honey\Documents\Unreal Projects\DeadCity" -- "C:/Users/honey/.claude/skills/unreal-cinematics/vendor/.venv/Scripts/python.exe" -m unreal_mcp
```

The bridge lives outside the editor, survives editor restarts and auto-reconnects.
`vendor/README.md` is the upstream documentation; `vendor/EPIC_MCP_HARVEST.md` covers what was
harvested from Epic's own tooling.

## The production pipeline

Work in this order. Do not skip the look step — rendering a 30-second sequence you have not
looked at wastes minutes per iteration.

1. **Read the brief.** Subject, duration, aspect, style, audience, narration, music, captions.
   If a Video Studio Arena job handed you a production plan, that plan *is* the brief: one
   Sequencer shot per scene, with its own timing.
2. **Check the bridges.** `unreal_status` first. Then confirm the cinematic tools exist. If they
   do not, tell the user the bridge is not connected and stop — do not fake a render.
3. **Project.** Open the existing project, or `unreal_new_project` from a template that already
   carries the content you need (a populated template beats an empty one every time).
4. **Dress the set.** `spawn_actor` / `asset_import` / `material_instance`. Pull environment and
   prop assets in with `unreal_add_assets` (Fab / Quixel / Poly Haven) rather than modelling by
   hand — Unreal's strength is assembly, not modelling. Save the level (`save_level`).
5. **Look.** `eyes_overview` for the floor plan, then `eyes_focus` on each subject. Fix framing
   and blocking here, where it costs a second.
6. **Light it.** Directional + sky + practicals; Lumen on. Check with `eyes_look`.
7. **Author the sequence.** `create_sequence`, then per scene: `animate_actor` for the camera and
   the subjects, `play_animation` for skeletal clips, `add_camera_cut` to bind the shot's camera,
   `set_camera` for lens and depth of field, `add_fade` at the heads and tails. Multi-scene work
   gets a master sequence with `add_shot` sub-sequences — one per scene — so a single scene can be
   re-rendered on its own.
8. **Inspect.** `sequence_inspect` to verify the tracks, bindings and frame ranges are what the
   plan says. Then `eyes_focus` on a couple of key frames.
9. **Audio.** `add_audio` for narration, music and effects, offset to the beat of the plan.
10. **Render.** `render_sequence` → poll `render_status`. Movie Render Queue, deterministic.
11. **Inspect the output and iterate.** This is the part agents skip and should not: open the
    render, look at it, name what is wrong (framing, exposure, a pop in the animation, a camera
    that clips geometry), fix that one thing, re-render the affected shot only. Two or three
    passes is normal. Report the real error when one happens — never a green checkmark over a
    failed render.

## Rules that bite

- **Never screenshot the desktop.** Use the `eyes_*` tools; they render through a fresh
  `SceneCapture2D` and cannot return a stale frame.
- **`.umap`, always.** Save worlds with `save_level`. A `.uasset` sharing a level's package name
  causes non-deterministic stale-level loads.
- **One shot per scene, sub-sequenced.** It is the only thing that makes "regenerate scene 3"
  cheap instead of a full re-render.
- **Template projects can hang** on SharedContentPacks or PIE — see the `unreal-game-builder`
  skill's notes; the same traps apply here.
- **Content-only packaging strips runtime plugins** on this machine (no NetFx SDK installed).
  Irrelevant for rendering, relevant if someone asks for an executable instead of a video.
- If a required tool, key or install is missing, **say which one and stop**. A clearly-marked
  dependency is a result; a pretend render is not.

## Output

An MP4 (plus the per-shot renders) written where the job asked for it, and a short report: the
sequence path, the shots and their frame ranges, the render settings, and anything you could not
do. When a Video Studio Arena job drove this, report back through that job's progress endpoint so
the studio shows the real status.

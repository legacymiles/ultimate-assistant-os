---
name: blender-studio
description: Produce video, animation, 3D assets and renders in Blender — product films, turntables, camera moves, procedural scenes, simulations, characters, materials, lighting and MP4 output — by driving a live Blender over the blender MCP. Use this WHENEVER the request involves Blender and a video, animation, render, 3D model, product shot, camera move or scene, whenever someone says "do it in Blender" / "Blender MCP" / "render this in Blender", and whenever a Video Studio Arena job picks the Blender method. It is the router for the `blender-*` sub-skills (turntable, slow-zoom, crane-shot, dolly-rotate, perfect-loop, dynamic-full-loop, image-to-3d, polyhaven-*, product-polish, threejs-export, toolkit). Never use this skill for Unreal Engine, Remotion, HyperFrames or an AI video model — they have their own skills.
---

# Blender studio

Blender is the engine for **custom 3D you author yourself**: modelling, procedural geometry,
materials, simulations, character animation, and rendered video with full control of every frame.
Reach for it when the shot needs an asset that does not exist yet, or physics, or a look that a
game engine's real-time renderer will not give you.

## Scope — read this before doing anything

| Ask | Skill |
|---|---|
| Video / animation / render / 3D asset in Blender | **this skill** (then a `blender-*` sub-skill) |
| A full animated film with script, storyboard and mocap routing | `animation-director` (it uses Blender) |
| A 3D hero or world for a **website** | `blender-to-web` |
| Anything in Unreal Engine | `unreal-cinematics` (video) / `unreal-game-builder` (games) |
| Motion graphics, typography, charts | `remotion-best-practices` / `hyperframes` |
| Generative AI footage | `higgsfield-models` / the H3 route |

Blender only. "3D" on its own is not a trigger — route on the named tool, or on the work needing
authored geometry.

## The bridge

The `blender` MCP server drives a live Blender instance. Before writing any code:

1. `get_addon_status()` — read `blender_version`, confirm the addon is connected.
2. `get_scene_info()` — see what already exists.

**Set up on this machine (2026-09-19):** Blender 5.2.1 LTS, the *MCP for Blender* addon 1.7
installed and enabled with **Auto-Start Server on**, so the socket comes up on port 9876 the moment
Blender opens — no clicking. Verified: addon protocol 7 matches the server's expected 7.

So if those tools fail, the usual cause is simply that **Blender is not running**. Open it and try
again. A stale connection from a previous Blender process reports
"forcibly closed by the remote host" once and works on the retry. If the addon really is off:
Preferences → Add-ons → enable *Interface: MCP for Blender*, or re-run
`uvx blender-mcp install-addon`. Only one copy may be enabled — two both bind 9876 and the second
silently loses. Do not improvise a headless `blender --python` run in its place unless the user
asks for one.

Key tools: `execute_blender_code` (arbitrary Python — the workhorse), `get_object_info`,
`get_viewport_screenshot`, `export_scene`, plus asset libraries: `search_polyhaven_assets` /
`download_polyhaven_asset` (HDRIs, textures, models), `search_sketchfab_models`,
`search_polypizza_models`, and generative 3D via `generate_hyper3d_model_via_text` /
`..._via_images` and `generate_hunyuan3d_model` (poll with `poll_rodin_job_status` /
`poll_hunyuan_job_status`, then `import_generated_asset`).

### Writing Python that survives someone else's Blender

- **Look shader nodes up by type, never by name.** Node names are localized, so
  `nodes["Principled BSDF"]` returns `None` on a non-English UI. Use
  `next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")`.
- **Never hardcode enum identifiers** — read the valid values first, e.g.
  `[i.identifier for i in scene.render.image_settings.bl_rna.properties["file_format"].enum_items]`.
- **`scene.render.engine` is the exception**: a dynamic enum that RNA under-reports. Read the
  current value (always valid) and assign inside `try/except TypeError` — the error lists the
  accepted identifiers.
- With `use_nodes` on (the default), set colours on the **shader node inputs**.
  `material.diffuse_color` only drives viewport display and will not show up in the render.
- After every change: `get_viewport_screenshot()` to confirm it looks right, `get_scene_info()`
  to confirm the objects exist.

## Sub-skills — pick the one that matches the shot

**Camera moves** (each writes a full animated camera and renders it):

| Shot | Skill |
|---|---|
| 360° orbit, the classic product showcase | `blender-turntable` |
| Seamless loop, first frame == last frame | `blender-perfect-loop` |
| Speed-ramped loop, all sides, whip transitions | `blender-dynamic-full-loop` |
| Cinematic push-in on a hero detail | `blender-slow-zoom` |
| Forward dolly while rotating — dynamic sweep | `blender-dolly-rotate` |
| Low-to-high rise, dramatic unveiling | `blender-crane-shot` |

**Scene, lighting and materials:**

| Need | Skill |
|---|---|
| Studio photography setup — HDRI + PBR ground | `blender-polyhaven-studio-setup` |
| Full scene: environment, ground, pedestal, props | `blender-polyhaven-scene-builder` |
| Texture an object from PolyHaven | `blender-polyhaven-texture-apply` |
| Render the same product in several materials | `blender-polyhaven-material-swap` |
| Compare lighting across HDRIs, as a grid | `blender-polyhaven-hdri-showcase` |
| Glossy product-shot finish on an imported model | `blender-product-polish` |

**Assets and export:**

| Need | Skill |
|---|---|
| One photo → textured 3D model (Meshy) | `blender-image-to-3d` |
| 1–4 photos → high-accuracy 3D model | `blender-multi-image-to-3d` |
| Geometry, materials, modifiers, Mixamo retargeting | `blender-toolkit` |
| GLB + a ready Three.js viewer | `blender-threejs-export` |

Compose them. A product film is usually `blender-polyhaven-studio-setup` →
`blender-product-polish` → one camera skill → render.

## The production pipeline

1. **Read the brief.** Subject, duration, aspect, style, audience, narration, music, captions.
   A Video Studio Arena production plan *is* the brief — one Blender shot per scene.
2. **Check the bridge** (`get_addon_status`, `get_scene_info`). Missing → say so and stop.
3. **Get the geometry.** In order of preference: the user's own model (`asset_import` /
   `blender-image-to-3d`), then a library (Poly Haven, Sketchfab, Poly Pizza), then generated
   (Hyper3D / Hunyuan3D), then modelled by hand. Hand-modelling is the slowest path, not the
   default one.
4. **Set and light.** A `blender-polyhaven-*` skill, or an HDRI plus a three-point rig.
5. **Look.** `get_viewport_screenshot()`. Fix framing now, not after a render.
6. **Animate.** A camera sub-skill for the move; `blender-toolkit` for Mixamo retargeting when a
   character has to perform.
7. **Render settings.** Cycles for hero product work, EEVEE when the shot is simple and the
   iteration count is high. State which you chose and why. Default output: 1920×1080, 24fps.
8. **Render, then look at the result.** Name what is wrong — noise, clipping, a pop in the
   animation, a material reading flat — fix that one thing, re-render the affected frames only.
   Two or three passes is normal.
9. **Encode.** ffmpeg to MP4 (h264, yuv420p) for delivery. The camera sub-skills render ProRes
   4444 with alpha by default, which is right for compositing and wrong for a web preview —
   transcode when the deliverable is an MP4.

## Rules that bite

- **Never assume anything about the user's Blender.** Version, language, engine, add-ons — read
  them first. See the Python rules above.
- **Blender may not be installed on this machine.** If the MCP is not connected, that is a
  clearly-marked dependency, not a thing to work around silently.
- **One scene per shot.** It is what makes "regenerate scene 3" cheap.
- **ProRes 4444 ≠ deliverable.** Transcode before claiming a finished video.
- If a required tool, key (Meshy, Hyper3D) or install is missing, **say which one and stop**.

## Output

An MP4 (plus the per-scene renders and the `.blend`) where the job asked for it, and a short
report: the scene contents, the render engine and settings, the shots and their frame ranges, and
anything you could not do. When a Video Studio Arena job drove this, report the real status back
through that job's progress endpoint.

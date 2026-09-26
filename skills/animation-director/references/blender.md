# Blender

Blender is the production engine: sets, characters, cameras, lighting, object and effect
animation, NLA assembly of Mixamo clips, rendering and encoding. Two ways to drive it:

| | Background CLI (`blender -b -P`) | Blender MCP (`mcp__blender__*`) |
|---|---|---|
| Needs | Blender installed | `uvx blender-mcp` registered + Blender open with the add-on "Connect to Claude" pressed (port 9876) |
| Use for | Everything that must work unattended: building, rendering, encoding | Inspecting a scene live, viewport screenshots, pulling Poly Haven / Sketchfab / Hyper3D assets, quick iteration |
| Tools | your scripts | `get_scene_info`, `get_object_info`, `execute_blender_code`, `get_viewport_screenshot`, asset tools |

Setup commands (user runs once): `winget install BlenderFoundation.Blender`,
`winget install astral-sh.uv`, `claude mcp add blender -s user -- uvx blender-mcp`, then in
Blender: `uvx blender-mcp install-addon` or install addon.py from github.com/ahujasid/blender-mcp.

## Version gotchas (4.2 → 5.x)

- EEVEE engine id: `BLENDER_EEVEE_NEXT` in 4.2–4.5, `BLENDER_EEVEE` in 5.0+. `S.setup_render`
  tries both.
- Video output in 5.0+: `image_settings.media_type = 'VIDEO'` **before** `file_format = 'FFMPEG'`.
- `--factory-startup` in 5.0 disables FFmpeg: never use it.
- Sequencer collection: `sequence_editor.strips` (5.0+) vs `.sequences` (4.x).
- Slotted actions (4.4+): after assigning `animation_data.action`, set
  `animation_data.action_slot = action.slots[0]` if it is None; NLA strips have `action_slot` too.
- FBX import: `bpy.ops.import_scene.fbx(filepath=..., automatic_bone_orientation=True)`.

## Style → look

| style | engine | materials | extras |
|---|---|---|---|
| stylized-3d | EEVEE | Principled, roughness .5, subsurface .1 on skin | soft sun, AO, bloom off, DoF f/2.8 |
| anime-toon | EEVEE | Shader to RGB → ColorRamp (constant, 2–3 steps) | Line Art modifier or Freestyle 1.5 px |
| claymation | Cycles (EEVEE if slow) | roughness 1, Noise Texture → Bump .15 | step animation: `S.step_keys(obj, 2)` |
| low-poly | EEVEE | flat shading, no textures | `bpy.ops.object.shade_flat()` |
| cinematic | Cycles 64 spp + denoise | Principled, HDRI world | motion blur, filmic/AgX, letterbox via camera sensor |
| paper-craft | EEVEE | Principled + Noise bump .05, emission 0 | orthographic-ish long lens, layered depth |

## Cameras

`S.camera_move(camera_spec, target_location, frame_count, aspect)` keys: static, dolly-in
(1.45→0.85× distance), dolly-out, orbit (−40°→+50°), pan, crane-up (0.5 m → 6 m), tracking
(follows a target object with a Copy Location constraint offset), handheld (noise modifier on
rotation, strength .02). Lens from the plan (mm). Vertical 9:16 needs ~1.75× distance.

## Object / effect animation (tool = "blender")

- **fly / launch**: keyframe location on an eased curve; rockets: Z from 0 → 12 m with
  `interpolation='EXPO'` ease-in; add a smoke/fire particle emitter at the nozzle.
- **drive**: Follow Path constraint on a Bezier curve, animate `offset_factor` 0→1; spin wheels
  with a driver on distance.
- **grow / appear**: scale keys 0.01 → 1 with `BACK` easing.
- **spin / bounce**: rotation keys or a Cycles F-Curve modifier; bounce with `BOUNCE` easing.
- **explode / shatter**: Cell Fracture add-on is not always enabled — prefer a particle burst
  (icospheres, 300 particles, 8 frames lifetime) plus scale-out of the object.
- **snow / rain / sparkles**: particle system on a plane above the set; sparkles = emission
  material + bloom (EEVEE Next uses compositor Glare).

## Character motion helpers

- `S.stand_in_character(name, colors, kind)` → a parented rig of primitive parts with named pivots
  (`hips`, `head`, `arm_L`, `arm_R`, `leg_L`, `leg_R`) for when no Mixamo character exists.
- `S.key_motion(rig, motion, start, end, fps)` keys walk/run/jump/talk/wave/dance/cheer/idle… on the
  stand-in, and `flip/fall/fight/climb/throw` on physics-plausible arcs (the Cascadeur fallback).
- `S.path_move(obj, start, end, from_xyz, to_xyz)` moves any root across the set.

## Rendering

- `S.render_still(filepath, frame)` — PNG.
- `S.render_frames(out_dir)` — PNG sequence, `render.use_overwrite = False` so re-runs resume.
- `S.encode_scenes(frame_dirs, out_mp4, fps, (w, h))` — builds a sequencer scene, H.264 MP4,
  returns the real file path (Blender appends frame ranges to movie names; the helper renames).
- GPU for Cycles: `S.enable_gpu()` tries OPTIX → CUDA → HIP → ONEAPI → METAL.

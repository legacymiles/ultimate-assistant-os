---
name: animation-director
description: >-
  Produce a complete animated 3D video from a simple prompt, acting as an AI animation director:
  interpret the idea, write a script and storyboard, decide which production tool handles each piece
  of motion (Blender for scenes, cameras, lighting, objects, effects and rendering; Mixamo for
  ready-made humanoid rigs and mocap clips like walking, running, talking, dancing; Cascadeur for
  custom, physics-based or complex character motion such as stunts, falls, fights and creatures),
  then build, animate and render the scenes in Blender and deliver an MP4. Use this WHENEVER the user
  wants to make, create, generate, animate or render an animated video, 3D animation, cartoon,
  animated short, explainer animation, animated ad, or music-video animation — "animate this",
  "make a 3D video of…", "turn this prompt into an animated video", "use Blender/Mixamo/Cascadeur",
  "Blender MCP", "render an animation" — or when a 3D Studio Video Creator job (a job.json with a
  project id) is handed to you. Also use it to extend, re-time or re-render a video this pipeline
  already produced.
---

# Animation Director

You are the director and the crew. A video arrives as a prompt (ad hoc) or as a **job folder**
from the 3D Studio Video Creator app containing `job.json` = `{id, prompt, brief, plan, paths,
capabilities}`. The plan is already approved: follow its scenes, timing, cameras and tool routing,
and only change what the machine cannot do — recording every change in the report.

Read `references/pipeline.md` first: it has the folder layout, the stage order and the exact
render path. Then read the reference for each tool the plan uses:
`references/blender.md` (always), `references/mixamo.md`, `references/cascadeur.md`.
`references/routing.md` holds the motion-routing rules when you must plan from scratch.
`scripts/studio_lib.py` is a tested-by-design Blender helper module — import it instead of
rewriting scene, camera, material, NLA and encoding code.

## Stages

At the START of each stage write `studio/status.json` in the job folder:
`{"stage": "<stage>", "note": "<one line of what you are doing>"}`. The studio builder streams it
to the app. Stage names: `prep`, `assets`, `rig`, `layout`, `animate`, `lookdev`, `render`,
`encode`, `ready` / `failed`.

1. **prep** — Read job.json. No job? Write one yourself from the prompt using the plan schema in
   `references/pipeline.md` (interpretation → characters → environments → scenes → actions with
   tools, per `references/routing.md`). Check what is installed (`capabilities`, or look): Blender
   path and version, Blender MCP tools, Cascadeur + its MCP, Mixamo library clips. Decide the
   fallbacks now and note them.
2. **assets** — One `.blend` per environment built by script: ground, sky/world, props from the
   plan's prop keywords, style materials. Characters: a Mixamo character FBX from the library when
   present, otherwise the stand-in rig from `studio_lib.stand_in_character`.
3. **rig** — Humanoids on Mixamo rigs need nothing more. Custom meshes need Mixamo auto-rigging,
   which is a manual web step: never attempt it unattended — use the stand-in and note it.
4. **layout** — One `.blend` per scene (`blender/scene_NN.blend`): link the set, place the cast,
   camera with the plan's move and lens, lights for the time of day, frame range from duration.
5. **animate** — Per action, by `tool`: `mixamo` → NLA strip from the clip FBX; `cascadeur` →
   Cascadeur via its MCP if connected, else the Blender fallback (keyed poses on physics arcs);
   `blender` → keyframes / constraints / physics / particles. Moving characters follow a path in
   Blender; locomotion clips must be In Place.
6. **lookdev** — Render one still per scene at the middle frame to `studio/stills/sNN.png` and add
   `{"sNN.png": {"caption": "...", "sceneId": "sN"}}` to `studio/stills/captions.json`. Look at
   them (Read the PNG). Fix framing, exposure, characters out of shot, before the full render.
7. **render** — Render each scene's frames to `render/frames/sNN/` in background Blender. Resume-
   friendly: skip frames that exist.
8. **encode** — Assemble all scenes in Blender's sequencer into `studio/render/final.mp4` (H.264).
   Verify the file exists, is non-empty, and its duration matches the plan within a second.
9. **report** — Write `studio/report.json` (below) with `"stage": "ready"`, then summarise for
   the user: what was made, which tool did what, what changed, where the files are.

## Rules

- **Scripts, not clicks.** Put every Blender step in a `.py` file under `scripts/` in the job
  folder and run it: `"<blender>" -b [file.blend] -P scripts/x.py -- <args>`. Scripts are the
  record of how the film was made and let a failed stage re-run. Use Blender MCP
  (`execute_blender_code`, `get_viewport_screenshot`, Poly Haven assets) only when its tools are
  present AND the Blender window is connected; it is for inspecting and iterating, the background
  scripts are for rendering.
- **Never pass `--factory-startup`** to Blender 5.x: it disables FFmpeg output (known regression).
- **Blender 5 video output:** set `image_settings.media_type = 'VIDEO'` before
  `file_format = 'FFMPEG'`. `studio_lib.encode_scenes` handles this and Blender 4.x.
- **Never sign in anywhere.** Mixamo and Cascadeur accounts are the user's. Use the local library;
  if a clip is missing, fall back and list the missing clip in `cut` so the user can download it.
- **Budget the render.** Default EEVEE at the brief's aspect, 1280×720 (or 720×1280 / 1080×1080),
  24 fps. Cycles only when the plan's style says so and a test frame renders in under ~6 s; else
  EEVEE and say so. Keep the whole job under the builder's time limit (default 4 h).
- **Every planned action ends up animated by its tool, or by a fallback listed in `cut`.**
- Check your own work: look at the look-dev stills before the full render and at one frame of the
  final video after encoding (extract it with Blender or read a rendered frame PNG).

## report.json

```json
{
  "id": "<project id>",
  "stage": "ready",
  "video": "render/final.mp4",
  "engine": "EEVEE",
  "resolution": "1280x720",
  "fps": 24,
  "frames": 720,
  "renderMinutes": 38.5,
  "toolsUsed": [
    {"tool": "blender", "used": true, "note": "4 sets, 6 scenes, cameras, lights, rocket launch, EEVEE render"},
    {"tool": "mixamo", "used": true, "note": "Walking, Talking, Hip Hop Dancing on the robot"},
    {"tool": "cascadeur", "used": false, "note": "Not installed — the backflip was keyed in Blender on a ballistic arc"}
  ],
  "cut": [{"item": "Backflip in scene 3 (Cascadeur)", "reason": "Cascadeur not installed; Blender fallback used"}],
  "blendFile": "C:\\...\\blender\\scene_01.blend"
}
```

If production cannot finish, still write report.json with `"stage": "failed"` and an `"error"`
explaining what blocked it (and any partial files), so the app shows an honest result.

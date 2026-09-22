# Pipeline

## Job folder layout

```
<job>/
  job.json                 # from the app: id, prompt, brief, plan, paths, capabilities
  scripts/                 # every Blender / Cascadeur script you run (keep them)
  assets/                  # imported or generated assets, Cascadeur FBX exports
  blender/
    set_<envId>.blend      # one per environment
    scene_01.blend …       # one per scene
  render/frames/s01/0001.png …
  studio/                  # what the app reads (the builder watches this)
    status.json
    stills/s01.png, captions.json
    render/final.mp4
    report.json
```

## job.json (plan schema)

```jsonc
{
  "id": "…",
  "prompt": "…",
  "brief": { "style": "stylized-3d|anime-toon|claymation|low-poly|cinematic|paper-craft", "lengthSec": 30, "aspect": "16:9|9:16|1:1", "mood": "…", "audience": "…" },
  "plan": {
    "title": "…", "logline": "…",
    "interpretation": { "genre": "…", "tone": "…", "audience": "…", "pacing": "…", "themes": [] },
    "style": { "id": "stylized-3d", "look": "…", "engine": "EEVEE|CYCLES" },
    "characters": [{ "id": "c1", "name": "Tiny Robot", "kind": "humanoid|creature|object", "description": "…", "colors": { "body": "#f97316", "accent": "#1e293b" } }],
    "environments": [{ "id": "e1", "name": "City street", "description": "…", "props": ["buildings", "lamps"], "palette": { "sky": "#…", "ground": "#…", "fog": "#…" }, "timeOfDay": "day|golden|night" }],
    "scenes": [{
      "id": "s1", "title": "…", "beat": "Opening", "durationSec": 6.5, "environmentId": "e1",
      "summary": "…", "narration": "…",
      "camera": { "move": "static|dolly-in|dolly-out|orbit|pan|crane-up|tracking|handheld", "lens": 35, "framing": "wide establishing shot" },
      "lighting": "…", "effects": ["sparkles"],
      "actions": [{ "id": "a1", "characterId": "c1", "description": "walks into the street", "motion": "walk", "tool": "mixamo|cascadeur|blender", "clip": "Walking", "reason": "…" }]
    }],
    "music": "…", "soundDesign": "…", "totalSec": 30
  },
  "paths": { "jobDir": "…", "blender": "C:\\…\\blender.exe", "cascadeur": null, "mixamoLibrary": "…", "skillScripts": "…\\animation-director\\scripts" }
}
```

Actions in one scene for the same character play **in order**, splitting the scene evenly.
Actions of different characters play **at the same time**.

## Running Blender

```bash
"<blender>" -b -P "<job>/scripts/build_sets.py" -- "<job>/job.json"
"<blender>" -b "<job>/blender/scene_01.blend" -P "<job>/scripts/render_scene.py" -- "<job>/job.json" s1
```

Inside a script, read arguments after `--`:

```python
import sys, json
sys.path.insert(0, r"<paths.skillScripts>")   # studio_lib.py lives there
import studio_lib as S
argv = sys.argv[sys.argv.index("--") + 1:]
job = S.load_job(argv[0])
```

Background Blender prints Python tracebacks to stdout and still exits 0. **Check the output for
`Traceback` / `Error:`** and check that the files the script should write exist.

## Stage recipes

1. **Sets** (`build_sets.py`): for each environment → `S.reset_scene()`, `S.setup_render(...)`,
   `S.world(palette.sky)`, `S.ground(palette.ground)`, `S.dress_set(env["props"], style)`,
   `S.sun(env["timeOfDay"])`, save `blender/set_<id>.blend`.
2. **Scenes** (`build_scene.py <sceneId>`): open the set blend → `S.frame_range(scene, fps)` →
   characters (Mixamo FBX via `S.import_fbx`, else `S.stand_in_character`) → per action animate
   (see tool references) → `S.camera_move(scene["camera"], target, frames)` → save
   `blender/scene_NN.blend`.
3. **Look-dev**: `S.render_still(path, frame=mid)` for each scene blend.
4. **Frames**: `S.render_frames(out_dir)` for each scene blend (skips existing frames).
5. **Encode**: `S.encode_scenes([dirs…], out_mp4, fps, (w, h))` → rename the result to
   `studio/render/final.mp4`.

## Timing

`frames = round(durationSec * fps)`; scene N starts at frame 1 in its own blend. Title card:
the app's animatic overlays the title on scene 1's first 2.4 s — do the same in Blender with a
text object (or skip it and say so).

## Quality check before `ready`

- Every still reviewed (Read the PNG): characters in frame, readable silhouette, no black frames.
- final.mp4 exists, size > 100 KB, duration ≈ plan.totalSec (Blender: load it as a movie strip and
  read `frame_final_duration / fps`).

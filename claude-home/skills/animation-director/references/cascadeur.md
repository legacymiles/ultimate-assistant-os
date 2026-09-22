# Cascadeur

Nekki's physics-aware keyframe animation tool (cascadeur.com). Use it for motion no mocap clip
covers: **flips and acrobatics, falls and stumbles, fight choreography, climbing, throwing and
lifting with correct weight, landings, creatures and quadrupeds**, and exaggerated stylised
performance. Its strengths are AutoPosing (full-body pose from a few controllers), AutoPhysics
(fixes balance, momentum and trajectories) and AI inbetweening.

## How Claude reaches it

- **Python API** (`csc` module) runs inside Cascadeur: Commands menu scripts, docs at
  https://cascadeur.com/python-api/. FBX in/out via `csc.fbx.FbxLoader`
  (`import_model`, `import_animation`, `export_all_objects`, `export_joints`, `export_model`).
- **cascadeur-mcp** (github.com/ysk424/cascadeur-mcp): MCP server that launches Cascadeur with a
  bridge script and exposes `execute_cascadeur_code`, `get_scene_info`, `capture_viewport`,
  `import_fbx`, `export_fbx`. Needs Cascadeur **running with its GUI** on Windows; no headless
  mode. Install: run its `install_cascadeur_side.py` (admin, once), `uv venv && uv pip install -e .`,
  register with `claude mcp add cascadeur -s user -- cascadeur-mcp`.
- **Limitation:** AutoPosing and AutoPhysics are not exposed to the API. Unattended, you can import
  the rig, key the key poses from script, let Cascadeur interpolate, and export. Running
  AutoPhysics is a one-click manual step — say so in the report if the motion would benefit.

## Workflow (Cascadeur available + MCP connected)

1. Export the character rig from Blender as FBX (`S.export_fbx(armature, path)`), or use the
   Mixamo character FBX directly.
2. `import_fbx` it into a new Cascadeur scene (Mixamo rigs map to Cascadeur's humanoid preset).
3. Key the **key poses** of the action at its contact and apex frames (start, anticipation,
   take-off, apex, landing, settle). Use `execute_cascadeur_code` with `csc` scene edits; verify
   with `capture_viewport` and fix.
4. `export_fbx` the animation to `assets/cascadeur/<sceneId>_<actionId>.fbx`.
5. In Blender, `S.add_mixamo_clip(arm, that_fbx, …)` works for any FBX action on the same rig.

## Blender fallback (Cascadeur missing or MCP not connected)

Key the same key poses in Blender on the rig with physically plausible timing — this is what
`S.key_motion` does for `flip`, `fall`, `fight`, `climb`, `throw`, `land`:

- **Ballistic arcs:** hang time `t = 2·v/g`; a 1.2 m-high jump takes ~0.99 s in the air
  (`S.ballistic_height(p, peak)`). Keep the hips on the parabola; rotate around the centre of mass.
- **Anticipation / recovery:** 4–8 frames of crouch before take-off and after landing.
- **Contacts:** feet planted (no sliding) during stance; hands locked on climb holds.
- **Falls:** lose balance over ~10 frames, fast ease-in to the ground, small bounce, settle.

Report honestly: `{"tool": "cascadeur", "used": false, "note": "Not installed — backflip keyed in
Blender on a ballistic arc"}` and add the action to `cut` with the reason.

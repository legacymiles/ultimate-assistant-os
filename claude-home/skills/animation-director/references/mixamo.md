# Mixamo

Adobe's free auto-rigger and mocap library (mixamo.com). Best for **everyday humanoid motion**:
walking, running, jumping, talking/gesturing, waving, dancing, idles, sitting, typing, reactions.
Humanoid (biped) only.

## Reality check

- **There is no public API** and it needs the user's Adobe sign-in. Never automate the website,
  never enter credentials. The studio works from a **local library** the user fills once.
- Everything below the library is fully scriptable in Blender.

## Library layout (`paths.mixamoLibrary`, default `Documents/3D Studio/_library/mixamo`)

```
mixamo/
  Walking.fbx            ← animation clips, named EXACTLY as the studio's clip list
  Running.fbx
  Hip Hop Dancing.fbx
  characters/
    Hero.fbx             ← rigged characters (optional)
```

How the user downloads (tell them this when clips are missing):

- **Clips**: pick the clip → check **In Place** for locomotion (Walking, Running) → Download →
  Format **FBX Binary**, Skin **Without Skin**, 30 fps, Keyframe Reduction none → rename the
  file to the studio clip name.
- **Characters**: pick a Mixamo character (or upload a custom mesh and auto-rig it) → Download →
  **FBX Binary, With Skin, T-pose** → save in `characters/`.

Studio clip names: Idle, Walking, Running, Jumping, Talking, Waving, Hip Hop Dancing, Clapping,
Victory, Pointing, Thinking, Looking Around, Sitting, Typing, Picking Up, Sad Idle, Laughing,
Salute.

## Applying a clip in Blender

All Mixamo rigs share bone names (`mixamorig:Hips`, …), so a "Without Skin" clip drives any
Mixamo character directly:

```python
arm = S.import_fbx(r"...\characters\Hero.fbx").armature
S.add_mixamo_clip(arm, r"...\mixamo\Walking.fbx", start_frame=1, frame_count=156, fps=24)
S.path_move(arm, 1, 156, (-3, 0, 0), (3, 0, 0))   # In Place clip + Blender path = travel
```

`add_mixamo_clip` imports the FBX, takes its action, deletes the imported objects, and adds an
NLA strip that repeats to fill `frame_count` (scaled from 30 → scene fps). Several clips on one
character = several strips in order, each with `blend_in/blend_out` of 6 frames to avoid pops.

## When no Mixamo character is in the library

Use `S.stand_in_character` (primitive rig) and `S.key_motion(rig, motion, …)`, which imitates the
clip procedurally. Report it: `{"tool": "mixamo", "used": false, "note": "No character in the
library — stand-in rig with procedural Walking"}` and add each missing clip to `cut`.

## When a clip is missing but a character exists

Pick the closest clip the library has (Talking for Pointing, Idle for Thinking), or key the motion
on the Mixamo rig's bones in Blender. List the missing clip in `cut`.

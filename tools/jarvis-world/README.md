# Jarvis world: the breathing galaxy ball

The background behind every section of Jarvis (`/apps/jarvis`).

- **Blender owns the shape.** `build_world.py` generates it deterministically (seed 1729) and exports `public/jarvis/world.glb` (~320 KB). The objects are `world_core`, `galaxy_bulge`, `galaxy_arms`, `galaxy_dust`, `galaxy_shell` and `galaxy_halo`. All of them are glTF POINTS except the core sphere. `world.blend` is the saved scene.
- **The browser owns the life:** `src/components/new-jarvis/WorldField.tsx`. None of this travels through glTF, so it's all written there:
  - breathing (inhale, hold, longer exhale), stronger in the lower and side lobes
  - differential swirl
  - additive glow and bloom
  - the ball's rim light
  - the pointer gravity well, and the click shockwave
  - faster breathing while Jarvis works

## Rebuild

```
# Blender 4.2+ (tested with 5.0.1 via the bpy module)
blender --background --python tools/jarvis-world/build_world.py -- \
  --out public/jarvis/world.glb --blend tools/jarvis-world/world.blend [--renders <dir>]
```

`--renders` writes Cycles CPU previews (front, close), with each star drawn as a bead. Those beads exist only in the preview and are never exported. After exporting, the script re-imports the GLB and prints the authored and imported point counts so you can compare them.

## Quality

- **Desktop:** bloom, a nebula behind everything, and a pixel ratio of up to 1.5.
- **Phones and weak GPUs:** no bloom, half the stars, and a pixel ratio of up to 1.25.
- **Automatic step-down:** a frame-time probe lowers quality further if the first ~2.5 s are slow.
- **Reduced motion:** one settled frame, no animation.
- **No WebGL, a lost context or a failed load:** the old canvas field (`HudField`) is shown instead.
- **`?world=full`:** pins full quality, for checking the look on a slow machine.

# Jarvis world: a breathing galaxy ball in a coloured cosmos

The background behind every section of Jarvis (`/apps/jarvis`).

- **Blender owns the shape.** `build_world.py` generates it deterministically (seed 1729) and exports `public/jarvis/world.glb` (~500 KB). The ball is round and compact but organic, not mirror-perfect. Inside: an off-centre bulge, and three arms of unequal length on a thick, gently warped disc, with star-forming knots and dust lanes. Around it: a lopsided shell of star streams, three ribbons wrapping it at odd angles, and a companion cluster. Two rings sit close around the ball on different tilts. One is banded with a gap and carries shepherd moons; the other is a thin braided strand. Out in the cosmos are uneven colour clouds (kept behind and around the ball, never in front of it), scattered stars and small clusters. Every layer is glTF POINTS except the core sphere. `world.blend` is the saved scene.
- **The browser owns the life:** `src/components/new-jarvis/WorldField.tsx`. None of this travels through glTF, so it's all written there:
  - breathing (inhale, hold, longer exhale), stronger in the lower and side lobes
  - differential swirl
  - additive glow and bloom
  - the ball's rim light
  - the pointer gravity well, and the click shockwave
  - faster breathing while Jarvis works
  - each ring spinning about its own tilt (inner bands faster), with an oil-on-water shimmer
  - colour that follows the pointer, plus a new colour for each shockwave (only clicks on open space send one)
  - depth: out-of-focus motes in front and distant galaxies behind, each sliding at a different speed

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

# Jarvis world: a breathing galaxy with smoke and a level ring

The background behind Jarvis (`/apps/jarvis`): Chat, Dashboard, Settings and the rest. Studio and App plugins have their own look, so there it fades out and its loop pauses.

- **Blender owns the shape.** `build_world.py` generates it deterministically (seed 1729) and exports `public/jarvis/world.glb` (~500 KB). The galaxy is compact but lopsided, not mirror-perfect, and the browser turns it most of the way toward you so the spiral reads (the v3 pose). Inside: an off-centre bulge, and three arms of unequal length on a thick, gently warped disc, with star-forming knots and dust lanes. Around it: a lopsided halo of star streams, three ribbons wrapping it at odd angles, and a companion cluster. The rings lie flat. The browser holds them level, Saturn-style, while the galaxy faces you. One is banded with a gap and carries shepherd moons; the other is a thin braided strand a few degrees off it. Out in the cosmos: an uneven sky, heavier on one side, with scattered stars, a few tight globular clusters, looser open clusters, two long star streams and patchy colour clouds. Every layer is glTF POINTS except the core sphere. `world.blend` is the saved scene.
- **The browser owns the life:** `src/components/new-jarvis/WorldField.tsx`. None of this travels through glTF, so it's all written there:
  - breathing, all the time (inhale, hold, longer exhale): it swells and shrinks, and the disc presses flatter on each exhale. With reduced motion it still breathes, slower and gentler, with no shockwaves and no leaning
  - differential swirl
  - additive glow and bloom
  - the ball's rim light
  - the pointer gravity well, and the click shockwave
  - faster breathing while Jarvis works
  - talking, in Talk: whoever is speaking (you through the mic, or Jarvis's voice) brightens it, squeezes it on every syllable and tints it, warm for Jarvis and cool for you. It listens along at half strength while the mic waits for its name. Jarvis's browser voice has no audio to measure, so a speech envelope stands in
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

- **Desktop:** bloom, both background smoke layers, and a pixel ratio of up to 1.5.
- **Phones and weak GPUs:** no bloom, half the stars, one background smoke layer with less detail, and a pixel ratio of up to 1.25.
- **Automatic step-down:** a frame-time probe lowers quality further if the first ~2.5 s are slow.
- **Reduced motion:** slower, gentler breathing; no shockwaves, no leaning.
- **No WebGL, a lost context or a failed load:** the old canvas field (`HudField`) is shown instead.
- **`?world=full`:** pins full quality, for checking the look on a slow machine.

## Smoke and mist

- **Smoke in the galaxy.** It's a 64³ density grid, `public/jarvis/smoke_64.bin` (256 KB raw, compresses well), which the browser ray-marches. It's drawn wide and flattened into the disc, kept off the spiral's centre so the arms stay readable, with tendrils reaching past the edge. Below a density floor there is no smoke at all, so the gaps stay dark and the folds read as depth.
  - **The grid:** it adds finer procedural tearing on top of the grid's shapes. The colour runs teal → violet → magenta → gold.
  - **Light and shadow:** the core lights it, so its inner folds go dark and its outer edges catch the light.
  - **Motion:** it swells with each breath and eddies back and forth.
  - **Two ways to make the grid:**
    - `bake_smoke.py` runs a real Mantaflow smoke sim in Blender: a central emitter, a vortex and turbulence. Use it with a full Blender install.
    - `smoke_field.py` writes the same file with numpy, using tracers carried by curl noise and swirl. It needs no fluid solver, and it's what made the current file. The pip `bpy` module ships Mantaflow broken.
- **Smoke round the ring.** Procedural: a billowing horizontal band with fine wisps that runs only round the ring and flows Kepler-style (inner faster). It thins on the side nearest you.
- **Smoke behind the galaxy.** Two large planes, far and farther, drawn with domain-warped fractal noise into billowing, folded colour. Each is heavier on one side and clear round the galaxy; they drift slowly, lean toward the pointer, and slide at different speeds as it moves (parallax).
- **Backdrop.** v3's faint coloured nebula (desktop) over a plain deep-space sphere, so the bloom settles on near-black.
- **Rings and the ball.** Ring stars that pass behind the ball are hidden by it.

```
python tools/jarvis-world/smoke_field.py --out public/jarvis/smoke_64.bin
# or, with full Blender:
blender --background --python tools/jarvis-world/bake_smoke.py -- --out public/jarvis/smoke_64.bin
```

# YouTube videos — hero (Blender → web)

The 3D reel at the top of `/apps/youtube-videos` (and the Jarvis Dashboard widget's sheet) is
modeled in Blender by `build_hero.py` and played live in the browser by
`src/components/youtube-videos/ReelHero.tsx`. Skills: **blender-to-web** (tier 1, living hero)
for the asset, **scroll-craft** for the layered page around it.

## Build

```bash
# with the bpy wheel (Python 3.11)
python build_hero.py --direction holo --out ../../public/youtube-videos --samples 64
# or with Blender installed
blender --background --python build_hero.py -- --direction holo --out ../../public/youtube-videos
```

Writes `hero-<direction>.glb` (Draco level 6), a 16:9 and a 9:16 Cycles render. The page uses
the renders as its poster (converted to `.webp`): shown while the GLB loads, and for good when
there is no WebGL or the context is lost. `--no-render` exports the GLB only.

Recorded: Blender 5.0.1 (bpy wheel), Cycles CPU, 64 samples + denoise, AgX.
`holo` (shipped): 47 objects, 15k triangles, 109 KB GLB.

## Contract with the page

| Part | Name | Web behaviour |
|---|---|---|
| Play prism | `core` | turns, follows the pointer, pulses when a tile lands |
| Video tiles | `tile_00`…`tile_09` (+ `_screen`, `_glow` children) | a ring the visitor drags to spin (inertia, idle attract spin); each wears a saved video's thumbnail; hover lifts it, flares its frame and shows a HUD callout; click plays that video; a saved link flies in from the paste box |
| Orbit rings | `orbit_0`, `orbit_1` | slow counter-rotation; with the frames, what the bloom pass lights |
| Near plane | `fleck_00`…`fleck_13` | move most with the pointer |

Cycles lights do not survive glTF; `ReelHero.tsx` rebuilds the `night` rig (key `#ffd6c8`,
rim `#3fd6ff`, fill `#9a7bff`) plus a dim RoomEnvironment for reflections. Phones drop the
glass transmission pass for opacity.

## Directions

| | Direction | Ground | Tiles | Assembly |
|---|---|---|---|---|
| — | `holo` Holo Deck (shipped, v2) | `#05060a` | glass screens + glowing frames | spinnable ring |
| A | `reel` Night Reel (v1) | `#07080c` | glass slabs with glowing screens | rising helix |
| B | `deck` Paper Deck | `#ece6dc` | matte ceramic cards | fanned hand |
| C | `jellies` Screen Jellies | `#2b2440` | rounded glass TV bubbles | drifting cluster |

Switching direction = build it, then change `GLB` / `POSTER` in `YouTubeVideosApp.tsx` and the
ground tokens in `ytv.css`.

# YouTube videos — hero (Blender → web)

The 3D reel at the top of `/apps/youtube-videos` (and the Jarvis Dashboard widget's sheet) is
modeled in Blender by `build_hero.py` and played live in the browser by
`src/components/youtube-videos/ReelHero.tsx`. Skills: **blender-to-web** (tier 1, living hero)
for the asset, **scroll-craft** for the layered page around it.

## Build

```bash
# with the bpy wheel (Python 3.11)
python build_hero.py --direction reel --out ../../public/youtube-videos --samples 64
# or with Blender installed
blender --background --python build_hero.py -- --direction reel --out ../../public/youtube-videos
```

Writes `hero-<direction>.glb` (Draco level 6), a 16:9 and a 9:16 Cycles render. The page uses
the renders as its poster (converted to `.webp`): shown while the GLB loads, and for good when
there is no WebGL or the context is lost. `--no-render` exports the GLB only.

Recorded: Blender 5.0.1 (bpy wheel), Cycles CPU, 64 samples + denoise, AgX.
`reel`: 33 objects, 9.3k triangles, 77 KB GLB.

## Contract with the page

| Part | Name | Web behaviour |
|---|---|---|
| Play prism | `core` | breathes, turns toward the pointer, pulses when a tile lands |
| Video tiles | `tile_00`…`tile_08` (+ `_screen` child) | wear the newest saved thumbnails, lean toward the pointer, deal down/out on scroll; a saved link flies one in from the paste box |
| Near plane | `fleck_00`…`fleck_13` | move most with the pointer |

Cycles lights do not survive glTF; `ReelHero.tsx` rebuilds the `night` rig (key `#ffd6c8`,
rim `#3fd6ff`, fill `#9a7bff`) plus a dim RoomEnvironment for reflections. Phones drop the
glass transmission pass for opacity.

## Directions

| | Direction | Ground | Tiles | Assembly |
|---|---|---|---|---|
| A | `reel` Night Reel (shipped) | `#07080c` | glass slabs with glowing screens | rising helix |
| B | `deck` Paper Deck | `#ece6dc` | matte ceramic cards | fanned hand |
| C | `jellies` Screen Jellies | `#2b2440` | rounded glass TV bubbles | drifting cluster |

Switching direction = build it, then change `GLB` / `POSTER` in `YouTubeVideosApp.tsx` and the
ground tokens in `ytv.css`.

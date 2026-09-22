# Tier-3 recipes

Executable recipes for each discipline in [igloo-tier.md](igloo-tier.md). Ownership rule:
**each number lives in exactly one place — this file (rendering/technique), recipes-world.md
(its own sections), igloo-tier.md (design intent and ship budgets)**. Other files link to the
owner instead of repeating a value. World, interior, loader, framing, font, sound-sourcing,
DOM-sync and cursor recipes live in [recipes-world.md](recipes-world.md). Each recipe: when/why,
code, numbers, gotchas.

**Versions (one pin set, used by every snippet):** three **0.171.0**, postprocessing **6.39.2**
(its peer range is `three >= 0.168 < 0.186`, which is why three is pinned there), gsap 3.15.0,
three-mesh-bvh 0.8.3, detect-gpu 5.0.70, lenis 1.3.25, and **Blender 4.2–5.x** (Blender code
finds nodes by `type`, never by name, and validates or try-assigns enums). r186 is the
reference project's version; features that exist only there are marked **r186 only** with the
0.171 alternative next to them.

**Contents:** [canonical numbers](#canonical-numbers) · [import map](#import-map-and-vendoring) ·
[lightmap + AO bake](#lightmap-and-ao-bake) · [camera path](#camera-path-export-and-scroll-mapping) ·
[scroller](#virtual-scroll-controller) · [post stack](#post-processing-stack) ·
[particles](#particle-morph-gpgpu) · [transitions](#scene-transitions) ·
[refraction](#refractive-and-crystal-materials) · [material presets](#signature-material-presets) ·
[light rigs](#light-rig-per-mood) · [volumes](#volumes) · [compression](#compression-and-loaders) ·
[GPU tiers + reduced motion](#gpu-tiers-and-adaptive-quality) · [fog](#fog-with-custom-shaders) ·
[terrain](#terrain-detail) · [assembly intro](#hero-assembly-intro) ·
[text + chrome](#text-reveal-and-chrome) · [sound](#sound-graph). Head/SEO/noscript, fonts,
DOM sync and the reduced-motion cross-fade live in [recipes-world.md](recipes-world.md).

What was checked where (and what was not):

| Claim | Checked against |
|---|---|
| `transmissionResolutionScale` exists in r186 and **not** in 0.171 (0.171 sizes the transmission target to the full viewport); `dispersion`, `compileAsync` exist | vendored r186 (`assets/reference-project/outputs/infinity-site/vendor/three/`) and 0.171 `WebGLRenderer.js` |
| `anisotropy`/`anisotropyRotation`, `sheen*`, `iridescence*`, `dispersion` on `MeshPhysicalMaterial` | three 0.171 `src/materials/MeshPhysicalMaterial.js` |
| Loader `flipY` defaults, EXR row order and `generateMipmaps = false` default, `lightMap`/`aoMap` shader maths, GLSL3 output rules | three 0.171 source in the hub's `node_modules/three` |
| GLTFLoader names objects with `PropertyBinding.sanitizeNodeName` (whitespace → `_`, `[ ] . : /` removed) plus `_1`, `_2` on duplicates, keeps the raw node name in `userData.name`, and copies node and mesh `extras` into `userData` | three 0.171 `examples/jsm/loaders/GLTFLoader.js` (`createUniqueName`, `assignExtrasToUserData`), `src/animation/PropertyBinding.js` |
| `EffectComposer.render(deltaTime)` takes only a time delta (Noise and other effects read it) | postprocessing 6.39.2 build |
| Effect merge rules, effect sort order, Noise/Vignette/CA shader code, AGX default; `SMAAEffect` is `CONVOLUTION \| DEPTH`, MEDIUM edge threshold 0.1; `EffectComposer` has its own depth buffer by default | postprocessing 6.39.2 build in the hub's `node_modules` |
| `Flip.js` imports `./utils/matrix.js` (other plugins import `./utils/*.js` too); three-mesh-bvh 0.8.3 ships `build/index.module.js` importing bare `three` (peer `>= 0.159`) | gsap 3.15.0 / three-mesh-bvh 0.8.3 in the hub's `node_modules` |
| `HDRLoader` (the r180+ name of `RGBELoader`); the exact release that added `transmissionResolutionScale` | not checked locally |
| All `bpy` code | not executed (no Blender on the authoring machine); RNA-filtered and try/except-guarded |

**Direction tokens.** Code below never hard-codes a look. Colours, glyph sets and chrome type
come from one object built from the approved direction (see [brief.md](brief.md)); the values
here are placeholders so snippets run:

```js
export const DIR = {
  palette: {                       // linear-ish scene colours, hex; one family per direction
    ground: 0x1a1a1a, ink: 0xf2efe9, accent: 0xffb000,
    glow: 0xffd27a,                // particle/emissive base (hot core is white × 4 on top)
    haze: 0xd8d2c8,                // volume and fog tint
    tint: 0xcfe6ff,                // transmission attenuation (glass/ice/liquid body colour)
    key: 0xffe2b8, fill: 0xb8c8ff, rim: 0xffffff,   // light rig, see "Light rig per mood"
  },
  type: {
    glyphs: 'abcdefghijklmnopqrstuvwxyz',          // reveal glyph set; a direction may pick 0-9, runes, symbols
    chrome: { font: 'Inter, system-ui, sans-serif', case: 'none', size: 12, weight: 500, tracking: '0.02em' },
  },
};
```

---

## Canonical numbers

Rendering and technique numbers. Every section of this file uses these values; change them here
first. Numbers owned by recipes-world.md sections and by igloo-tier.md (design intent, ship
budgets) are not repeated here. Per-preset material values and per-mood light ratios live only in
their own tables: [signature material presets](#signature-material-presets) and
[light rig per mood](#light-rig-per-mood).

| Topic | Value |
|---|---|
| Scroll travel | `length` 6000 px of wheel delta for the whole site (4000–8000) |
| Scroll damping | 6 /s, frame-rate independent (`1 - exp(-dt*6)`, ≈ 0.1 lerp at 60 fps) |
| Soft snap | after 300 ms idle, 4 /s toward the nearest section rest time inside the allowed range; never while a finger is down, touch inertia runs or a threshold transition holds the lock |
| Touch multiplier | 2.5 (2–3) |
| Touch inertia | velocity = pushed px over the last **100 ms** of `touchmove`; after `touchend` push `v·dt` each frame, `v *= exp(-dt·4)`; stop below **30 px/s** |
| Emissive | `emissiveIntensity` 3–8 so glow exceeds bloom threshold 1; lit surfaces stay < 1 |
| Bloom | threshold 1.0, smoothing 0.1, `mipmapBlur`, radius 0.7, intensity **1.0** default, per-section 0.6–1.5 |
| Tone mapping | `ToneMappingMode.AGX`, exactly once |
| Vignette | `offset 0.4, darkness 0.4` → corners ≈ 0.48× brightness, edge midpoints ≈ 0.93× |
| Grain | `NoiseEffect({ premultiply: true, blendFunction: SCREEN })`, opacity **0.2** (0.15–0.3) → ≤ 0.05 grain in midtones |
| Chromatic aberration | offset 0.0008 at rest, plus `abs(velocity) × 0.004`, clamp 0.004; radial, `modulationOffset` 0.2 |
| Scene transition | **1.2 s** (0.9–1.4), `expo.inOut`, mask progress 0 → 1.1; scrubbed band half-width **ε = 0.02** of total progress; transition "whoosh" one-shot length = transition length (1.2 s) |
| Assembly intro | 1.6 s per part, `expo.out`, stagger 40 ms (total stagger ≤ 0.8 s), auto-plays to 35 %, scroll 0–0.12 finishes it; offset 1–2× part size, rotation ±15° |
| Text reveal (scramble) | 50 ms per char (40–60), whole reveal ≤ 600 ms |
| Chrome text size | never below **11 px** on desktop, **12 px** on phones (coarse pointer or width < 768 px); restack, never shrink |
| Particles (texture edge) | tier 0: 128² (16k) · tier 1: 256² (65k) · tiers 2–3: 512² (262k); CPU fallback 8k only if GPGPU fails |
| Transmission | tiers 2–3 only; tiers 0–1 use the fake fallback. r186 only: `transmissionResolutionScale` 0.5 on tier 2, 1 on tier 3. On 0.171 the transmission target is always full drawing-buffer size, so tier 2 keeps the DPR cap below |
| Anti-aliasing | tier 0: canvas `antialias: true`, no composer · tier 1: `SMAAEffect` MEDIUM in its own pass · tiers 2–3: composer `multisampling` 4 |
| Volumes | tiers 2–3: 64³, 40 steps · tier 1: 64³, 24 steps, max one volume · tier 0: no raymarch, 2–3 soft alpha cards |
| Pixel ratio cap | 1 / 1.25 / 1.5 / 2 for tiers 0–3 |
| Frame monitor | **median** frame time per 2 s window, first 2 s after load/transition skipped. Target is per device: fine pointer → 60 fps, step down when median > **20 ms**; coarse pointer (phones/tablets) → 30 fps, step down when median > **38 ms**. 2 slow windows in a row → one tier down, never up in-session; at tier 0, median > 50 ms (fine) / 66 ms (coarse) twice → poster |
| Draw budget (tier 2) | ≤ 150 draw calls, ≤ 1.5 M triangles |
| Lightmaps | `lightMapIntensity` π (× `maxValue` for a normalized map); 1024² props, 2048² hero, 4096² one shared world atlas, all capped by the texture budget in [igloo-tier.md §8](igloo-tier.md#8-budgets-and-quality-tiers); margin 8 px per 2048; trilinear mips (`LinearMipmapLinearFilter`) where the format allows them. **Ship** UltraHDR JPEG or normalized UASTC KTX2; EXR half is for dev only |
| Lightmap blend (per-section light change) | two lightmaps on the same UV1 atlas, mix 0 → 1 over the section's scrubbed band (ε above) |
| AO map | `aoMapIntensity` 1 when no DIFFUSE lightmap; **0.4** (0.3–0.5) when a DIFFUSE lightmap exists |
| Fog | `FogExp2` density 0.02–0.05 for a 50–100 m world; height fog 0–2 m, falloff 0.3–0.8 |
| Loudness | stems and one-shots mastered to **−18 LUFS** integrated (true peak ≤ −1 dBTP); bed ducked −6 dB under one-shots |

**Tier policy.** Every tier is live 3D. The poster path is only for: `detect-gpu` `g.type` of
`WEBGL_UNSUPPORTED` or `BLOCKLISTED` (or no WebGL2, which three r163+ requires), or a runtime
failure at the lowest tier. A `BENCHMARK` result of tier 0 is still live 3D with tier-0 settings.
**Reduced motion is not the poster path**: the live renderer keeps running and draws one settled
frame per section change, sections cross-fade (see [GPU tiers](#gpu-tiers-and-adaptive-quality)).

---

## Import map and vendoring

Every snippet imports `three`, `three/addons/...`, `postprocessing`, `gsap`, `gsap/...`,
`three-mesh-bvh`, `detect-gpu` and `lenis` as bare specifiers. Pick one of three setups; all
three use the one pin set from the top of this file.

**A. CDN import map (fastest to start).** Load postprocessing's raw `build/index.js` and
three-mesh-bvh's `build/index.module.js` (both import bare `three`, resolved by this map); never
jsDelivr's `/+esm` for them, which bundles a second copy of three.

```html
<script type="importmap">{"imports":{
  "three":          "https://cdn.jsdelivr.net/npm/three@0.171.0/build/three.module.js",
  "three/addons/":  "https://cdn.jsdelivr.net/npm/three@0.171.0/examples/jsm/",
  "postprocessing": "https://cdn.jsdelivr.net/npm/postprocessing@6.39.2/build/index.js",
  "three-mesh-bvh": "https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.8.3/build/index.module.js",
  "gsap":           "https://cdn.jsdelivr.net/npm/gsap@3.15.0/index.js",
  "gsap/":          "https://cdn.jsdelivr.net/npm/gsap@3.15.0/",
  "detect-gpu":     "https://cdn.jsdelivr.net/npm/detect-gpu@5.0.70/dist/detect-gpu.esm.js",
  "lenis":          "https://cdn.jsdelivr.net/npm/lenis@1.3.25/dist/lenis.mjs"
}}</script>
```

Decoder paths on the CDN: `.../three@0.171.0/examples/jsm/libs/basis/` and `.../libs/draco/gltf/`.
`detect-gpu` fetches its benchmarks from unpkg by default; pass `benchmarksURL` to self-host.

**B. Vendored (offline, what ships).** Same map with local paths. The reference project
(`assets/reference-project/outputs/infinity-site/vendor/three/`) vendors r186 **flat, with no
addons**: `three.module.js`, `three.core.js` and a hand-trimmed `GLTFLoader.js` whose relative
imports were rewritten to `./BufferGeometryUtils.js` and `./SkeletonUtils.js`. Do not copy that
pattern for more addons; they import `../libs/…`, `../utils/…`, `../math/…`. Copy the tree:

```bash
npm i three@0.171.0 postprocessing@6.39.2 gsap@3.15.0 three-mesh-bvh@0.8.3 detect-gpu@5.0.70 lenis@1.3.25
mkdir -p site/vendor/three site/vendor/postprocessing site/vendor/gsap site/vendor/three-mesh-bvh site/vendor/detect-gpu site/vendor/lenis
cp node_modules/three/build/three.module.js node_modules/three/build/three.core.js site/vendor/three/
cp -r node_modules/three/examples/jsm site/vendor/three/addons        # keeps libs/basis, libs/draco, utils, math
cp node_modules/postprocessing/build/index.js site/vendor/postprocessing/
cp node_modules/gsap/*.js site/vendor/gsap/                             # index.js imports ./gsap-core.js, ./CSSPlugin.js
cp -r node_modules/gsap/utils site/vendor/gsap/                         # Flip.js -> ./utils/matrix.js; MotionPath, Draggable, SplitText too
cp node_modules/three-mesh-bvh/build/index.module.js site/vendor/three-mesh-bvh/
cp node_modules/detect-gpu/dist/detect-gpu.esm.js site/vendor/detect-gpu/
cp -r node_modules/detect-gpu/dist/benchmarks site/vendor/detect-gpu/
cp node_modules/lenis/dist/lenis.mjs site/vendor/lenis/
```
```html
<script type="importmap">{"imports":{
  "three": "./vendor/three/three.module.js", "three/addons/": "./vendor/three/addons/",
  "postprocessing": "./vendor/postprocessing/index.js",
  "three-mesh-bvh": "./vendor/three-mesh-bvh/index.module.js",
  "gsap": "./vendor/gsap/index.js", "gsap/": "./vendor/gsap/",
  "detect-gpu": "./vendor/detect-gpu/detect-gpu.esm.js", "lenis": "./vendor/lenis/lenis.mjs"
}}</script>
```

The gsap package root holds the ES modules (`*.js` + `utils/`); its `dist/` folder is the UMD
build and is not needed with an import map. Import plugins as `gsap/Flip.js`. Trim `addons/`
afterwards if size matters (keep every file a used addon imports). three r171 and newer builds
import `./three.core.js` from `three.module.js`, so both files are required.

**C. npm + Vite.** `npm i` the same packages; bare specifiers resolve through `package.json`
exports (three maps `three/addons/*` to `examples/jsm/*`). Copy `libs/basis`, `libs/draco` and the
detect-gpu benchmarks into `public/` and point the loaders there.

Moving to r186 (the reference project's version, which adds `transmissionResolutionScale`): check
that a postprocessing release lists r186 in its peer range first, or use the three addons
composer shown under [post-processing](#post-processing-stack). Change the pin in all three
setups at once; never mix versions between the map, `libs/basis`/`libs/draco` and the loaders.

---

## Lightmap and AO bake

The biggest single premium gain: soft contact shadows and bounce light cost zero at runtime.
Bake in Cycles onto a **second UV set** (UV0 stays for tiling albedo/normal textures). AO for
contact darkening everywhere; a DIFFUSE (light-only) lightmap when the lighting is static.

**Blender (runnable):** `scripts/bake_lightmap.py`. One bake per run; a second bake runs on the
first one's saved copy with `--reuse-uv` (same atlas) and saves under a new name, and the GLB is
exported from the **last** file. Pass `--python-exit-code 1` so a Python error fails the shell.

```bash
# 1. AO, wired into glTF occlusion (exports as occlusionTexture, texCoord 1)
blender -b world.blend --python-exit-code 1 --python scripts/bake_lightmap.py -- \
  --objects Hero,Ground --type AO --size 2048 --samples 256 --ao-distance 1.5 \
  --gltf-occlusion --out baked --save-blend baked/world_ao.blend
# 2. Light-only lightmap on the SAME UVs, then export + verify TEXCOORD_1
blender -b baked/world_ao.blend --python-exit-code 1 --python scripts/bake_lightmap.py -- \
  --objects Hero,Ground --type DIFFUSE --size 2048 --samples 512 --reuse-uv \
  --out baked --save-blend baked/world_ao_light.blend --export-glb baked/world.glb
# verify any later GLB (after gltf-transform too) without Blender, against the bake's own names:
python scripts/bake_lightmap.py --verify-glb site/assets/world.glb --uv-index 1 \
  --meshes @baked/lightmap_diffuse.json
```

Always pass `--meshes @<manifest>`: it checks only the baked meshes and fails when one was merged
or renamed. Without `--meshes`, **every** primitive in the file must carry `TEXCOORD_1`, so a GLB
that also holds unbaked props (no UV1) fails.

Without `--reuse-uv` the second run re-packs the atlas and the first bake no longer matches.
Without `--save-blend` each run writes `<out>/<blend>_<image>.blend`, so runs never overwrite
each other; the source `.blend` is never written.

What it does (do the same by hand if needed):

```python
me.uv_layers.new(name="Lightmap")              # index 1 -> glTF TEXCOORD_1
render_uv.active_render = True                   # UV0 still drives textures
me.uv_layers.active = me.uv_layers["Lightmap"]   # bake + unwrap use the ACTIVE layer
bpy.ops.uv.lightmap_pack(PREF_CONTEXT="ALL_FACES", PREF_PACK_IN_ONE=True,
                         PREF_NEW_UVLAYER=False, PREF_MARGIN_DIV=0.1)   # all objects, one atlas
img = bpy.data.images.new("lightmap", 2048, 2048, alpha=False, float_buffer=True)  # AO: False + Non-Color
node = nt.nodes.new("ShaderNodeTexImage"); node.image = img   # UNLINKED, in every material
nt.nodes.active = node                                          # bake target = active image node
scene.render.engine = "CYCLES"; scene.cycles.samples = 512
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=8,
                    margin_type="EXTEND", use_clear=True, target="IMAGE_TEXTURES")
img.filepath_raw = "baked/lightmap.exr"; img.file_format = "OPEN_EXR"; img.save()
```

**Getting `TEXCOORD_1` into the GLB.** The glTF exporter writes the UV sets that exported
textures reference; an image that only exists as an EXR next to the GLB references nothing, so
`Lightmap` can be dropped. The script therefore wires a **UV Map node (`Lightmap`) → Image
Texture → `glTF Material Output` group → `Occlusion` socket** in every baked material:

- `--gltf-occlusion` (AO bakes): the real AO goes there. GLTFLoader turns it into `aoMap` with
  `channel = 1` and `flipY = false`.
- `--keep-uv-ref` (default on for every other bake): a packed 4×4 **white** Non-Color image goes
  there. It changes nothing in Cycles (the group is not connected to the Material Output) and
  nothing in three (`ao = (1 − 1) × intensity + 1`), and costs one tiny texture. An Occlusion
  socket already fed by the Lightmap UV (AO from an earlier run) is kept.
- The group is found by its data name (`glTF Material Output`, older `glTF Settings`), which is
  not localized. The manifest's `uvRef` says which of the two now feeds Occlusion.
- `--export-glb` / `--verify-glb` read the GLB's JSON chunk and **exit non-zero** if any baked
  mesh primitive lacks `TEXCOORD_1` (works on Draco/Meshopt files too). Run the verify again
  after `gltf-transform`; `npx @gltf-transform/cli inspect out.glb` shows the same thing.
- **Tagging for the page.** The script writes a custom property on every baked object and its
  mesh data (`lightmap` = image name for light bakes, `aomap` for AO), and `--export-glb` exports
  with `export_extras=True`, so they land in glTF `extras` and GLTFLoader copies them into
  `userData` (node extras onto the node, mesh extras onto every primitive mesh). The page matches
  on `userData`, never on names: GLTFLoader rewrites names (`PropertyBinding.sanitizeNodeName`:
  whitespace → `_`, `[ ] . : /` dropped; duplicates get `_1`, `_2`). The manifest also records
  each object's `threeName` (sanitized, before any dedupe suffix) and the verify prints the
  sanitized names and how many nodes carry the tag. Exporting by hand: tick **Include → Custom
  Properties**.

| Bake | `type` / filter | Image | Save as | three.js slot |
|---|---|---|---|---|
| AO | `AO` (+ `--ao-distance`) | 8-bit, Non-Color | PNG → KTX2 UASTC, or in the GLB | `aoMap` (R channel) |
| Light only | `DIFFUSE` + `{DIRECT, INDIRECT}` | float, linear | EXR half (dev) + `--normalize 16` PNG → UltraHDR JPEG or UASTC KTX2 (ship) | `lightMap`, intensity **π** (× `maxValue` if normalized) |
| Everything | `COMBINED` | float, linear | same as light only | `MeshBasicMaterial.lightMap`, intensity π (× `maxValue`), white `color`, no `map` |

**Formats per stage.** EXR half is the **dev** format: exact, but 2048² RGBA half is 32 MB on
the GPU and several MB on the wire. **Ship** one of: UltraHDR JPEG (`UltraHDRLoader`, keeps
values > 1, small), or the normalized map encoded as UASTC KTX2 (`--normalize` below, then
`toktx --t2 --encode uastc --uastc_quality 2 --zcmp 18 --genmipmap --assign_oetf srgb`). The atlas edge is
capped by the texture budget in [igloo-tier.md §8](igloo-tier.md#8-budgets-and-quality-tiers)
(the lightmap counts inside it), not only by the sizes in [canonical numbers](#canonical-numbers).
`--normalize 8|16` (light bakes) also writes `<name>_norm.png`: the map divided by its maximum,
sRGB-encoded, 8- or 16-bit, top row first; the manifest records `maxValue` and
`three.normalized` (`colorSpace: SRGBColorSpace`, `lightMapIntensity: π × maxValue`, which
multiplies the range back in the built-in shader). Browsers decode any PNG to 8 bits, so use the
16-bit file only as the encoder's source; the 8-bit file is the direct-load fallback.

**Why π.** In `MeshStandardMaterial` the lightmap is added to irradiance, which the Lambert BRDF
then divides by π; `MeshBasicMaterial` multiplies the lightmap by `RECIPROCAL_PI` directly. Cycles'
DIFFUSE pass is already the outgoing light for albedo 1, so `lightMapIntensity = Math.PI`
reproduces it in both materials.

**`flipY` per format** (glTF UVs have v = 0 at the image top; Blender writes PNG, EXR and HDR top
row first on disk):

| File | Loader | Loader default | Set for glTF UVs | Why |
|---|---|---|---|---|
| PNG / JPEG / WebP | `TextureLoader` | `true` | **`false`** | memory is top-down, like GLTFLoader's own textures |
| KTX2 (`toktx` default orientation) | `KTX2Loader` | `false` | **`false`** | compressed textures cannot be flipped; never pass `--lower_left_maps_to_s0t0` |
| Radiance `.hdr` | `HDRLoader` (`RGBELoader` < r180) | sets `true` | **`false`** | rows decoded top-down |
| OpenEXR | `EXRLoader` | sets `false` | **`true`** | the loader stores rows **bottom-up** (GL convention for env maps) |
| UltraHDR JPEG | `UltraHDRLoader` | sets `true` | **`false`** | rows decoded top-down |
| Anything inside the GLB | `GLTFLoader` | `false` | leave it | already correct |

Set `flipY` before the first upload (or set `needsUpdate = true` after). The bake manifest
(`<out>/<name>.json`) records the right value for the file it saved in `three.flipY`.

**Browser:**

```js
import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

const man = await (await fetch('baked/lightmap_diffuse.json')).json();   // written by bake_lightmap.py
// DEV: the float EXR. SHIP: the normalized map (man.three.normalized) as KTX2/UltraHDR, see below.
const lm = await new EXRLoader().loadAsync('baked/' + man.image);
lm.flipY = man.three.flipY;               // EXR: true (table above)
lm.channel = man.three.channel;           // 1 = TEXCOORD_1 (uv2 was removed; .channel since r151)
lm.colorSpace = THREE.LinearSRGBColorSpace;
// EXRLoader sets generateMipmaps = false + LinearFilter. Mipmapping a half-float texture needs it to
// be colour-renderable, which WebGL2 only grants with one of these extensions:
const mipHalf = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
lm.generateMipmaps = mipHalf;
lm.minFilter = mipHalf ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;  // no mips: some distant shimmer
lm.needsUpdate = true;
let intensity = Math.PI;                  // normalized map instead: Math.PI * man.maxValue
gltf.scene.traverse(o => {
  // match on the tag the bake wrote (glTF extras -> userData), never on o.name: GLTFLoader sanitizes
  // and dedupes names. Mesh extras sit on every primitive mesh, so multi-material Groups work too.
  if (!o.isMesh || o.userData.lightmap === undefined) return;
  const m = o.material;
  if (man.uvRef === 'neutral-occlusion') m.aoMap = null;   // the white carrier did its job at export
  m.lightMap = lm;
  m.lightMapIntensity = intensity;
  if (m.aoMap) m.aoMapIntensity = 0.4;    // AO from --gltf-occlusion on top of a DIFFUSE lightmap
  m.needsUpdate = true;
  o.userData.baked = true;                // later code (tier swaps, blends) keys on this flag
});
// SHIP, normalized UASTC KTX2 (8-bit, sRGB-encoded, KTX2 is never flipped, mips inside the file):
//   const lm = await ktx2.loadAsync('baked/lightmap_diffuse_norm.ktx2');   // ktx2 from "Compression and loaders"
//   lm.channel = 1; lm.colorSpace = THREE.SRGBColorSpace; intensity = Math.PI * man.maxValue;
// SHIP, UltraHDR JPEG: new UltraHDRLoader().loadAsync(...), flipY = false, LinearSRGBColorSpace,
//   intensity π, and the same mip guard as the EXR (it decodes to HalfFloat).
// A separate AO file: ao.flipY = false (PNG/KTX2); ao.channel = 1; ao.colorSpace = THREE.NoColorSpace;
```

No tag on the meshes (a GLB exported by hand without Custom Properties)? Fall back to names, run
through the same sanitizer the loader uses:
`const key = n => THREE.PropertyBinding.sanitizeNodeName(n)` and compare
`key(man.objects[i].object)` (= `man.objects[i].threeName`) with `o.name.replace(/_\d+$/, '')`
or with `o.userData.name` (GLTFLoader keeps the raw node name there). Suffix stripping is
ambiguous when a raw name already ends in `_<digits>`; the tag is not.

Gotchas:
- **Fully baked surfaces → `MeshBasicMaterial`** (`map` = albedo on UV0, `lightMap` on UV1,
  intensity π). No lights, no shadow maps, cheapest possible, and it looks like the Cycles render.
  Add real lights only for the rim/animated glow on top (`MeshStandardMaterial` + lightMap).
- **Double occlusion.** `aoMap` multiplies **indirect** light, and in three the lightmap *is*
  indirect light. A DIFFUSE/COMBINED bake already contains the contact shadowing, so AO on top
  darkens it twice: use `aoMapIntensity` 0.4 (0.3–0.5) there, or drop the AO. Full-strength AO
  belongs on surfaces lit by IBL/env, hemisphere or ambient light without a lightmap. It does
  nothing under a lone directional light; that is correct, not a bug.
- `--ao-distance` sets `world.light_settings.distance` (metres): 0.5–1 m for props, 1–3 m for
  rooms and terrain. Too long = everything grey; too short = no contact darkening.
- A raw 8-bit lightmap clips bright bounce (> 1) and bands in gradients. That is why the shipped
  forms are UltraHDR JPEG (keeps > 1) or the `--normalize` map (range restored by
  `lightMapIntensity = π × maxValue`; sRGB encoding spends the 8 bits where the eye sees banding)
  in UASTC KTX2, never ETC1S. The script warns when one firefly sets `maxValue` (max far above
  the 99.9th percentile): denoise first or the whole map goes dark and coarse.
- Bakes are **not denoised**. Raise samples (AO 256, DIFFUSE 512–1024) or denoise the saved
  image (Compositor Denoise node / OIDN CLI) before shipping.
- Shared/instanced meshes need unique UVs → the script makes them single-user. Keep instanced
  scatter (rocks, snow chunks) out of the lightmap; give them a per-mesh AO instead.
- Geometry Nodes and some modifiers drop or rewrite UVs: apply them before baking.
- Seams bleeding dark: raise `--margin` and `--pack-margin`, and use linear mipmaps.
- Procedural materials need their channels baked before export too: see
  [baking procedural materials](recipes-world.md#baking-procedural-materials-to-textures).

---

## Camera path export and scroll mapping

Author the whole journey as one camera move in Blender (Follow Path / keyframes / Track To),
with **timeline markers** as section rest points. Export by sampling, scrub by scroll progress.

```bash
blender -b world.blend --python-exit-code 1 --python scripts/export_camera_path.py -- --out site/assets/camera.json --step 1
# optional: bake + GLB for AnimationMixer
blender -b world.blend --python-exit-code 1 --python scripts/export_camera_path.py -- --bake-action --glb site/assets/camera.glb
```

The script samples `matrix_world` per frame after `frame_set()` (constraints, drivers, parents all
evaluated), converts to Y-up (`(x,y,z)→(x,z,-y)`, a pure left-multiply for cameras), keeps quats
in one hemisphere, always includes the end frame, and writes
`{fps, frameStart, frameEnd, aspect, fovConstant, frames:[{f,p,q,fov,hfov}], markers:[{name,frame,t}]}`
with `fov`/`hfov` computed from the sensor fit exactly as Blender renders.

glTF route, if you prefer it: `bpy.ops.nla.bake(visual_keying=True, clear_constraints=True,
bake_types={'OBJECT'})`, then `export_scene.gltf(export_cameras=True, export_animations=True,
export_force_sampling=True, export_yup=True, use_selection=True)`. **Animated focal length does not
survive** (needs `KHR_animation_pointer`): keep FOV constant or use the JSON track.

```js
const track = await (await fetch('assets/camera.json')).json();
const F = track.frames, f0 = track.frameStart, span = track.frameEnd - track.frameStart;
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), pb = new THREE.Vector3();
const { degToRad, radToDeg, clamp, lerp } = THREE.MathUtils;
// narrower than authored (portrait): hold the authored HORIZONTAL fov; wider: keep vertical fov
const vfovFor = (s, aspect) => aspect >= track.aspect ? s.fov
  : radToDeg(2 * Math.atan(Math.tan(degToRad(s.hfov) / 2) / aspect));
function sampleCamera(cam, t) {                        // t = damped scroll progress, 0..1
  const f = f0 + clamp(t, 0, 1) * span;                // map by FRAME number, not array index
  let lo = 0, hi = F.length - 1;                       // binary search: F[lo].f <= f <= F[hi].f
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (F[mid].f <= f) lo = mid; else hi = mid; }
  const a = F[lo], b = F[hi], k = b.f > a.f ? (f - a.f) / (b.f - a.f) : 0;
  cam.position.set(...a.p).lerp(pb.set(...b.p), k);
  cam.quaternion.copy(qa.set(...a.q)).slerp(qb.set(...b.q), k);
  if (a.fov === undefined) return undefined;           // orthographic track: use orthoScale instead
  const fov = lerp(vfovFor(a, cam.aspect), vfovFor(b, cam.aspect), k);
  if (Math.abs(fov - cam.fov) > 1e-4) { cam.fov = fov; cam.updateProjectionMatrix(); }
  return fov;                                          // vertical fov applied (portrait framing reads it)
}
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  sampleCamera(camera, scroller.progress);            // re-derive the fov for the new aspect
  renderer.setSize(innerWidth, innerHeight); composer?.setSize(innerWidth, innerHeight);
}
// AnimationMixer alternative: const action = mixer.clipAction(gltf.animations[0]); action.play(); action.paused = true;
// each frame: mixer.setTime(progress * clip.duration);  (camera = gltf.cameras[0]; call updateProjectionMatrix on resize)
```

Sections come from markers (their `t` is `(frame − frameStart) / span`, the same mapping):
`sections = track.markers.map((m, i, a) => ({ id: m.name, t: m.t, t1: a[i + 1]?.t ?? 1,
copy: '#s-' + m.name, post: { bloom: 1.0, ca: 0 } }))`.

Gotchas: call `sampleCamera` **after** damping (next section), never with raw input. Sample at the
render fps (step 1–2); Bezier ease in Blender is baked in, so do not ease again in JS. Add a tiny
idle sway (±2 cm, ±0.3°, 0.1–0.2 Hz) on top so rest shots are not dead. Lens shift needs
`camera.setViewOffset` (the script warns). The hfov hold keeps the hero whole on phones; a
real portrait composition (a second camera track or per-section offsets) is in
[portrait framing](recipes-world.md#portrait-framing).

---

## Virtual scroll controller

The document never scrolls: the page is `position: fixed`, input deltas move a **target
progress**, and a damped **progress** drives everything. Lenis `virtualScroll` is only an
event filter callback, NOT a progress source; do not build on it.

```js
export function createScroller({ sections /* [{ id: 'intro', t: 0 }, …] from markers */, length = 6000 }) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const s = { target: 0, progress: 0, velocity: 0, idle: 0, locked: false };
  const clamp = v => Math.min(1, Math.max(0, v));
  const push = d => { if (s.locked) return; s.target = clamp(s.target + d / length); s.idle = 0; };
  const el = e => (e.target instanceof Element ? e.target : null);
  const inPanel = e => el(e)?.closest('[data-scrollable]');          // panels keep native scrolling

  addEventListener('wheel', e => {
    if (e.ctrlKey || inPanel(e)) return;                              // pinch-zoom + scrollable panels
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1; // lines/pages -> px
    fling = 0; push(e.deltaY * k);                                     // wheel cancels touch inertia
  }, { passive: false });

  // touch: direct drag, then inertia (velocity over the last 100 ms, decays at 4 /s, stops < 30 px/s)
  let ty = null, hist = [], fling = 0;                                // hist: [t ms, pushed px]
  addEventListener('touchstart', e => { ty = inPanel(e) ? null : e.touches[0].clientY; hist = []; fling = 0; },
    { passive: true });
  addEventListener('touchmove', e => { if (ty === null) return;
    const y = e.touches[0].clientY, d = (ty - y) * 2.5, now = performance.now();
    push(d); ty = y; hist.push([now, d]);
    while (hist.length && now - hist[0][0] > 100) hist.shift();     // keep the last 100 ms
  }, { passive: true });
  addEventListener('touchend', () => {
    if (ty === null) return; ty = null;
    const now = performance.now(); hist = hist.filter(h => now - h[0] <= 100);
    const span = hist.length > 1 ? (now - hist[0][0]) / 1000 : 0;   // a finger resting 100 ms = no fling
    fling = span > 0 ? hist.reduce((a, h) => a + h[1], 0) / span : 0; // px/s
  }, { passive: true });

  addEventListener('keydown', e => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = el(e);
    if (t?.closest('input, textarea, select, [contenteditable], [data-scrollable]')) return; // fields keep every key
    if (e.key === ' ' && t?.closest('button, a[href], summary, label, [role="button"]')) return; // Space activates them
    const page = innerHeight * 0.9;
    const map = { ArrowDown: 80, ArrowUp: -80, PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page };
    if (e.key === 'Home') go(0); else if (e.key === 'End') go(sections.length - 1);
    else if (e.key in map) push(map[e.key]); else return;
    e.preventDefault();
  });

  const indexOf = id => sections.findIndex(x => x.id === id);
  s.snapMin = 0; s.snapMax = 1;                        // rests outside this range are never snap targets
  const nearest = () => sections.reduce((b, x, i) => x.t < s.snapMin || x.t > s.snapMax ? b
    : b < 0 || Math.abs(x.t - s.target) < Math.abs(sections[b].t - s.target) ? i : b, -1);
  const go = (i, instant = false) => {
    if (i < 0 || i >= sections.length) return;
    s.target = sections[i].t; s.idle = 0; fling = 0;
    if (reduce || instant) s.progress = s.target;
  };
  // keyboard focus moves the camera: section nav links carry data-i, section content data-section="<id>"
  addEventListener('focusin', e => {
    const a = el(e)?.closest('[data-i], [data-section]'); if (!a) return;
    go(a.dataset.i !== undefined ? +a.dataset.i : indexOf(a.dataset.section));
  });
  const fromHash = instant => go(indexOf(decodeURIComponent(location.hash.slice(1))), instant);
  addEventListener('hashchange', () => fromHash(false));
  fromHash(true);                                      // deep link on load: jump, no fly-through

  s.go = go; s.indexOf = indexOf;
  s.update = dt => {                                   // call once per frame, dt in seconds
    if (fling && !reduce) {                            // touch inertia (keeps idle at 0 while it runs)
      push(fling * dt); fling *= Math.exp(-dt * 4);
      if (Math.abs(fling) < 30 || s.target <= 0 || s.target >= 1) fling = 0;
    }
    s.idle += dt;
    const n = s.idle > 0.3 && ty === null && !fling && !s.locked ? nearest() : -1;  // no snap mid-drag,
    if (n >= 0) s.target += (sections[n].t - s.target) * (1 - Math.exp(-dt * 4));  // mid-fling or locked
    const prev = s.progress;
    s.progress = reduce ? s.target : s.progress + (s.target - s.progress) * (1 - Math.exp(-dt * 6));
    s.velocity = (s.progress - prev) / Math.max(dt, 1e-4);   // progress/sec: feeds post, sound, CA
    return s.progress;
  };
  return s;
}
```

```html
<body>
<a class="skip sr-only-focusable" href="#content">Skip to content</a>   <!-- first tab stop -->
<nav class="sections sr-only-focusable" aria-label="Sections">   <!-- hidden until focused -->
  <a href="#intro" data-i="0">Intro</a><a href="#manifesto" data-i="1">Manifesto</a> …
</nav>
<canvas class="stage"></canvas>
<main id="content" tabindex="-1">
  <section id="manifesto" data-section="manifesto">…copy, links, a <div data-scrollable> list…</section>
</main>
```
```css
html { overscroll-behavior: none; }                  /* no pull-to-refresh / rubber band */
body { position: fixed; inset: 0; overflow: hidden; }
.stage, #root { touch-action: none; }                /* the scroller owns touch on the stage */
[data-scrollable] { overflow: auto; overscroll-behavior: contain; touch-action: pan-y; }
.sr-only-focusable a:not(:focus-visible), a.skip:not(:focus-visible) { position: absolute; width: 1px;
  height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.sr-only-focusable a:focus-visible, a.skip:focus-visible { position: fixed; z-index: 10; /* placed and styled per direction */ }
```
```js
document.querySelectorAll('nav.sections a[data-i]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); history.replaceState(null, '', a.hash); scroller.go(+a.dataset.i);
}));
```

Numbers: [canonical](#canonical-numbers) (length 6000, damping 6/s, snap after 300 ms at 4/s,
touch 2.5, touch inertia 100 ms / 4 /s / 30 px/s). Reduced motion: no damping, no inertia,
jumps instantly, no sway/CA/particle swirl, same story.
`touch-action: none` stops the browser's own pinch-zoom on the stage only: keep all copy in the
DOM so text zoom and browser zoom still work. Cursor and touch affordances:
[cursor and touch states](recipes-world.md#cursor-and-touch-states).

**Alternative with native scroll semantics: tall spacer + Lenis.** Simpler accessibility (the
browser scrolls, find-in-page and scrollbars work), less control over snapping. The canvas stays
`position: fixed`; the body is NOT fixed in this variant (drop the `body { position: fixed }` rule).

```html
<main id="content" class="track" style="position: relative; height: 800vh">  <!-- ≈ length / innerHeight × 100vh -->
  <section id="intro" data-section="intro" class="rest">…</section>
  <section id="manifesto" data-section="manifesto" class="rest">…</section>
</main>
<p class="hud" data-counter aria-hidden="true">01 / 07</p>
<p class="hud" data-hint>Scroll</p>
```
```css
.track > .rest { position: absolute; left: 0; right: 0; min-height: 100vh; }  /* top set from t below */
```
```js
import Lenis from 'lenis';
import { reduce } from './quality.js';            // the one reduced-motion flag (GPU tiers section)
const lenis = new Lenis({ autoRaf: false, lerp: reduce ? 1 : 0.1, syncTouch: false }); // 0.1 ≈ damping 6/s at 60 fps
const rest = sections.map(x => x.t);
const toY = t => t * (document.documentElement.scrollHeight - innerHeight);
// each section's DOM block sits where its rest pose is on the scroll track, so find-in-page,
// focus scrolling and the browser's scroll restoration land on the matching camera pose
function placeSections() {
  sections.forEach(x => { const el = document.getElementById(x.id); if (el) el.style.top = toY(x.t) + 'px'; });
}
placeSections(); addEventListener('resize', placeSections);
let idle = 0, last = -1, shownIdx = -1;
const counter = document.querySelector('[data-counter]'), hint = document.querySelector('[data-hint]');
lenis.on('scroll', () => { idle = 0; });
const nearestRest = p => rest.reduce((b, t, k) => Math.abs(t - p) < Math.abs(rest[b] - p) ? k : b, 0);
function scrollTick(time, dt) {                      // call from the render loop; time in ms, dt in s
  lenis.raf(time);
  const p = lenis.progress;                          // 0..1, already smoothed
  const i = nearestRest(p);
  if ((idle += dt) > 0.3 && !lenis.isScrolling && !reduce) {  // soft snap on idle, once per rest
    if (i !== last && Math.abs(rest[i] - p) > 0.002) { last = i; lenis.scrollTo(toY(rest[i]), { duration: 0.8 }); }
  }
  if (lenis.isScrolling) last = -1;
  if (i !== shownIdx) {                              // counter + hint: once per section change
    shownIdx = i;
    counter.textContent = `${String(i + 1).padStart(2, '0')} / ${String(sections.length).padStart(2, '0')}`;
    hint.hidden = i > 0;                             // the scroll hint only belongs to the first rest
  }
  return p;
}
// anchors / hash / keyboard focus: same ids as the section list
const goId = (id, immediate) => { const i = sections.findIndex(x => x.id === id);
  if (i >= 0) lenis.scrollTo(toY(sections[i].t), { immediate: immediate || reduce }); };
addEventListener('hashchange', () => goId(decodeURIComponent(location.hash.slice(1)), false));
if (location.hash) goId(decodeURIComponent(location.hash.slice(1)), true);  // deep link: jump, no fly-through
document.querySelectorAll('nav.sections a[data-i]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); history.replaceState(null, '', a.hash); goId(a.hash.slice(1), false); }));
addEventListener('focusin', e => {                   // tabbing into a section's content flies the camera there
  const sec = e.target instanceof Element ? e.target.closest('[data-section]') : null;
  if (sec) goId(sec.dataset.section, false);
});
```

The same counter/hint lines work in the virtual scroller's frame loop with
`sectionIndexAt(scroller.progress)` (from the reduced-motion loop below).

Reduced motion here: `lerp: 1` (no smoothing), no snap tween, anchors jump (`immediate`).

---

## Post-processing stack

Bloom on emissive only, one tone map, a vignette, grain, a hint of chromatic aberration. Use
pmndrs `postprocessing` (merges effects into few passes). Values:
[canonical numbers](#canonical-numbers).

```js
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  NoiseEffect, VignetteEffect, ChromaticAberrationEffect, SMAAEffect, SMAAPreset, BlendFunction } from 'postprocessing';
import { renderer, Q, live } from './quality.js';    // the ONE renderer factory (GPU tiers section);
                                                      // load this module with import() after boot() resolved

renderer.toneMapping = THREE.NoToneMapping;           // ToneMappingEffect does it, exactly once
renderer.outputColorSpace = THREE.SRGBColorSpace;     // the last pass encodes sRGB on the way to the canvas

export const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: Q().msaa });
export const renderPass = new RenderPass(scene, camera);   // transitions and the settled loop set its mainScene/mainCamera
composer.addPass(renderPass);

// Pass 1: chromatic aberration alone (a CONVOLUTION effect: it samples its input at offset UVs)
export const ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0008, 0.0008), radialModulation: true, modulationOffset: 0.2 });
export const caPass = new EffectPass(camera, ca);
caPass.enabled = Q().ca;                              // off on tiers 0–1
composer.addPass(caPass);

// Pass 2 ("A"): bloom, tone mapping, vignette, grain, merged into ONE shader, in this order
const bloom = new BloomEffect({ luminanceThreshold: 1.0, luminanceSmoothing: 0.1, mipmapBlur: true, intensity: 1.0, radius: 0.7 });
const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });   // AGX/NEUTRAL need postprocessing >= 6.35
const vignette = new VignetteEffect({ offset: 0.4, darkness: 0.4 });
const noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
noise.blendMode.opacity.value = 0.2;
export const passA = new EffectPass(camera, bloom, tone, vignette, noise);
composer.addPass(passA);

// Pass 3: SMAA, tier 1 only (tiers 2–3 have MSAA; tier 0 has canvas antialias and no composer)
export const smaaPass = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM }));
smaaPass.enabled = !Q().msaa && Q().post !== false;
composer.addPass(smaaPass);
// postprocessing flags only the LAST pass in the array renderToScreen, enabled or not: with smaaPass
// disabled (tiers 2-3) passA would render offscreen and the canvas stays black. Call syncOutput()
// after init and after EVERY pass toggle (applyQuality, transitionPass, toneOnlyPass).
export function syncOutput() {
  const on = composer.passes.filter(p => p.enabled);
  for (const p of composer.passes) p.renderToScreen = p === on[on.length - 1];
}
syncOutput();
Object.assign(live, { composer, caPass, passA, smaaPass, syncOutput });   // what applyQuality switches
// loop: composer.render(dt)  (dt in seconds; its ONLY argument, scene and camera come from renderPass)
// resize: composer.setSize(w, h)
// tier 1 ('lite'): caPass.enabled = false, smaaPass.enabled = true, then syncOutput().
// tier 0 at boot: no composer, renderer.toneMapping = THREE.AgXToneMapping, renderer.render(scene, camera)
// frame: ca.offset.setScalar(Math.min(0.0008 + Math.abs(scroller.velocity) * 0.004, 0.004));
```

Where SMAA goes (read from the 6.39 source): `SMAAEffect` carries `CONVOLUTION | DEPTH`, so it can
share a pass with neither CA nor a transition; it cannot take the CA slot while CA is enabled,
and it gets its own pass. It runs **after** pass A because colour edge detection wants
display-referred values; the MEDIUM preset's edge threshold is 0.1, above the ≤ 0.05 grain
amplitude, so it does not smear the grain. Cost ≈ one CA pass; it replaces CA on tier 1.

Pass structure and ordering rules (read from the 6.39 source):
- `EffectPass` sorts its effects by attribute flags, highest first (stable sort), so a
  convolution effect is always moved to the front of its pass; effects without flags keep the
  order you pass them. Two convolution effects in one pass throw *"Convolution effects cannot be
  merged"*; an effect that transforms UVs cannot share a pass with one either. Convolution
  effects here: ChromaticAberration, SMAA, DoF-type, and a custom transition (below).
- CA could legally merge into pass A (it would be sorted first), but its own pass means adding
  SMAA, DoF or a transition later never throws, and it can be switched off per tier. Placing it
  **before** pass A splits colour on the HDR scene like a real lens, while bloom, vignette and
  grain land on top un-split. Cost: one extra full-screen pass (~0.1–0.3 ms at 1080p, tier 2).
- Tone map before vignette and grain so both are display-referred.
- Never double tone map: with a composer the renderer must be `NoToneMapping`.
- Drive `ca.offset` from `scroller.velocity`:
  `ca.offset.setScalar(Math.min(0.0008 + Math.abs(v) * 0.004, 0.004))`; set bloom intensity per
  section from `section.post` (0.6–1.5).
- Selective bloom without layers: threshold 1 + emissive > 1 already is selective. For a strict
  selection use `new SelectiveBloomEffect(scene, camera, opts)` + `effect.selection.add(mesh)`.

**Why grain opacity 0.2 (and not 0.03–0.06).** NoiseEffect's opacity is a *blend* weight, not the
grain amplitude. The shader outputs `n × colour` with `premultiply` (n uniform in 0–1), and SCREEN
blends it as `c + s − c·s`, then `mix(c, result, opacity)`. The added light is
`opacity × n × c × (1 − c)`: zero in pure black and white, largest in midtones (c(1−c) ≤ 0.25).
Opacity 0.2 therefore gives grain of at most 0.05 (mean ≈ 0.025) per channel in midtones, which
is the visible 0.03–0.06 range. 0.35 reaches ≈ 0.09, which reads as dirt on a dark scene.
Without `premultiply`, grain lifts blacks too; keep it on.

Three addons alternative (fewer deps, more passes; the only option on a three version outside
postprocessing's peer range):

```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
renderer.toneMapping = THREE.AgXToneMapping;          // applied by OutputPass, not by the scene render
const fx = new EffectComposer(renderer);              // HalfFloat targets by default
fx.addPass(new RenderPass(scene, camera));
fx.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.6, 1.0)); // strength, radius, threshold
fx.addPass(new OutputPass());                         // tone mapping + sRGB, always last
```

`UnrealBloomPass` strength is a different scale from `BloomEffect.intensity`; tune it by eye
against the same emissive values.

---

## Particle morph (GPGPU)

Points that swirl and coalesce into a different shape per hovered link. Positions live in float
textures, simulated on the GPU; colour follows speed.

```js
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

const SIZE = Q().particles;                           // texture edge per tier: 128 / 256 / 512 / 512
function targetTexture(mesh) {                        // every target uses the same N = SIZE²
  mesh.updateWorldMatrix(true, false);
  const s = new MeshSurfaceSampler(mesh).build(), p = new THREE.Vector3(), d = new Float32Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) { s.sample(p); p.applyMatrix4(mesh.matrixWorld); d.set([p.x, p.y, p.z, 1], i * 4); }
  const t = new THREE.DataTexture(d, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t;
}
const targets = MESHES.map(targetTexture);            // multi-part GLB: merge geometries first (BufferGeometryUtils.mergeGeometries)

const canFloat = renderer.extensions.has('EXT_color_buffer_float');
const canHalf = canFloat || renderer.extensions.has('EXT_color_buffer_half_float');
const gpu = new GPUComputationRenderer(SIZE, SIZE, renderer);
if (!canFloat) gpu.setDataType(THREE.HalfFloatType);
const pos0 = gpu.createTexture(); pos0.image.data.set(targets[0].image.data);
const posVar = gpu.addVariable('texturePosition', POS_FRAG, pos0);
const velVar = gpu.addVariable('textureVelocity', VEL_FRAG, gpu.createTexture());
gpu.setVariableDependencies(posVar, [posVar, velVar]);
gpu.setVariableDependencies(velVar, [posVar, velVar]);
Object.assign(velVar.material.uniforms, { tA: { value: targets[0] }, tB: { value: targets[1] },
  uMix: { value: 0 }, uTime: { value: 0 }, uDt: { value: 0 }, uK: { value: 6 }, uSwirl: { value: 1.2 }, uDamp: { value: 3 } });
posVar.material.uniforms.uDt = { value: 0 };
const err = canHalf ? gpu.init() : 'no float render targets';
if (err) { console.warn('[particles]', err); useCpuFallback(8000); }
```

```glsl
// VEL_FRAG  (texturePosition / textureVelocity / resolution are injected by GPUComputationRenderer)
uniform sampler2D tA, tB; uniform float uMix, uTime, uDt, uK, uSwirl, uDamp;
vec3 swirl(vec3 p){ // divergence-free: each component ignores its own axis
  return vec3(sin(p.y*1.7 + cos(p.z*1.3)), sin(p.z*1.9 + cos(p.x*1.1)), sin(p.x*1.5 + cos(p.y*1.7))); }
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec3 p = texture2D(texturePosition, uv).xyz, v = texture2D(textureVelocity, uv).xyz;
  vec3 target = mix(texture2D(tA, uv).xyz, texture2D(tB, uv).xyz, uMix);
  v += (target - p) * uK * uDt;                                  // spring
  v += swirl(p * 0.8 + uTime * 0.15) * uSwirl * uDt;             // curl swirl
  v *= exp(-uDamp * uDt);                                        // damping, frame-rate independent
  gl_FragColor = vec4(v, 1.0);
}
// POS_FRAG
uniform float uDt;
void main(){ vec2 uv = gl_FragCoord.xy / resolution.xy;
  gl_FragColor = vec4(texture2D(texturePosition, uv).xyz + texture2D(textureVelocity, uv).xyz * uDt, 1.0); }
```

```js
const N = SIZE * SIZE, ref = new Float32Array(N * 2);
for (let i = 0; i < N; i++) { ref[i * 2] = (i % SIZE + 0.5) / SIZE; ref[i * 2 + 1] = (Math.floor(i / SIZE) + 0.5) / SIZE; }
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); // draw count only
geo.setAttribute('ref', new THREE.BufferAttribute(ref, 2));
const pointsMat = new THREE.ShaderMaterial({
  uniforms: { tPos: { value: null }, tVel: { value: null }, uSize: { value: 2.0 }, uDpr: { value: renderer.getPixelRatio() },
    uBase: { value: new THREE.Color(DIR.palette.glow) }, uHot: { value: new THREE.Color(0xffffff).multiplyScalar(4) } }, // hot core: white × 4 blooms
  vertexShader: `attribute vec2 ref; uniform sampler2D tPos, tVel; uniform float uSize, uDpr; varying float vSpeed;
    void main(){ vec3 p = texture2D(tPos, ref).xyz; vSpeed = length(texture2D(tVel, ref).xyz);
      vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * uDpr * (8.0 / -mv.z); }`,          // size attenuation
  fragmentShader: `uniform vec3 uBase, uHot; varying float vSpeed;
    void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
      gl_FragColor = vec4(mix(uBase, uHot, smoothstep(0.2, 3.0, vSpeed)) * (1.0 - d * 2.0), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,                                                      // both chunks are no-ops under the composer
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
});
const points = new THREE.Points(geo, pointsMat); points.frustumCulled = false; scene.add(points);
// frame: set uDt (clamp 1/30), uTime; gpu.compute();
// pointsMat.uniforms.tPos.value = gpu.getCurrentRenderTarget(posVar).texture; (same for tVel)
// hover link j: tA = current blend, tB = targets[j], tween uMix 0→1 over 1.2 s (expo.out)
// on a tier change: rebuild with the new SIZE (targets are sampled per SIZE)
```

With the composer the two chunks do nothing (render target, `NoToneMapping`); on a tier-0 canvas
they tone-map and encode like every built-in material. Additive blending then sums display
values, which is what the eye expects from glow.

Gotchas: sample in **world** space (or the same local space for all targets). Clamp `uDt` to 1/30
or springs explode after a tab switch. Hot colour > 1 so fast particles bloom. The base colour is
`DIR.palette.glow` from the direction; tint `uHot` towards it if pure white clashes. The CPU fallback (8k points, the same spring on a
`Float32Array`) is for devices where GPGPU cannot run at all, not a tier.

---

## Scene transitions

Between worlds: an out-motion, a masked dissolve with displacement and RGB split, an in-motion.
Render scene B **only while transitioning**; otherwise render the active scene alone. The mix
works on linear HDR colour, so tone mapping and sRGB encoding happen **after** mixing, once.
DOM copy moving with the transition: [DOM sync](recipes-world.md#dom-sync-during-transitions).

Shared GLSL body (the mask, displacement, RGB split), kept as one JS string so both variants
below use the same code. It expects `uv`, `tA`, `tB`, `tNoise`, `uProgress`, `uVel` and leaves
the linear HDR result in `col`:

```js
const TRANSITION_BODY = `
  float n = texture2D(tNoise, uv * 1.5).r;
  float edge = smoothstep(uProgress - 0.08, uProgress + 0.08, n * 0.9 + uv.y * 0.1); // dissolve mask
  float band = 1.0 - abs(edge * 2.0 - 1.0);                                         // 1 at the edge
  vec2 disp = (vec2(n) - 0.5) * 0.06 * band;                                        // displacement
  float s = 0.004 * band + 0.002 * uVel;                                            // RGB split
  vec3 a = vec3(texture2D(tA, uv + disp + s).r, texture2D(tA, uv + disp).g, texture2D(tA, uv + disp - s).b);
  vec3 b = vec3(texture2D(tB, uv - disp + s).r, texture2D(tB, uv - disp).g, texture2D(tB, uv - disp - s).b);
  vec3 col = mix(b, a, edge) + band * 0.15;                                         // faint edge glow
`;
```

**A. With the pmndrs composer (the default stack):** a custom `Effect` in its own pass directly
after the `RenderPass`. The `RenderPass` renders scene A into the composer's HDR buffer (the
effect reads it as `inputBuffer`), the effect renders scene B into its own HDR target in
`update()`, and pass A of the [post stack](#post-processing-stack) tone-maps the mix once.

```js
import { Effect, EffectAttribute, EffectPass, BlendFunction } from 'postprocessing';

class TransitionEffect extends Effect {
  constructor(sceneB, camB, noiseTex) {
    super('TransitionEffect', `
      uniform sampler2D tB; uniform sampler2D tNoise; uniform float uProgress; uniform float uVel;
      #define tA inputBuffer
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        ${TRANSITION_BODY}
        outputColor = vec4(col, 1.0);
      }`, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.CONVOLUTION,          // samples inputBuffer at displaced UVs
      uniforms: new Map([['tB', new THREE.Uniform(null)], ['tNoise', new THREE.Uniform(noiseTex)],
        ['uProgress', new THREE.Uniform(0)], ['uVel', new THREE.Uniform(0)]]),
    });
    this.sceneB = sceneB; this.camB = camB;
    this.rtB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.uniforms.get('tB').value = this.rtB.texture;
  }
  update(renderer) { renderer.setRenderTarget(this.rtB); renderer.render(this.sceneB, this.camB); }
  setSize(w, h) { this.rtB.setSize(w, h); }             // the composer passes the drawing-buffer size
}
const transition = new TransitionEffect(sceneB, camB, blueNoiseTex);
const transitionPass = new EffectPass(camA, transition);
transitionPass.enabled = false;
composer.addPass(transitionPass, 1);                    // index 1: right after the RenderPass, before CA
// start: transitionPass.enabled = true; tween transition.uniforms.get('uProgress').value 0 -> 1.1
// end:   renderPass.mainScene = sceneB; renderPass.mainCamera = camB; transitionPass.enabled = false;
```

It must be its own pass: it is a convolution effect, like CA. `EffectPass.render` calls
`update()` before it binds its own target, so rendering scene B there is safe.

**B. Straight to the canvas (no composer):** a `FullScreenQuad` whose shader ends with the
tone-mapping and colour-space chunks, because it is now the last thing drawn.

```js
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
renderer.toneMapping = THREE.AgXToneMapping;          // applied only when drawing to the canvas
const rt = () => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
const rtA = rt(), rtB = rt();                          // render targets stay linear HDR, no tone map
const mix = new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms: { tA: { value: rtA.texture }, tB: { value: rtB.texture }, tNoise: { value: blueNoiseTex },
    uProgress: { value: 0 }, uVel: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `uniform sampler2D tA, tB, tNoise; uniform float uProgress, uVel; varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      ${TRANSITION_BODY}
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));                                                    // ShaderMaterial.toneMapped defaults to true
function renderTransition(p, vel) {
  renderer.setRenderTarget(rtA); renderer.render(sceneA, camA);
  renderer.setRenderTarget(rtB); renderer.render(sceneB, camB);
  renderer.setRenderTarget(null);
  mix.material.uniforms.uProgress.value = p; mix.material.uniforms.uVel.value = vel;
  mix.render(renderer);
}
```

Numbers: [canonical](#canonical-numbers) (1.2 s, `expo.inOut`, progress 0 → 1.1 so the mask
fully clears, ε 0.02). Keep target size = drawing-buffer size incl. DPR (`setSize` on resize).
Precompile scene B (`renderer.compileAsync(sceneB, camB)`) before the first transition, and
restart the frame monitor's 2 s grace when a transition starts.

**Mask sources.** `TRANSITION_BODY` reads its mask value from `n`. Swap the first line for one
of these; the rest of the body is unchanged.

| Source | First line of the body | Reads as | Blender side |
|---|---|---|---|
| Noise (default) | `float n = texture2D(tNoise, uv * 1.5).r;` | organic dissolve, burn, frost creep | none (blue/value noise PNG, NoColorSpace, RepeatWrapping) |
| Authored grayscale wipe | `float n = texture2D(tMask, uv).r;` | a designed reveal: iris, logo shape, brush stroke, liquid pour line | render a 16-bit grayscale ramp (black = first) from an Eevee/Compositor setup or paint it; UASTC or PNG, never ETC1S (bands) |
| Directional velocity smear | smear variant below | motion carries the cut: fast scroll streaks the old world along the scroll direction | none |

```glsl
// smear variant: replace the first line of TRANSITION_BODY; uniform vec2 uDir (screen scroll
// direction, e.g. vec2(0, 1)); uVel = |scroller.velocity| clamped to 0..1
float n = texture2D(tNoise, uv * 1.5).r * 0.35 + dot(uv - 0.5, uDir) + 0.5;   // wipe along uDir
vec2 smear = uDir * uVel * 0.08;                                                 // streak length
// then, instead of the single tA sample, average 4 taps along the smear (old world only):
// vec3 a = (texture2D(tA, uv).rgb + texture2D(tA, uv - smear * 0.33).rgb
//         + texture2D(tA, uv - smear * 0.66).rgb + texture2D(tA, uv - smear).rgb) * 0.25;
```

**Trigger rule.** Default: **scrubbed band**. The transition belongs to the scroll range
`[tEnd − ε, tNext + ε]` around the boundary between two sections, and its progress IS the
scroll position inside that band, so scrolling back reverses it for free and nothing can be
interrupted mid-tween:

```js
// boundaries = [{ t, from: sceneA, camFrom: camA, to: sceneB, camTo: camB }, …], sorted by t
const EPS = 0.02;                                               // canonical ε
export function worldAt(p) {                                    // which scene/camera owns progress p
  const after = boundaries.filter(x => p >= x.t).pop();         // (also used by the settled loop)
  return after ? { scene: after.to, camera: after.camTo } : { scene: boundaries[0].from, camera: boundaries[0].camFrom };
}
// in the frame loop, after scroller.update(dt):
const p = scroller.progress;
const b = boundaries.find(x => p > x.t - EPS && p < x.t + EPS);
if (b) {
  const u = THREE.MathUtils.smoothstep(p, b.t - EPS, b.t + EPS) * 1.1;   // 0 -> 1.1, eased at both ends
  if (!transitionPass.enabled) { transition.sceneB = b.to; transition.camB = b.camTo; transitionPass.enabled = true; restartGrace(); }
  renderPass.mainScene = b.from; renderPass.mainCamera = b.camFrom;
  transition.uniforms.get('uProgress').value = u;
  transition.uniforms.get('uVel').value = Math.min(Math.abs(scroller.velocity), 1);
} else if (transitionPass.enabled) {
  transitionPass.enabled = false;                               // left the band: settle on whichever side
  const w = worldAt(p); renderPass.mainScene = w.scene; renderPass.mainCamera = w.camera;
}
```

Alternative: **threshold-triggered timeline**. Crossing `t` plays a 1.2 s GSAP timeline
(`expo.inOut`); crossing back reverses the same timeline. Input and the soft snap are both
locked while it plays (`push` returns early and the snap is gated on `!s.locked`), so the
transition always completes. When it completes, the snap range is limited to the **new side**
of the boundary and progress is sent to that side's first rest, so the snap can never pull
progress back across `t` and re-trigger it (no ping-pong). Use it when the transition is a
*moment* (a door, a portal, a sound hit) rather than a place you can hover in.

```js
// b = { t, from, to, camFrom, camTo }; sections sorted by t
const firstAfter = sections.findIndex(x => x.t > b.t), lastBefore = firstAfter - 1;
const settle = after => () => {
  transitionPass.enabled = false;
  renderPass.mainScene = after ? b.to : b.from; renderPass.mainCamera = after ? b.camTo : b.camFrom;
  scroller.snapMin = after ? b.t : 0;                           // rests on the other side are excluded
  scroller.snapMax = after ? 1 : b.t;
  scroller.locked = false;
  scroller.go(after ? firstAfter : lastBefore);                 // park on the new side's rest
};
const tl = gsap.timeline({ paused: true, onComplete: settle(true), onReverseComplete: settle(false) })
  .fromTo(transition.uniforms.get('uProgress'), { value: 0 }, { value: 1.1, duration: 1.2, ease: 'expo.inOut' });
let side = 0;                                                   // 0 = before t, 1 = after
function checkThreshold(p) {                                    // every frame, after scroller.update
  const want = p >= b.t ? 1 : 0; if (want === side || scroller.locked) return;
  side = want; scroller.locked = true; restartGrace();          // push() and the snap stop while locked
  renderPass.mainScene = b.from; renderPass.mainCamera = b.camFrom;
  transition.sceneB = b.to; transition.camB = b.camTo;          // uProgress 0 shows A, 1.1 shows B
  transitionPass.enabled = true;
  want ? tl.play() : tl.reverse();
}
```

With several threshold boundaries, each settle sets the range to the span between its own
boundary and the next one (`snapMin`/`snapMax` = the neighbouring boundary times, 0 and 1 at
the ends). The scrubbed band needs no range: its progress IS the scroll position.

Reduced motion: either variant jumps to the far side's rest and cross-fades instead (duration
and `crossfadeCanvas()`: [DOM sync during transitions](recipes-world.md#dom-sync-during-transitions)).
Keep section rest times at least 2ε from a boundary so the soft snap never parks inside a band.

**A/B scene swap vs one-world fly-through.** Swap scenes (this recipe) when the next place is
a different world (scale, palette, lighting or physics change) or when both worlds together
would blow the [draw budget](#canonical-numbers). Fly through one world (just the camera path,
no transition pass) when the places share ground, light and palette and the camera can
physically travel between them: continuity reads as more premium than a cut, and it costs
nothing extra. A long fly-through can still change light per section with
[blended lightmaps](#light-rig-per-mood).

---

## Refractive and crystal materials

Ice/glass hero blocks. Start with `MeshPhysicalMaterial` transmission on tiers 2–3; go custom
only when you need inner fracture detail or many refractive objects.

```js
const ice = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, roughness: 0.08, metalness: 0,
  transmission: 1, thickness: 0.8, thicknessMap: thicknessTex, // read from the G channel; bake AO with flipped normals, invert, NoColorSpace
  ior: 1.31,                                   // ice 1.31, glass 1.5, crystal 1.54–2.0
  attenuationColor: new THREE.Color(DIR.palette.tint), attenuationDistance: 0.6,
  dispersion: 0.15,                            // 0.171 and r186; 0.1–0.3 = subtle rainbow edges
  specularIntensity: 1, clearcoat: 0.3, clearcoatRoughness: 0.1,
  envMap: pmremEnv, envMapIntensity: 1.2,
});
if ('transmissionResolutionScale' in renderer)                 // r186 only (absent in the pinned 0.171)
  renderer.transmissionResolutionScale = tier >= 3 ? 1 : 0.5;
```

**On the pinned 0.171** the transmission target is always the full drawing-buffer size (checked
in `WebGLRenderer.js`: `setSize(viewport.z, viewport.w)`), so there is no per-pass knob. Options,
in order: (1) transmission only on tiers 2–3 (the canonical rule), where the tier-2 DPR cap of
1.5 already bounds the cost; (2) if tier 2 still misses the frame target while a transmissive
object is on screen, lower `renderer.setPixelRatio` by 0.25 only for the sections that show it
(restore on exit; composer `setSize` afterwards); (3) the custom back-face refraction below,
which samples a target you size yourself. When the stack moves to a three release that has the
property (r186 has it; postprocessing must list that version in its peer range first), the guard
above starts working with no other change.

Tiers 0–1 (no transmission): same material with
`export const FAKE_GLASS = { transmission: 0, transparent: true, opacity: 0.55, roughness: 0.05, envMapIntensity: 1.6 }`
(register it as `ice.userData.fallback = FAKE_GLASS` so `applyQuality` can switch a live
material on a tier drop) and a fresnel rim in `onBeforeCompile`
(or `iridescence: 0.2` for a cheap edge tint). It reads as glass from reflections instead of
refraction and costs no extra pass. The ice/glass row in
[signature material presets](#signature-material-presets) points here; the numbers live in this
section only.

Gotchas: transmission only sees **opaque** objects (it renders a separate opaque pass); other
transparent/refractive objects are invisible through it. That pass costs once per frame, not per
object, but many overlapping ice blocks still hurt. Needs an environment
(`PMREMGenerator.fromScene(new RoomEnvironment())` or an HDR) or it looks grey.

Custom alternative (cheaper for many blocks, controllable): render **back-face normals** of the
refractive objects into a HalfFloat target (`side: BackSide`, output view normals), then in the
front-face shader refract twice and sample the scene colour target with per-channel IOR:

```glsl
vec3 n = normalize(vNormal), v = normalize(vViewDir);
vec3 nBack = texture2D(tBackNormals, screenUv).xyz;
vec3 col;
for (int c = 0; c < 3; c++) {                       // per-channel IOR = dispersion
  float ior = uIor + float(c - 1) * 0.02;            // e.g. 1.29 / 1.31 / 1.33
  vec3 r = refract(-v, n, 1.0 / ior);
  r = refract(r, -nBack, ior);
  col[c] = texture2D(tScene, screenUv + r.xy * uThickness * 0.1)[c];
}
```

Inner fracture/crystal structure: raymarch **16–32 steps** inside the mesh bounds through a
Voronoi/3D-noise density (or a baked 64³ `Data3DTexture`, see Volumes) and add it before the
fresnel reflection. Precompute the Voronoi in Blender (Geometry Nodes fracture → inner faces)
when you can; geometry is cheaper than marching.

---

## Signature material presets

One `MeshPhysicalMaterial` per signature surface. Every property below exists in the pinned
three 0.171 (checked in `MeshPhysicalMaterial.js`). Colours come from `DIR.palette`; the numbers
live only in this table. Needs an environment map (PMREM of the HDRI chosen in
[light rig per mood](#light-rig-per-mood)); physical materials look grey without one.

| Preset | `MeshPhysicalMaterial` parameters | Blender bake needs |
|---|---|---|
| **Glaze / ceramic** | `color: DIR.palette.accent, metalness: 0, roughness: 0.4` (the bisque under the glaze, 0.35–0.5), `clearcoat: 1, clearcoatRoughness: 0.05` (0.03–0.08), `ior: 1.5`; drips/pooling as `clearcoatRoughnessMap` | AO + DIFFUSE lightmap on UV1; throwing marks as a normal map on UV0; glaze thickness → `clearcoatRoughnessMap` baked from a Cycles roughness pass |
| **Car paint / lacquer** | `color: DIR.palette.accent, metalness: 0.7` (0.6–0.9), `roughness: 0.4` (base layer, 0.35–0.45), `clearcoat: 1, clearcoatRoughness: 0.03` (0.02–0.05); flakes: `normalMap` = tiling cellular/value noise, `normalScale` 0.15–0.3, `repeat` 40–80 per UV unit, on the BASE only (no `clearcoatNormalMap`: the coat stays mirror-smooth) | AO only (reflections carry the look; a lightmap barely shows at metalness 0.7); UV0 with even texel density so flakes do not stretch; a studio or sky HDRI is mandatory |
| **Fabric** | `color: DIR.palette.accent, metalness: 0, roughness: 0.9` (0.8–1), `sheen: 1, sheenRoughness: 0.5` (0.3–0.6: lower = satin, higher = velvet), `sheenColor: DIR.palette.ink` (or a lighter tint of the base); weave as tiling `normalMap`, `normalScale` 0.3–0.6 | AO + DIFFUSE lightmap; apply the cloth sim / Shrinkwrap before the bake (modifiers rewrite UVs) |
| **Iridescent vinyl / film** | `color: DIR.palette.ground, metalness: 0.2` (0–0.3), `roughness: 0.2` (0.15–0.3), `iridescence: 1, iridescenceIOR: 1.3` (1.2–1.8), `iridescenceThicknessRange: [100, 400]` nm (subtle) or `[250, 800]` (bold bands), `iridescenceThicknessMap` = low-frequency noise for drift | AO only; the effect is view- and env-driven, so give it a high-contrast HDRI; a lightmap does nothing for the film |
| **Wax / food (fake SSS)** | tiers 2–3: `transmission: 0.3` (0.2–0.4), `thickness: 1` (0.5–2) + `thicknessMap`, `attenuationColor: DIR.palette.accent` (a deeper hue of the body), `attenuationDistance: 0.3` (0.2–0.5), `roughness: 0.5` (0.4–0.6). Tiers 0–1: `transmission: 0` + wrap lighting (below) | `thicknessMap` = AO baked with flipped normals, inverted, NoColorSpace (same as glass); AO + DIFFUSE lightmap |
| **Brushed metal** | `color: DIR.palette.ink, metalness: 1, roughness: 0.3` (0.25–0.4), `anisotropy: 0.8` (0.6–0.9), `anisotropyRotation` in radians relative to UV0's U axis (0 = brush along U); optional `anisotropyMap` for swirl/radial brushing | lay UV0 out so **U runs along the brush**; give it a hairline `normalMap` (its UV drives the tangent frame in 0.171) or export tangents (`export_tangents=True`); AO only: a lightmap adds nothing at metalness 1 (no diffuse term) |
| **Ice / glass** | see [refractive and crystal materials](#refractive-and-crystal-materials) (the numbers live there): `transmission` on tiers 2–3, reflection-only fallback on tiers 0–1, `attenuationColor: DIR.palette.tint` | `thicknessMap` from inverted flipped-normal AO |

```js
const P = THREE.MeshPhysicalMaterial, C = hex => new THREE.Color(hex);
export const PRESETS = {
  glaze:   () => new P({ color: C(DIR.palette.accent), metalness: 0, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.05, ior: 1.5 }),
  paint:   (flakes) => new P({ color: C(DIR.palette.accent), metalness: 0.7, roughness: 0.4, clearcoat: 1,
             clearcoatRoughness: 0.03, normalMap: flakes, normalScale: new THREE.Vector2(0.2, 0.2) }), // flakes.repeat.set(60, 60)
  fabric:  () => new P({ color: C(DIR.palette.accent), roughness: 0.9, sheen: 1, sheenRoughness: 0.5, sheenColor: C(DIR.palette.ink) }),
  vinyl:   () => new P({ color: C(DIR.palette.ground), metalness: 0.2, roughness: 0.2, iridescence: 1,
             iridescenceIOR: 1.3, iridescenceThicknessRange: [100, 400] }),
  wax:     (thick, hi) => new P({ color: C(DIR.palette.accent), roughness: 0.5, transmission: hi ? 0.3 : 0,
             thickness: 1, thicknessMap: thick, attenuationColor: C(DIR.palette.accent), attenuationDistance: 0.3 }),
  brushed: (hairline) => new P({ color: C(DIR.palette.ink), metalness: 1, roughness: 0.3, anisotropy: 0.8,
             anisotropyRotation: 0, normalMap: hairline, normalScale: new THREE.Vector2(0.15, 0.15) }),
};
```

**Wrap lighting (wax/food on tiers 0–1, or on top of low transmission).** Light wraps past the
terminator and the wrapped band is tinted, which reads as light scattering under the surface.
The injection point is verified in 0.171's `lights_physical_pars_fragment` (the `directDiffuse +=`
line occurs once, in `RE_Direct_Physical`; `geometryNormal` is in scope there):

```js
export function wrapLighting(mat, wrap = 0.5, scatter = DIR.palette.accent) {   // wrap 0.3–0.6
  // Wrap ONLY the diffuse term: dotNL / irradiance stay untouched, so GGX specular, sheen and
  // clearcoat still stop at the real terminator. The extra band past it is added to directDiffuse.
  mat.onBeforeCompile = sh => {
    sh.uniforms.uWrap = { value: wrap }; sh.uniforms.uScatter = { value: new THREE.Color(scatter) };
    const chunk = THREE.ShaderChunk.lights_physical_pars_fragment
      .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n'
        + '\tfloat nlW = dot( geometryNormal, directLight.direction );\n'
        + '\tfloat wrapExtra = saturate( ( nlW + uWrap ) / ( 1.0 + uWrap ) ) - saturate( nlW );\n'
        + '\treflectedLight.directDiffuse += directLight.color * wrapExtra * ( BRDF_Lambert( material.diffuseColor ) + uScatter * RECIPROCAL_PI );');
    if (chunk === THREE.ShaderChunk.lights_physical_pars_fragment) console.warn('wrapLighting: patch target not found (three version changed)');
    sh.fragmentShader = 'uniform float uWrap;\nuniform vec3 uScatter;\n'
      + sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', chunk);
  };
  mat.customProgramCacheKey = () => 'wrap';
  mat.needsUpdate = true;
  return mat;
}
```

Wrap affects real lights only (the lightmap is irradiance, already soft). On a fully lightmapped
surface bake the wax look into the lightmap instead: Cycles Principled **Subsurface** weight
0.3–0.6 with radius tinted toward `DIR.palette.accent` is captured by a COMBINED bake.

---

## Light rig per mood

Build the rig **in Blender first** (the bake is the lighting), with the same ratios, then mirror
only what must move in three.js (rim, practical flicker, per-section change). Ratios are
key : fill : rim in linear intensity (2 : 1 = one stop). Colour temperatures pick the
`DIR.palette.key / fill / rim` tokens (convert with `kelvin()` below); the numbers live only here.

| Mood | Key : fill : rim | Key / fill / rim temperature | HDRI (env) + `envMapIntensity` | Practicals relative to the camera path |
|---|---|---|---|---|
| **Warm tungsten** (evening interior) | 4 : 1 : 2 | 2900 K / 4500 K / 3200 K | dim interior or dusk, 0.3–0.5 | 2–3 lamps at 2400–2700 K, emissive 3–8, 1–3 m off the path, one in the upper third of each rest shot |
| **Cold overcast** | 1.5 : 1 : 0.25 | 7000 K / 7500 K / 6500 K | overcast sky, 1.0; no hard shadows (sun angle ≥ 10°) | none, or one warm window as the only accent, on the far side of the path |
| **Stage gel** | 8 : 1 : 12 (rim beats key) | saturated gels: key from `DIR.palette.accent`, rim its complement; fill neutral 5600 K | near-black studio, 0.1–0.2; haze volume on | beam cones crossing the path diagonally, sources out of frame, beams visible through haze |
| **Daylight high-key** | 2 : 1 : 1 | 5600 K / 6500 K / 5600 K | clear sky or white studio, 1.2–1.5; lower exposure rather than more bloom | none; bounce cards (white planes, emissive 0.3–0.6, below bloom threshold) just outside frame |
| **Candle** | 16 : 1 : 0 (4 stops) | 1850 K / 8000 K moonlight fill / none | night sky, 0.05–0.15 | the flames are the key: emissive 4–8, flicker 6–10 Hz noise ±15 % intensity, 1–2 m from the path, below eye level |

```js
export function kelvin(K) {                          // Tanner Helland fit, 1000–40000 K -> sRGB Color
  const t = K / 100, c = v => Math.min(255, Math.max(0, v)) / 255;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}
// e.g. DIR.palette.key = kelvin(2900).getHex(THREE.SRGBColorSpace);
```

Practicals and the camera path: place them from the marker poses, not by eye. For each rest
marker, a practical sits 1–3 m from the camera position, inside the frame's upper or outer
third, and never within 0.5 m of the path (it blows out as the camera passes). The same object
is the emissive mesh (bloom) and a Blender point/area light of matching temperature (the bake).

**Per-section light change: two lightmaps blended.** Bake one DIFFUSE lightmap per rig on the
same UV1 atlas (collections `RigDay` and `RigDusk`, each holding only lights):

```bash
blender -b world.blend --python-exit-code 1 --python scripts/bake_lightmap.py -- --objects Hero,Ground \
  --type DIFFUSE --light-rig RigDay --name lm_day --out baked --save-blend baked/world_day.blend
blender -b baked/world_day.blend --python-exit-code 1 --python scripts/bake_lightmap.py -- --objects Hero,Ground \
  --type DIFFUSE --light-rig RigDusk --name lm_dusk --reuse-uv --out baked --save-blend baked/world_dusk.blend \
  --export-glb baked/world.glb
```

Then mix them inside the material's own lightmap lookup (one draw call, one program), driven by
the scrubbed band of the boundary between the two sections (ε from
[canonical numbers](#canonical-numbers)):

```js
const LM_LINE = 'vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );';   // same line in Basic and Standard (0.171)
const LM_MIX = 'vec4 lightMapTexel = mix( texture2D( lightMap, vLightMapUv ) * uMaxA, texture2D( lightMapB, vLightMapUv ) * uMaxB, uLightMix );';
export const lightMix = { value: 0 };                 // shared by every blended material
// maxA / maxB = each bake manifest's maxValue for normalized maps (1 for HDR/EXR maps)
export function blendLightmaps(mat, lmA, lmB, maxA = 1, maxB = 1) {   // both: same flipY, channel 1, mips
  mat.lightMap = lmA; mat.lightMapIntensity = Math.PI;               // each map's max scale is applied in the shader
  mat.onBeforeCompile = sh => {
    sh.uniforms.lightMapB = { value: lmB }; sh.uniforms.uLightMix = lightMix;
    sh.uniforms.uMaxA = { value: maxA }; sh.uniforms.uMaxB = { value: maxB };
    sh.fragmentShader = 'uniform sampler2D lightMapB;\nuniform float uLightMix, uMaxA, uMaxB;\n' + sh.fragmentShader
      .replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps)  // Standard/Physical
      .replace(LM_LINE, LM_MIX);                                                            // Basic has it inline
  };
  mat.customProgramCacheKey = () => 'lm-blend';
  mat.needsUpdate = true;
}
// frame loop: lightMix.value = THREE.MathUtils.smoothstep(scroller.progress, b.t - 0.02, b.t + 0.02);
// real lights that belong to a rig (rim, practicals) crossfade their .intensity with the same value
```

Alternative when a material cannot be patched (a third-party shader): two copies of the mesh,
one per lightmap, the second `transparent` with `opacity = lightMix.value`. It doubles draw
calls for those meshes, so keep it to the hero. Memory: a 2048² half-float RGBA lightmap is
≈ 32 MB on the GPU plus a third for mips; use 1024² for the second rig when it only changes
colour, not shadows.

---

## Volumes

Clouds, breath, smoke over the terrain, compressed smaller than a JPEG: a 64³ uint8 grid is 262 KB
raw, ~40–90 KB gzipped. Tiers: [canonical](#canonical-numbers) (tier 0 uses soft alpha cards).

**Blender:** bake a Mantaflow smoke domain (Modular cache, OpenVDB). Read the density at one frame:

```python
import bpy, numpy as np
dom = next(m for m in obj.modifiers if m.type == "FLUID").domain_settings
bpy.context.scene.frame_set(90)
res = tuple(dom.domain_resolution)                 # (x, y, z); if missing in your build: dir(dom)
dens = np.array(dom.density_grid[:], dtype=np.float32)   # empty -> cache not baked / frame not loaded
if dens.size != res[0] * res[1] * res[2]:          # noise upres: grid is resolution * noise scale
    s = round((dens.size / (res[0] * res[1] * res[2])) ** (1 / 3)); res = tuple(r * s for r in res)
vol = dens.reshape(res[2], res[1], res[0])         # x fastest in memory
# resample to 64³ (nearest is fine after a blur) and quantise
idx = [np.linspace(0, r - 1, 64).astype(int) for r in vol.shape]
small = vol[np.ix_(*idx)]
small = np.clip(small / max(small.max(), 1e-6), 0, 1)
(small * 255).astype(np.uint8).tofile("volume_64.bin")     # z, y, x order == Data3DTexture order
```

`.vdb` files instead: `import openvdb` (bundled in recent Blender builds; older: `pyopenvdb`,
guard with try/except), `grid.copyToArray(arr, ijk=bbox_min)`. The grid is Blender Z-up; the
shader below converts three's Y-up box coordinates with `vec3(p.x, -p.z, p.y)`.

**Browser:** a plain `ShaderMaterial` (three compiles it as GLSL ES 3.0 on WebGL2, so `texture()`
and `sampler3D` work, and `gl_FragColor` plus the output chunks are available; with
`glslVersion: GLSL3` you would have to declare the output and would lose those chunks). The
march accumulates **premultiplied** colour, so blending is `ONE, ONE_MINUS_SRC_ALPHA`.

```js
const data = new Uint8Array(await (await fetch('assets/volume_64.bin')).arrayBuffer());
const tex = new THREE.Data3DTexture(data, 64, 64, 64);
tex.format = THREE.RedFormat; tex.type = THREE.UnsignedByteType;
tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.unpackAlignment = 1; tex.needsUpdate = true;
const volMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, transparent: true, depthWrite: false,
  blending: THREE.NormalBlending, premultipliedAlpha: true,   // -> blendFunc(ONE, ONE_MINUS_SRC_ALPHA)
  defines: { STEPS: Q().volumeSteps },                        // 40 on tiers 2–3, 24 on tier 1
  uniforms: { uVol: { value: tex }, uCamLocal: { value: new THREE.Vector3() }, uDensity: { value: 2.5 },
    uColor: { value: new THREE.Color(DIR.palette.haze) }, uFrame: { value: 0 } },
  vertexShader: `uniform vec3 uCamLocal; varying vec3 vOrigin; varying vec3 vDir;
    void main(){ vOrigin = uCamLocal; vDir = position - uCamLocal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `precision highp sampler3D; uniform sampler3D uVol; uniform float uDensity, uFrame; uniform vec3 uColor;
    varying vec3 vOrigin; varying vec3 vDir;
    vec2 hitBox(vec3 o, vec3 d){ vec3 inv = 1.0 / d, t0 = (vec3(-0.5) - o) * inv, t1 = (vec3(0.5) - o) * inv;
      vec3 mn = min(t0, t1), mx = max(t0, t1); return vec2(max(max(mn.x, mn.y), mn.z), min(min(mx.x, mx.y), mx.z)); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uFrame) * 43758.5453); } // or a blue-noise texture
    void main(){
      vec3 d = normalize(vDir); vec2 b = hitBox(vOrigin, d); if (b.x > b.y) discard; b.x = max(b.x, 0.0);
      float dt = (b.y - b.x) / float(STEPS);
      vec3 p = vOrigin + d * (b.x + dt * hash(gl_FragCoord.xy));         // jitter kills banding
      float T = 1.0; vec3 acc = vec3(0.0);
      for (int i = 0; i < STEPS; i++) {
        float s = texture(uVol, vec3(p.x, -p.z, p.y) + 0.5).r * uDensity;  // Y-up box -> Z-up grid
        float a = 1.0 - exp(-s * dt * 8.0);                               // Beer-Lambert
        acc += T * a * uColor; T *= 1.0 - a; if (T < 0.02) break; p += d * dt;
      }
      float alpha = 1.0 - T;
      gl_FragColor = vec4(alpha > 0.0 ? acc / alpha : vec3(0.0), alpha);   // straight colour for the chunks
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb *= gl_FragColor.a;                                  // back to premultiplied
    }`,
});
const volume = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), volMat);  // scale the mesh to the domain size
scene.add(volume);
// every frame, after the camera update:
volume.updateWorldMatrix(true, false);
volume.worldToLocal(camera.getWorldPosition(volMat.uniforms.uCamLocal.value));
volMat.uniforms.uFrame.value = (volMat.uniforms.uFrame.value + 1) % 1024;
```

With the composer the two chunks are no-ops (render target, `NoToneMapping`), so the same material
works in both paths. Numbers: 32–48 steps (40 default); 64³ (hero), 32³ (background wisps).
Animate by scrolling the sample position slowly or crossfading two baked frames. If tier 1 is
still slow, render volumes into a half-resolution target and composite it (an optimisation, not
a default).

---

## Compression and loaders

```bash
npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress ktx2
# LIGHTMAPPED assets: never merge, flatten or simplify (each object owns its UV1 island and its name)
npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress ktx2 \
  --join false --flatten false --simplify false --instance false
# per-slot control: normals/AO/lightmaps UASTC (no banding), albedo ETC1S (small)
npx @gltf-transform/cli uastc in.glb tmp.glb --slots "{normalTexture,occlusionTexture}" --level 2 --zstd 18
npx @gltf-transform/cli etc1s tmp.glb out.glb --quality 200
npx @gltf-transform/cli inspect out.glb        # TEXCOORD_1, texture sizes, draw calls, mesh names
python scripts/bake_lightmap.py --verify-glb out.glb --meshes @baked/lightmap_diffuse.json  # names from the bake manifest
```

Why the flags: `join` merges meshes that share a material (their lightmap UV islands survive, but
the object names the page matches against do not, and one merged mesh can no longer take a
per-object lightmap); `flatten` removes the node hierarchy (names and parents the code keys on);
`simplify` moves and deletes vertices, so the baked UV1 texels no longer line up; `instance`
turns identical meshes into `EXT_mesh_gpu_instancing`, which shares ONE UV1 between copies
(lightmapped objects were made single-user for a reason). Instanced scatter without a lightmap
can take the default `optimize` in a separate file.

`--verify-glb` fails on a missing `TEXCOORD_1`. With `--meshes` it also fails when a named
mesh is gone (merged or renamed), which the TEXCOORD check alone cannot see: a merged mesh still
has `TEXCOORD_1`. Without `--meshes` it only checks attributes.

KTX2 encoding needs **KTX-Software** (`toktx`/`ktx`) on PATH. Lightmaps outside glTF: encode the
`--normalize` PNG as UASTC (`toktx --t2 --encode uastc --uastc_quality 2 --zcmp 18 --genmipmap --assign_oetf srgb lightmap_norm.ktx2 lightmap_diffuse_norm.png`;
sRGB because the script encodes it that way) or ship UltraHDR JPEG; EXR half is for dev only
(formats and flipY: [lightmap recipe](#lightmap-and-ao-bake)).
Gradients (sky, fog cards) band in ETC1S: use UASTC or WebP.

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const ktx2 = new KTX2Loader().setTranscoderPath('vendor/three/addons/libs/basis/').detectSupport(renderer);
const draco = new DRACOLoader().setDecoderPath('vendor/three/addons/libs/draco/gltf/');
const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder).setDRACOLoader(draco);
const gltf = await loader.loadAsync('assets/world.glb');
```

Paths assume the vendored layout from [import map and vendoring](#import-map-and-vendoring)
(CDN: `.../examples/jsm/libs/basis/`). Byte-weighted progress around these loads:
[loader and opening shot](recipes-world.md#loader-and-opening-shot).

Gotchas: `libs/basis/` and `libs/draco/` must come from the same three version as the loaders
(transcoder/API mismatch fails silently or throws). `detectSupport` needs the renderer first.
Prefer Meshopt over Draco (faster decode, compresses animation too); never both.

Instancing: export with `export_gpu_instances=True` (Blender collection/GN instances →
`EXT_mesh_gpu_instancing`; GLTFLoader builds `InstancedMesh`). Realize instances only for
objects that need a unique UV1 lightmap. Check the operator accepts the kwarg first:
`'export_gpu_instances' in bpy.ops.export_scene.gltf.get_rna_type().properties.keys()`.

---

## GPU tiers and adaptive quality

Policy and numbers: [canonical numbers](#canonical-numbers). Every tier is live 3D; the poster
path is only for unsupported/blocklisted GPUs, no WebGL2 and a failure at tier 0. This module
(`quality.js`) owns the **one** renderer factory; every other snippet imports `renderer` and `Q`
from it.

```js
import * as THREE from 'three';
import { getGPUTier } from 'detect-gpu';

const TIERS = [
  /*0*/ { dpr: 1,    msaa: 0, particles: 128, post: false,  ca: false, volumeSteps: 0,  transmission: false },
  /*1*/ { dpr: 1.25, msaa: 0, particles: 256, post: 'lite', ca: false, volumeSteps: 24, transmission: false },
  /*2*/ { dpr: 1.5,  msaa: 4, particles: 512, post: 'full', ca: true,  volumeSteps: 40, transmission: 0.5 },
  /*3*/ { dpr: 2,    msaa: 4, particles: 512, post: 'full', ca: true,  volumeSteps: 40, transmission: 1 },
];
export const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;          // phones/tablets: 30 fps target
const SLOW_MS = coarse ? 38 : 20, FAIL_MS = coarse ? 66 : 50;    // canonical frame-monitor numbers
export let tier = 1, renderer = null;
export const Q = () => TIERS[tier];

// The ONE renderer factory. depth: true always: `depth: false` is only safe when EVERY frame goes
// through the composer (it owns its own depth buffer), and the tier ladder cannot promise that
// (tier 0 renders straight to the canvas, and a runtime drop can land there). The default
// framebuffer's depth costs a few MB; broken depth sorting costs the scene.
// antialias is fixed at creation: true only when booting at tier 0 (no composer, no SMAA/MSAA).
function createRenderer(canvas, bootTier) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: bootTier === 0, depth: true, stencil: false,
    powerPreference: 'high-performance' });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = TIERS[bootTier].post ? THREE.NoToneMapping : THREE.AgXToneMapping; // once, either path
  r.setPixelRatio(Math.min(devicePixelRatio, TIERS[bootTier].dpr));
  return r;
}

export async function boot(canvas) {                   // false = the poster path was taken
  const g = await getGPUTier({ benchmarksURL: './vendor/detect-gpu/benchmarks' }); // self-hosted
  // g.type: 'WEBGL_UNSUPPORTED' | 'BLOCKLISTED' | 'FALLBACK' (unknown GPU, tier 1) | 'BENCHMARK' (tier 0..3)
  if (g.type === 'WEBGL_UNSUPPORTED' || g.type === 'BLOCKLISTED') { showPoster(g.type); return false; }
  tier = THREE.MathUtils.clamp(g.tier ?? 1, 0, 3);      // BENCHMARK tier 0 is still live 3D
  try { renderer = createRenderer(canvas, tier); }
  catch (e) { showPoster('no-webgl2'); return false; }  // three r163+ needs WebGL2 and throws without it
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); showPoster('context-lost'); });
  return true;                                          // reduced motion ALSO returns true (live, settled frames)
}

// runtime guard: MEDIAN frame time per 2 s window (robust to one GC or compile spike, which a mean
// is not); two slow windows in a row step down one tier, never back up in-session. The threshold
// is relative to the device's target, so a phone holding 30–45 fps is NOT driven to tier 0.
let samples = [], winStart = performance.now(), grace = performance.now() + 2000, slow = 0;
export const restartGrace = () => { grace = performance.now() + 2000; samples = []; slow = 0; }; // after a transition
export function monitor(dtMs) {                        // call every frame with the real frame time
  if (reduce) return;                                  // settled frames only: nothing to measure
  const now = performance.now();
  if (now < grace) { winStart = now; return; }
  samples.push(dtMs);
  if (now - winStart < 2000) return;
  samples.sort((a, b) => a - b);
  const median = samples[samples.length >> 1];
  samples = []; winStart = now;
  slow = median > (tier === 0 ? FAIL_MS : SLOW_MS) ? slow + 1 : 0;
  if (slow < 2) return;
  if (tier === 0) return fail(`median frame ${median.toFixed(1)} ms at tier 0`);   // -> poster path
  tier--; applyQuality(Q()); restartGrace();
  console.info('[quality] ->', tier, renderer.info.render);
}
// caller: if (await boot(canvas)) { build scene; await renderer.compileAsync(scene, camera);
//   reduce ? settledLoop() : startLoop(); }
```

**Reduced motion (one path).** The live renderer keeps running; there is no stills path for it.
The [scroller](#virtual-scroll-controller) and the content scene take their `reduce` branches
(no damping, no sway, CA, particle swirl or auto-play), and the loop draws **one settled frame
per section change** instead of every rAF:

```js
let shown = -1, lastT = performance.now();
export const sectionIndexAt = p => sections.reduce((b, x, i) => Math.abs(x.t - p) < Math.abs(sections[b].t - p) ? i : b, 0);
function settledLoop(now = performance.now()) {       // rAF runs, but renders only on a change
  requestAnimationFrame(settledLoop);
  const dt = Math.min((now - lastT) / 1000, 0.1); lastT = now;
  const p = scroller.update(dt), i = sectionIndexAt(p);
  if (i === shown) return;
  shown = i;
  const w = worldAt(sections[i].t);                    // same scene/camera rule as the scrubbed band's settle
  sampleCamera(w.camera, sections[i].t);               // the section's rest pose, never in between
  if (composer && Q().post !== false) {
    renderPass.mainScene = w.scene; renderPass.mainCamera = w.camera;
    composer.render(dt);                               // its ONLY argument is the time delta in seconds
  } else {
    renderer.render(w.scene, w.camera);                // tier 0: straight to the canvas
  }
  document.documentElement.dataset.section = sections[i].id;   // the DOM cross-fade keys on this
}
```

(`worldAt` is defined in [scene transitions](#scene-transitions); a one-world site uses
`{ scene, camera }` for every section.) The DOM and canvas cross-fade under reduced motion,
its duration and `crossfadeCanvas()` live in
[DOM sync during transitions](recipes-world.md#dom-sync-during-transitions): opacity only, no
movement. The poster path (`showPoster`) stays reserved for no WebGL2, blocklisted GPUs and
failure at tier 0; its content: [loader and opening shot](recipes-world.md#loader-and-opening-shot).

**Hook contracts** used above (small reference versions; replace the bodies, keep the contracts):

```js
// showPoster(reason): the static path. Idempotent; stops the loop; reveals the <noscript>-style
// poster already in the DOM; never throws. reason: 'WEBGL_UNSUPPORTED' | 'BLOCKLISTED' | 'no-webgl2'
// | 'context-lost' | 'fail'.
let stopped = false;
export function showPoster(reason) {
  if (stopped) return; stopped = true;
  document.documentElement.dataset.render = 'poster'; document.documentElement.dataset.posterReason = reason;
  renderer?.setAnimationLoop(null); renderer?.domElement.remove();
}
export const isStopped = () => stopped;               // the frame loops return early when true

// fail(msg): a runtime failure at tier 0. Logs once, then takes the poster path.
export function fail(msg) { console.warn('[quality] fail:', msg); showPoster('fail'); }

// current(): the live objects applyQuality touches; each field may be null when not built yet.
export const live = { composer: null, caPass: null, passA: null, smaaPass: null, toneOnlyPass: null,
  transmissive: [], particles: null, volumes: [] };   // transmissive: materials with userData.fallback
export const current = () => live;

// useCpuFallback(n): GPGPU could not init. Build n points on the CPU with the same spring (particle
// section) and keep the same THREE.Points material, fed from a Float32Array texture. Never throws.

// applyQuality(q): idempotent, safe mid-session, only ever called with a LOWER tier.
export function applyQuality(q) {
  const { composer, caPass, passA, smaaPass, toneOnlyPass, transmissive, particles, volumes } = current();
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.dpr));
  if (composer) {
    composer.multisampling = q.msaa;
    if (caPass) caPass.enabled = q.ca;
    if (smaaPass) smaaPass.enabled = !q.msaa;
    if (q.post === false && toneOnlyPass) { passA.enabled = false; toneOnlyPass.enabled = true; } // tier 0, below
    current().syncOutput?.();                          // renderToScreen on the last ENABLED pass
    composer.setSize(innerWidth, innerHeight);
  }
  if (!q.transmission) for (const m of transmissive) { Object.assign(m, m.userData.fallback); m.needsUpdate = true; }
  if ('transmissionResolutionScale' in renderer && q.transmission)
    renderer.transmissionResolutionScale = q.transmission;           // r186 only
  particles?.rebuild(q.particles);                                   // targets are re-sampled per SIZE
  for (const v of volumes) {
    if (q.volumeSteps) { v.material.defines.STEPS = q.volumeSteps; v.material.needsUpdate = true; }
    else v.swapToCards();                                            // tier 0: 2–3 soft alpha cards
  }
}
```

**A runtime drop to tier 0** keeps the canvas it booted with (`antialias: false`; antialias
cannot change after creation) and keeps the composer instead of recreating the context. The
stack collapses to **two passes, tone then SMAA**: SMAA wants display-referred colour (the rule
in the [post stack](#post-processing-stack)), and merging the two into one `EffectPass` would
sort SMAA (a convolution effect) to the front, i.e. before tone mapping.

```js
// at init, next to the post stack: pass A is exported as live.passA; the tone-only pass sits
// right before smaaPass and starts disabled
live.toneOnlyPass = new EffectPass(camera, new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
live.toneOnlyPass.enabled = false;
composer.addPass(live.toneOnlyPass, composer.passes.indexOf(smaaPass));
// the drop (applyQuality with q.post === false): caPass off, passA off, toneOnlyPass on,
// smaaPass on (q.msaa is 0). Tone mapping still happens exactly once.
```

`applyQuality(q)` covers: pixel ratio, `composer.multisampling`, `caPass.enabled`,
`smaaPass.enabled` (`!q.msaa`), transmission on/off (and, r186 only,
`renderer.transmissionResolutionScale`), particles rebuilt at the new size, volume `STEPS`
define (+ `needsUpdate`) or swap to cards. A composer-less boot at tier 0 renders straight to
the canvas with `renderer.toneMapping = THREE.AgXToneMapping`.

Log `renderer.info.render.calls` / `.triangles` and `renderer.info.memory` once per section in
dev builds. Targets: ≤ 150 draw calls, ≤ 1.5 M triangles on tier 2. `document.hidden` → stop the
loop. iOS Low Power Mode caps rAF at 30 fps: a coarse-pointer device is judged against its 30 fps
target (38 ms), so a throttled phone that holds 30 fps keeps its tier; a desktop browser capped
at 30 fps (a 33 ms median) steps down, which is correct there.

---

## Fog with custom shaders

`scene.fog = new THREE.FogExp2(color, 0.035)` and `scene.background = new THREE.Color(color)` with
the **same** colour. In three's built-in shaders `fog_fragment` runs **after** tone mapping and the
colour-space conversion, and `fogColor` is uploaded in output space, so fully fogged pixels equal
the background Color exactly when rendering straight to the canvas.

Mismatch traps: a post chain tone-maps background and fog together (they still match each other
but not a CSS page colour: set the page colour from a canvas sample); far mountain cards drawn with
a lit material will not match: use `MeshBasicMaterial({ fog: true, toneMapped: false })`;
ShaderMaterials ignore fog unless you opt in:

```js
const mat = new THREE.ShaderMaterial({
  fog: true,
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color() } }]),
  vertexShader: `#include <fog_pars_vertex>
    void main(){ vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `uniform vec3 uColor;
    #include <fog_pars_fragment>
    void main(){ gl_FragColor = vec4(uColor, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
});
```

Every `#include` must sit on its own line (preprocessor directive). Height fog for every built-in material,
installed once before any material compiles:

```js
THREE.ShaderChunk.fog_pars_vertex += '\nvarying vec3 vFogWorld;';
THREE.ShaderChunk.fog_vertex += '\n#ifdef USE_FOG\n vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);\n#endif';
THREE.ShaderChunk.fog_pars_fragment += '\nvarying vec3 vFogWorld; uniform float uFogHeight, uFogFalloff;';
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  fogFactor *= exp(-max(vFogWorld.y - uFogHeight, 0.0) * uFogFalloff);   // dense in the valleys
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(fogFactor, 0.0, 1.0));
#endif`;
// add uFogHeight/uFogFalloff via material.onBeforeCompile (shader.uniforms.uFogHeight = shared)
```

Numbers: [canonical](#canonical-numbers) (`FogExp2` density 0.02–0.05 for a 50–100 m world;
height 0–2 m, falloff 0.3–0.8).

---

## Terrain detail

Terrain reads premium at 2× zoom only with multi-scale detail and a sparkle.

Blender: subdivided plane (256×256) → Geometry Nodes Set Position with a **ridged multifractal**
(Noise Texture node, type Ridged Multifractal, scale 0.6–1.2, detail 8, lacunarity 2.1) in Z,
then a high-res copy for normal baking and a low copy decimated/remeshed to **~20k tris**
(Decimate collapse ratio or Voxel Remesh + Decimate). Bake high→low normals:
`bpy.ops.object.bake(type='NORMAL', use_selected_to_active=True, cage_extrusion=0.05, margin=8)`
(select high, then active low; normal map image Non-Color). Far ridges: 2–4 alpha-cut **cards**
(`MeshBasicMaterial`, fog on) at 150–400 m, each a rendered silhouette of the terrain.

Browser: triplanar detail normal at 3 scales plus a glint, added via `onBeforeCompile` on the
terrain's `MeshStandardMaterial`. Each plane's tangent-space `(dx, dy)` is swizzled onto the two
world axes that plane is projected along: X plane (uv = zy) → `(0, dy, dx)`, Y plane (uv = xz)
→ `(dx, 0, dy)`, Z plane (uv = xy) → `(dx, dy, 0)`.

```js
const sunWorld = new THREE.Vector3(0.4, 0.8, 0.3).normalize();      // match the Blender sun / key light
const U = { tDetail: { value: detailNormalTex }, uDetail: { value: 0.35 },
  uSunView: { value: new THREE.Vector3() }, uGlintColor: { value: new THREE.Color(DIR.palette.key) } };
terrainMat.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = 'varying vec3 vWorld;\n' + sh.vertexShader.replace('#include <project_vertex>',
    '#include <project_vertex>\n  vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');  // not instanced
  sh.fragmentShader = 'varying vec3 vWorld;\nuniform sampler2D tDetail;\nuniform float uDetail;\n'
    + 'uniform vec3 uSunView;\nuniform vec3 uGlintColor;\n'
    + sh.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + TRIPLANAR);
};
// every frame: U.uSunView.value.copy(sunWorld).transformDirection(camera.matrixWorldInverse);
```
```glsl
// TRIPLANAR (runs after normal_fragment_maps: `normal` is view space; totalEmissiveRadiance exists)
vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);      // view -> world (transpose of rotation)
vec3 w = pow(abs(nW), vec3(4.0)); w /= dot(w, vec3(1.0));
vec3 dn = vec3(0.0);
for (int k = 0; k < 3; k++) {                // frequencies 0.25, 1, 4 per metre; weights 1, .5, .25
  float s = pow(4.0, float(k)) * 0.25, a = pow(0.5, float(k));
  vec2 tX = texture2D(tDetail, vWorld.zy * s).xy * 2.0 - 1.0;
  vec2 tY = texture2D(tDetail, vWorld.xz * s).xy * 2.0 - 1.0;
  vec2 tZ = texture2D(tDetail, vWorld.xy * s).xy * 2.0 - 1.0;
  dn += a * (w.x * vec3(0.0, tX.y, tX.x) + w.y * vec3(tY.x, 0.0, tY.y) + w.z * vec3(tZ.x, tZ.y, 0.0));
}
normal = normalize(normal + (viewMatrix * vec4(dn, 0.0)).xyz * uDetail);
// glint: sparse view-dependent sparkles (snow, sand, frost, mica paint, wet asphalt): pick per direction
vec3 R = reflect(-normalize(vViewPosition), normal);            // vViewPosition points surface -> camera
float g = step(0.985, fract(sin(dot(floor(vWorld.xz * 60.0), vec2(12.9, 78.2))) * 43758.5));
totalEmissiveRadiance += uGlintColor * g * pow(max(dot(R, uSunView), 0.0), 64.0) * 6.0; // > 1 so it blooms
```

Gotchas: `TRIPLANAR` is the GLSL above as a JS string (every `#include` on its own line). The
swizzle ignores the sign of the facing axis, which is fine for detail normals at `uDetail`
0.2–0.5 and wrong for a primary normal map. Instanced terrain pieces need `instanceMatrix` in
`vWorld`. Detail textures are Non-Color (`NoColorSpace`) with `RepeatWrapping` and anisotropy 8.

---

## Hero assembly intro

**One opening-shot option among several** (pour, light-up, unfold, camera arrival, sound-led…):
pick it only when the story is "parts become a whole". The shot list and the loader handoff live
in [loader and opening shot](recipes-world.md#loader-and-opening-shot). The mechanic: parts fly in
from an exploded pose, optional annotations appear, then scrolling takes over.

```js
import gsap from 'gsap';
const parts = []; hero.traverse(o => { if (o.isMesh) parts.push(o); });   // flatten parts under hero in Blender
const bb = new THREE.Box3(), v = new THREE.Vector3();
for (const o of parts) {
  o.geometry.computeBoundingBox(); bb.copy(o.geometry.boundingBox);
  const c = bb.getCenter(v).multiply(o.scale).applyQuaternion(o.quaternion).add(o.position); // part centre, hero space
  const dir = c.lengthSq() > 1e-8 ? c.clone().normalize() : new THREE.Vector3().randomDirection();
  const size = bb.getSize(new THREE.Vector3()).multiply(o.scale).length();                  // part size (diagonal)
  const e = new THREE.Euler(...[0, 0, 0].map(() => THREE.MathUtils.degToRad((Math.random() * 2 - 1) * 15)));
  o.userData.rest = { p: o.position.clone(), q: o.quaternion.clone() };
  o.userData.exploded = { p: o.position.clone().addScaledVector(dir, size * (1 + Math.random())), // 1–2× part size
    q: o.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(e)) };                 // ±15°
}
const pose = (o, a) => { const ex = o.userData.exploded, r = o.userData.rest;
  o.position.lerpVectors(ex.p, r.p, a); o.quaternion.slerpQuaternions(ex.q, r.q, a); };
parts.forEach(o => { o.userData.a = 0; pose(o, 0); });           // start exploded, before the first frame
const stagger = Math.min(0.04, 0.8 / parts.length);              // 40 ms, total stagger ≤ 0.8 s
const intro = gsap.timeline({ paused: true });
parts.forEach((o, i) => intro.to(o.userData, { a: 1, duration: 1.6, ease: 'expo.out',
  onUpdate: () => pose(o, o.userData.a) }, i * stagger));
// after compileAsync, on the loader's handoff timeline: auto-play to a "gathering" pose, then the
// first 12 % of scroll finishes it (scrolling back up re-opens it):
if (reduce) intro.progress(1); else await intro.tweenTo(0.35 * intro.duration());
function introScrub(progress) {
  if (!reduce) intro.progress(THREE.MathUtils.mapLinear(THREE.MathUtils.clamp(progress, 0, 0.12), 0, 0.12, 0.35, 1));
}
```

Annotations are optional and styled by the approved direction: leader lines between part
anchors (`LineSegments`, `LineBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false })`,
fading out as assembly completes) and DOM labels projected each frame (next section). Their
font, case, size, colour and placement come from the direction; a monospace spec-sheet
constellation is one example (the igloo look), a hand-lettered menu note or a stencilled
flight-case tag are others. Timing: [canonical](#canonical-numbers).

---

## Text reveal and chrome

DOM first (accessible, SEO, crisp). The **mechanics** below are fixed; the **styling** is a
per-direction variable: font family, case, size, tracking, colour, glyph set and where the
chrome sits all come from the approved direction (see the chrome row in
[igloo-tier.md](igloo-tier.md)).

The reveal below is a glyph scramble; the same wrapper (hidden accessible text + `aria-hidden`
animated span) serves any per-character reveal a direction picks instead (fade-up per letter,
ink-bleed, typewriter). Screen readers get the final text once from the visually hidden sibling;
nothing is announced mid-reveal.

```js
export function scramble(el, to, { glyphs = DIR.type.glyphs, msPerChar = 50,   // glyph set per direction
  reduce = matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
  let sr = el.querySelector(':scope > .sr-only'), vis = el.querySelector(':scope > [aria-hidden="true"]');
  if (!sr || !vis) {
    el.textContent = '';
    sr = Object.assign(document.createElement('span'), { className: 'sr-only' });
    vis = document.createElement('span'); vis.setAttribute('aria-hidden', 'true');
    el.append(sr, vis);
  }
  sr.textContent = to;                                        // the accessible name, set once
  cancelAnimationFrame(el._raf);
  if (reduce) { vis.textContent = to; return; }
  const from = vis.textContent, len = Math.max(from.length, to.length), t0 = performance.now();
  const ms = Math.min(msPerChar, 600 / Math.max(len, 1));    // whole scramble ≤ 600 ms
  (function tick(now) {
    const done = Math.floor((now - t0) / ms); let out = '';
    for (let i = 0; i < len; i++) out += i < done ? (to[i] ?? '') : (to[i] === ' ' ? ' ' : glyphs[(Math.random() * glyphs.length) | 0]);
    vis.textContent = out;
    if (done < len) el._raf = requestAnimationFrame(tick);
  })(t0);
}
```
```css
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; border: 0; }
/* chrome: every value is a token written from DIR.type.chrome (see applyChromeTokens below) */
.hud { position: fixed; font: var(--hud-weight) var(--hud-size)/1.4 var(--hud-font);
  letter-spacing: var(--hud-tracking); text-transform: var(--hud-case); color: var(--hud-ink);
  font-variant-numeric: tabular-nums; pointer-events: none; }
.tag { position: fixed; left: 0; top: 0; will-change: transform; white-space: pre; font: inherit; }
@media (pointer: coarse), (max-width: 767px) { .hud { font-size: max(var(--hud-size), 12px); } }
/* ONE example direction only (a monospace spec-sheet look), not a default: */
.dir-spec { --hud-font: 'JetBrains Mono', monospace; --hud-case: uppercase; --hud-size: 11px;
  --hud-weight: 500; --hud-tracking: .08em; --hud-ink: rgb(255 255 255 / .62); }
.dir-spec .hud--tl { top: 24px; left: 24px } .dir-spec .hud--br { right: 24px; bottom: 24px }
```
```js
export function applyChromeTokens(c = DIR.type.chrome, ink = DIR.palette.ink) {
  const r = document.documentElement.style;
  r.setProperty('--hud-font', c.font); r.setProperty('--hud-case', c.case);
  r.setProperty('--hud-size', Math.max(11, Math.round(c.size)) + 'px');   // canonical floor, whole px
  r.setProperty('--hud-weight', c.weight); r.setProperty('--hud-tracking', c.tracking);
  r.setProperty('--hud-ink', '#' + ink.toString(16).padStart(6, '0'));
}
```

Other directions set the same tokens differently, for example a menu-card serif in sentence
case centred above the fold, or a condensed stencil wordmark pinned bottom-left. Placement
classes are written per direction; the corners are not a default. In a proportional font the
scramble reflows as glyph widths change: reserve the final width with the technique in
[fonts and loading](recipes-world.md#fonts-and-loading) (the `aria-hidden` span is its live
cell; the final text goes in the reserving copy).

Projected labels (every frame, after the camera update):

```js
const v = new THREE.Vector3();
for (const { anchor, el } of labels) {
  anchor.getWorldPosition(v).project(camera);
  const hidden = v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1;
  el.style.opacity = hidden ? 0 : 1;
  el.style.transform = `translate3d(${((v.x + 1) / 2 * innerWidth) | 0}px, ${((1 - v.y) / 2 * innerHeight) | 0}px, 0)`;
}
```

Numbers: [canonical](#canonical-numbers) (50 ms per char, ≤ 600 ms total; chrome text floor
11 px desktop / 12 px phones, restack on portrait instead of shrinking). Round to whole pixels (blurry text otherwise). `troika-three-text` (SDF) only for
text that must live in the 3D scene (depth-occluded, fogged); it is not accessible, so mirror it
in the DOM. Typeface loading: [fonts and loading](recipes-world.md#fonts-and-loading).

---

## Sound graph

Off by default; a visible HUD toggle; starts only after a user gesture (autoplay policy).
Where the stems come from (and a procedural fallback):
[sound sourcing](recipes-world.md#sound-sourcing-and-procedural-fallback).

```js
let ctx = null, master, lp, soundOn = false;         // nothing exists until the first click
const stems = {}, sfx = {};                           // one looping stem per scene
function initAudio() {                                // called only from the toggle's click handler
  ctx = new AudioContext();                           // created inside the gesture: never "suspended" on Safari
  master = ctx.createGain(); master.gain.value = 0;
  lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800; lp.Q.value = 0.7;
  lp.connect(master).connect(ctx.destination);
  STEMS.forEach(([id, url]) => addStem(id, url));     // lazy: stems load only once sound is wanted
}
const buf = async url => ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
async function addStem(id, url) { const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = await buf(url); src.loop = true; g.gain.value = 0; src.connect(g).connect(lp); src.start(); stems[id] = g; }
function toScene(id, fade = 1.5) {                    // equal-ish crossfade
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const [k, g] of Object.entries(stems)) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(k === id ? 1 : 0, t, fade / 3); }
}
async function oneShot(name, vol = 0.5) { if (!soundOn) return;
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = sfx[name] ??= await buf(`audio/${name}.mp3`); g.gain.value = vol; s.connect(g).connect(master); s.start(); }
function onScrollVelocity(v) {                        // progress/sec from the scroller
  if (!ctx) return;
  const k = Math.min(Math.abs(v) * 4, 1);
  lp.frequency.setTargetAtTime(800 + k * 7200, ctx.currentTime, 0.1);   // 800 -> 8000 Hz
}
toggle.addEventListener('click', async () => {
  if (!ctx) initAudio();
  await ctx.resume();
  soundOn = !soundOn;
  master.gain.setTargetAtTime(soundOn ? 0.8 : 0, ctx.currentTime, 0.2);
  toggle.setAttribute('aria-pressed', String(soundOn));
});
// STEMS = [['intro', 'audio/intro.ogg'], …]  (sourcing: recipes-world.md link above)
```

Gotchas: the context is created in the click handler, never at load (Safari keeps a context made
outside a gesture suspended, and Chrome warns). OGG/Opus for size with an MP3 fallback for old
Safari. Duck the bed under one-shots and master everything to the loudness row in
[canonical numbers](#canonical-numbers). Pause on `visibilitychange`. Stems 60–120 s seamless loops; one-shots
(hover tick, transition whoosh) < 30 KB each. The whoosh is exactly the
[transition length](#canonical-numbers) (1.2 s): fire it on entering the scrubbed band or on the
threshold timeline's start, and duck the bed under it.

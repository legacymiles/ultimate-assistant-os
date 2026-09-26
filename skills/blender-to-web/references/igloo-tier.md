# Tier 3: what makes a world-class immersive site (illustrated by igloo.inc)

This is the guide for **tier 3**, the top quality level. The file keeps the name "igloo tier"
because [igloo.inc](https://www.igloo.inc) (Awwwards Site of the Year 2024, Abeto × Bureaux)
is one example of the **quality level**. It is **not** the reference for the look, and it is
not the gauntlet bar by default (the bar is picked per project in SKILL.md Stage 5). Every rule
below is a universal principle plus how to derive it from **this** brand. igloo's choices
(snow, ice, cold monochrome, monospace HUD, block assembly) appear only as one example column
next to contrasting brands. Nothing here is a default look.

Sources for the igloo example: the [Awwwards case study](https://www.awwwards.com/igloo-inc-case-study.html)
and the [WebGPU.com breakdown](https://www.webgpu.com/showcase/igloo-inc-procedural-crystals/).
Their stack: Three.js, three-mesh-bvh, Svelte, GSAP, Vite. 3D and textures made in Houdini and Blender.

This file covers **what to build and why**, the taste rules, and the scroll/wayfinding rules
(this file is their single source). **Each number lives in exactly one place:**
[recipes.md](recipes.md) (rendering and technique: scroll, post, particles, transitions, tiers,
chrome text sizes), [recipes-world.md](recipes-world.md) (the numbers of its own sections: world
types, content scene, loader, portrait framing, fonts, sound sourcing, DOM sync, cursor states),
and this file (design intent and ship budgets only). Where this file and a recipe seem to
differ, the recipe wins.

## 1. The lesson: derive, don't copy

igloo is one brand's answer: a crypto venture studio that shows itself as a cold, precise,
glowing shelter. A restaurant, a band, a nonprofit or a product reaches the same quality through
the same **disciplines**, with a look taken from its **own** brand. Never ship snow, ice, a cold
monochrome palette, a monospace HUD or a block-assembly intro because igloo has them. Each
direction from Stage 1 decides each discipline for itself and writes down what it chose and why.

> Test: cover the logo. If a critic would say "that's an igloo clone", the direction copied the
> instance instead of the principle.

What stays the same for every brand: the scene is a **world** (never a bare void), a
**journey** through authored shots, **baked film-quality light**, **one signature material**,
**choreographed transitions** that the DOM takes part in, a **content scene** where brand items
are objects in the world, a **designed opening shot** out of the loader, and **craft that holds
at 2x zoom**, in portrait too.

## 2. Journey storyboard (required artifact)

Two stages, said the same way SKILL.md says them:

- **Stage 1 (per direction):** **three keyframes** (intro/hero · inside reveal or mid-journey ·
  content scene) and a **sketch storyboard of 3–4 rows** under them: opening shot, inside/beyond
  reveal, content scene, (optional) close. No portrait keyframe yet.
- **Stage 2a (chosen direction only):** the **full storyboard, 4–6 scenes**, every column filled,
  plus a **portrait keyframe** of the chosen direction, approved together with the previs at the
  **Stage 2a STOP**.

Two scenes are required in both:

- **An inside/beyond reveal:** the camera goes *into* or *through* the hero or world (inside the
  object, under the surface, behind the label, through the speaker grille, into the kitchen).
- **A content scene:** the brand's real items (projects, products, dishes, tracks, campaigns)
  are **3D objects in the world**, each with a hover state and a detail state. A list of HTML
  cards does not count. Mechanics (picker, detour camera off the path and back, Esc/back,
  hash deep link, focus management): [recipe](recipes-world.md#content-scene-interaction).

Header line: **world type** (§3 row 1) · **scroll model** (§4) · **chrome** · **opening-shot type** (§3 row 7) · **primary action** (§4).

| # | Beat (story) | Environment | Shot: lens mm + move | Light mood | Chrome / copy (≤12 words) | Primary action | Interaction | Transition out: trigger + mask (+ what the DOM does) | Portrait framing | Scroll range |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | … | … | e.g. 35 mm, slow push-in | … | … | e.g. "Book a table" in chrome | … | e.g. scrubbed band, steam wipe; headline leaves first | e.g. capped FOV, hero whole in the **middle third**; copy placed per direction, **never across the hero** ([framing](recipes-world.md#portrait-framing)) | 0.00–0.15 |
| … | | | | | | | | | | |

**igloo's instance** (one example, for reference only; approximate):

| # | Beat | Environment | Shot | Light | Chrome / copy | Primary action | Interaction | Out | Portrait framing | Range |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Arrival | Snow terrain, far ridges, drifting snow | ~35 mm, slow orbit + push | Overcast, inner glow through block gaps | Wordmark, corner labels, scroll hint | Contact link in chrome | Blocks assemble with a numbered-node overlay | Push into the doorway (one world, no swap) | Igloo whole in the middle third, snow above and below; corner labels stack | 0–0.2 |
| 2 | Inside | Ice interior, refractive walls | Wide, drifting through | Cold caustic glow | Section label | same | Pointer parallax | Frost dissolve; label re-types | Narrower drift, walls frame the sides | 0.2–0.4 |
| 3 | Portfolio | Each venture frozen in its own ice block | Portrait lens, dolly block to block | Backlit crystals | Venture name + one line | same + venture link in detail | Hover = scramble + glint; click = detail | Particle burst | One block per screen, copy below it | 0.4–0.7 |
| 4 | Links | Particle field | Static, close | Dark with emissive points | Link list | Link list | Hover a link = particles morph into its shape | Dissolve | Field recentred, list stacked | 0.7–0.9 |
| 5 | Manifesto / footer | Back outside, pulled wide | Pull back | Dimmer, calm | Manifesto, boilerplate | Contact | Sound toggle | — | Wide pull becomes a tall pull-up | 0.9–1.0 |

How other brands derive it (examples, not templates):

| Brand | World type | Opening shot | Inside/beyond reveal | Content scene |
|---|---|---|---|---|
| Restaurant | Interior (kitchen + pass) | Light-up: the pass lamps come on one by one through steam | Into the oven, through steam | Dishes on a long pass, each under its own heat lamp |
| Band | Interior set (stage) | Sound-led: first chord, strobe reveals the rig | Through the speaker cone | Tracks as pressed records or stage props; hover plays 5 s |
| Nonprofit | Miniature diorama | Unfold: the paper place folds up out of a flat sheet | Into the folded model | Programs as paper dioramas; detail shows the numbers |
| Product | Abstract void with depth cues | Camera arrival past the casing | Through the casing into the mechanism | Variants or features as parts on a workbench |

## 3. The disciplines

Each row: the universal principle, the question that derives it from **this** brand, two
contrasting brand examples, igloo's choice (one example among many), and the recipe.
Rows marked **option** are chosen or rejected per direction; all others are required.
Technique numbers: in the linked recipe, never here.

| # | Discipline | Principle (universal) | Derive it: ask of this brand | e.g. warm restaurant | e.g. loud band | e.g. igloo | Recipe |
|---|---|---|---|---|---|---|---|
| 1 | **A world, never a bare void** — pick a **world type** | Hero sits in an environment with fore/mid/far layers, atmosphere and ambient motion. World type is a choice: **outdoor terrain** · **interior or set** (room kit, trim sheets, props, practical lights, haze) · **miniature diorama** · **abstract void with depth cues** (fog gradient, floor reflection, scale objects, light shafts) | Where does this brand live, physically or in its myth? | Interior: kitchen haze, copper and tile, steam | Set: stage smoke, truss, crowd silhouettes | Outdoor terrain: snow, far ridges in fog | [interior](recipes-world.md#interior-and-set-worlds), [terrain](recipes.md#terrain-detail), [fog](recipes.md#fog-with-custom-shaders) |
| 2 | **Surfaces at 2x zoom** | Floors, walls and ground have micro detail that survives a zoom crop | What is that world made of? | Worn oak, flour dust, zellige | Scuffed boards, gaffer tape, wet concrete | Ridged snow with glints | [terrain](recipes.md#terrain-detail), [interior](recipes-world.md#interior-and-set-worlds) |
| 2b | **Materials that survive export** | glTF drops Blender node graphs: every procedural material is **baked to textures** before export. Source base materials from Poly Haven via the `blender` MCP (CC0) before inventing them | Which surfaces are procedural in Blender? | Tile + grout, oak grain | Concrete, rust | Snow, ice noise | [bake procedurals](recipes-world.md#baking-procedural-materials-to-textures) |
| 3 | **Baked, film-quality light** | AO in every crevice, soft bounce, light whose source you can read (sun, window, practical, or light from within). The biggest single premium gain | What light is this brand seen in, and how does it change across the visit? A **light rig per mood**; per-section light changes blend two baked lightmaps | Low tungsten, candle warmth; dinner → late night | Hard coloured wash, strobes; soundcheck → show | Overcast skylight + inner glow | [bake](recipes.md#lightmap-and-ao-bake), [rig per mood](recipes.md#light-rig-per-mood) |
| 4 | **Signature hero material** | One hard-to-do material that becomes the brand's memory | Which material would the brand be proud to be made of? | Glaze, lacquer, broth in glass | Chrome, iridescent vinyl, sweat-sheen | Ice: transmission + dispersion | [presets](recipes.md#signature-material-presets) (glaze, lacquer/car paint, fabric sheen, iridescent vinyl, wax/food SSS-fake, brushed metal, ice/glass), [refractive](recipes.md#refractive-and-crystal-materials) |
| 5 | **Procedural hero detail** | Many unique variants from one script + seed | What does the brand have many of? | Dishes, bread scorings | Record labels, pedals | Blocks each "grown" with a crystal inside | note below |
| 6 | **Signature light event** | One authored light change the visitor remembers, derived from the brand: a daylight shaft, a sun patch moving across the set, a colour shift, practicals switching on, a strobe, or an inner glow. Bloom only if the direction uses emissive; **none** (no separate event) is allowed for high-key directions when the light story lives in the baked moods (row 3) | When does light *happen* to this brand? | Pass lamps switch on through steam | Strobe hit on the downbeat | Inner glow leaking between blocks | [rig per mood](recipes.md#light-rig-per-mood), [post](recipes.md#post-processing-stack) (if emissive) |
| 7 | **Designed opening shot** | The first shot **resolves out of the loader** and ends on the hero, then hands over to scroll. Pick **one** type: assembly · reveal through fog/steam · light-up · pour · unfold · camera arrival · sound-led reveal. A data/label overlay is **optional**, styled in the direction's voice | How does this brand come into being, or into view? | Light-up through steam | Sound-led: chord + strobe | Assembly with numbered nodes | [loader + opening](recipes-world.md#loader-and-opening-shot), [assembly](recipes.md#hero-assembly-intro) (if chosen) |
| 8 | **Camera journey** | Blender-authored camera path; scroll moves along it; sections are time ranges | What is the visit, as a sequence of shots? | Door → pass → table | Crowd → stage → backstage | Orbit → into the igloo → block to block | [camera](recipes.md#camera-path-export-and-scroll-mapping), [scroll](recipes.md#virtual-scroll-controller) |
| 9 | **Wayfinding** | Visitor always knows where, how far, how to move on, with any input (§4) | What does a counter look like in this voice? | "Course 2 of 5" | Setlist "02 / 05" | Minimal scroll hint | [scroll](recipes.md#virtual-scroll-controller) |
| 10 | **Choreographed transitions** | Out-motion → masked moment → in-motion; never a cut. **The DOM takes part**: copy and chrome leave and arrive on the same beat, in the brand's voice. Trigger and mask chosen per transition (note below) | What wipe exists in this world? | Steam wipe; menu card slides | Strobe white-out; setlist flips | Chromatic split + frost dissolve | [transitions](recipes.md#scene-transitions), [DOM sync](recipes-world.md#dom-sync-during-transitions) |
| 11 | **Content scene** | Brand items as objects in the world: hover, detail, back (§2) | What are the brand's real items? | Plated dishes | Records | Ventures in ice | [content scene](recipes-world.md#content-scene-interaction) |
| 12 | **Particle morph** (option) | Points swarm into a shape per hovered link; colour follows speed | What is the brand's dust? | Spice, flour | Sparks, confetti | Points morph into glyphs | [particles](recipes.md#particle-morph-gpgpu) |
| 13 | **Volumes** (option) | Real depth in smoke, steam, cloud | Is there air you can see? | Steam over the pass | Haze in beams | Clouds | [volumes](recipes.md#volumes) |
| 14 | **Chrome per direction** | **Chrome per direction (nav, wordmark or HUD)**, chosen in Stage 1 from the brand; quiet, never a template nav by accident | Which type voice speaks here, and where does it sit? | Menu-card serif nav | Gig-poster stencil wordmark | Corner HUD | [chrome](recipes.md#text-reveal-and-chrome) |
| 15 | **Text reveal** | **Text reveal in the direction's voice**: letters arrive with character, DOM-first, no reflow | How does this brand's type appear? | Letterpress fade-in | Strobe flicker | Character scramble | [text](recipes.md#text-reveal-and-chrome) |
| 16 | **Type and fonts** | A pairing per direction, self-hosted and preloaded; text reveals on `document.fonts.ready`, never swaps visibly | Which two faces are this brand? | Old-style serif + humanist sans | Condensed grotesk + mono | Mono + sans | [fonts](recipes-world.md#fonts-and-loading) |
| 17 | **Sound** | Audio reacts to motion, off by default, visible toggle. Source it: CC0 libraries, an AI audio tool the user approves, or a procedural Web Audio fallback | What does the world sound like? | Sizzle, cutlery, room tone | Crowd roar, feedback | Ambient + particle SFX | [graph](recipes.md#sound-graph), [sourcing](recipes-world.md#sound-sourcing-and-procedural-fallback) |
| 18 | **Cursor and touch** | Every hover has a tap equivalent; `:focus-visible` on every control; a cursor-state table (idle / interactive / dragging / loading); hover never shifts layout | What does pointing feel like here? | Soft dot that warms on hover | Hard crosshair | Native or small `+` | [cursor + touch](recipes-world.md#cursor-and-touch-states) |
| 19 | **Designed loader** | Part of the design; flows into the opening shot (row 7) | How is the mark made? | Poured, plated | Tuned, amped up | Morphing glyph line | [loader](recipes-world.md#loader-and-opening-shot) |
| 20 | **Adaptive quality** | Measured continuously; steps down, never stutters (§8) | Same for every brand | same | same | Runs live on phones | [tiers](recipes.md#gpu-tiers-and-adaptive-quality) |

**Procedural detail and fracture (row 5).** Geometry Nodes has **no native fracture node**.
Use one of: the **Cell Fracture** extension (no longer bundled since Blender 4.2; install it from
extensions.blender.org), a **Python loop** that booleans the mesh against each Voronoi cell, or
**fake inner structure**: Voronoi-driven displacement or emission inside the material, or a
raymarched/parallax interior in the shader ([refractive recipe](recipes.md#refractive-and-crystal-materials)).
GN handles scatter, instance, realize, noise displacement and bevel; each variant is a seed.
Bake the result (row 2b) before export.

### Intent notes per discipline (numbers: see the linked recipe)

- **Signature material (4).** If transmissive (glass, ice, broth, gel, resin), take `ior` from
  the real material, bake thickness in Blender, and allow **one** real transmission layer on
  screen; fake the rest with an env/matcap. Numbers: [recipe](recipes.md#refractive-and-crystal-materials).
- **Opening shot (7).** Whatever the type, it starts where the loader ends (no blank frame),
  lands on a composed hero frame, and hands over to scroll so scrolling back re-plays it in
  reverse. Any overlay (labels, numbers, lines) speaks the direction's voice, never igloo's
  nodes by default. Numbers: [loader + opening](recipes-world.md#loader-and-opening-shot); if
  the type is assembly, [assembly](recipes.md#hero-assembly-intro). Overlay technique:
  exploded-showcase `references/annotations.md`.
- **Light (3).** Each storyboard scene names a light mood; the rig per mood is authored and baked
  in Blender. A mood change between sections blends two baked lightmaps on the transition's beat,
  never a re-lit realtime scene ([rig per mood](recipes.md#light-rig-per-mood)).
- **Transitions (10).** A transition is either **scrubbed** by scroll across a band around the
  section boundary (the default; it reverses naturally) or **threshold-triggered**: crossing the
  boundary plays it, crossing back reverses it, input is locked while it runs. Choose per
  transition and write it in the storyboard. A one-world fly-through needs no scene swap; use a
  scene A/B swap only when the environments differ. Mask source, derived from the brand's world:
  noise, an **authored grayscale wipe baked in Blender** (steam, paper fold, a door's shadow), or
  a **directional velocity smear** (strobe, speed). Numbers: [transitions](recipes.md#scene-transitions),
  [DOM sync](recipes-world.md#dom-sync-during-transitions).
- **World (1–2).** Terrain: detail at several scales, triplanar on slopes, far backdrop layers
  each deeper in fog, haze or value falloff ([terrain](recipes.md#terrain-detail)). Interior/set: modular kit + trim
  sheets, props that tell the brand's story, practical lights that are also the lightmap's
  sources, haze in their beams ([interior](recipes-world.md#interior-and-set-worlds)).
- **Fog (1).** Fog colour matches the clear colour; every custom `ShaderMaterial` includes the
  fog chunks, or it glows through the fog as a cut-out ([fog](recipes.md#fog-with-custom-shaders)).
- **Light event + post (6).** Stage the event on a section beat (a lightmap blend, a moving light cookie or a practical switching on), never a timer. If the direction uses emissive, only emissive parts bloom; a high-key direction may run no bloom at all. Either way, grain, vignette and chromatic aberration are
  seasoning, raised only during transitions. Use **as few `EffectPass`es as the effects allow**
  (convolution effects such as chromatic aberration need their own pass). Tone mapping in one
  place only. Numbers: [post](recipes.md#post-processing-stack).
- **Particles (12).** Motion reads as a swarm with weight, colour follows speed, additive +
  bloom. Counts per tier: [particles](recipes.md#particle-morph-gpgpu),
  [tiers](recipes.md#gpu-tiers-and-adaptive-quality).
- **Sound (17).** Filter follows scroll velocity, stems crossfade per scene, whoosh length =
  transition length, lazy-load after the first gesture. Numbers: [sound](recipes.md#sound-graph).
- **Cursor (18).** Pointer parallax is small and damped; hover = text reveal + optional particle
  target + optional tick. Numbers: [cursor + touch](recipes-world.md#cursor-and-touch-states).

## 4. Scroll model and wayfinding (single source for these rules)

Pick **one** per project and write it in the storyboard header:

| Model | How | Pick when |
|---|---|---|
| **Virtual-scroll journey** | Body fixed (`overflow: hidden`); wheel, touch and keyboard deltas drive a progress value 0–1 | The site is one continuous camera flight with snapping scenes |
| **Tall spacer + pinned canvas** | Native scroll over a tall spacer; canvas `position: fixed`; progress = scrollY / range. Meets every rule below too (snippet + skip link in the [recipe](recipes.md#virtual-scroll-controller)) | Deep links, find-in-page, screen readers, browser scroll restoration, long DOM content, SEO |

Lenis can smooth native scroll; its `virtualScroll` option is only a **callback that filters
wheel/touch events**, not a progress source. For a virtual journey, own the progress value.
On the canvas/stage use `touch-action: none` and `overscroll-behavior: none` so the browser
does not steal the gesture or bounce the page ([recipe](recipes.md#virtual-scroll-controller)).

Both models must meet all of these (numbers: [recipe](recipes.md#virtual-scroll-controller)):

- **Damped progress:** frame-rate-independent damping or a critically damped spring; never raw deltas.
- **Soft snap:** after a short idle, ease to the nearest section's rest time.
- **Keys:** ArrowDown/Up, PageDown/Up, Space/Shift+Space, Home, End.
- **Touch:** amplified delta with inertia; hover states have tap equivalents (§3 row 18).
- **Real DOM:** a visually-hidden section list (`<nav>` with anchors, real headings and copy per
  section). Focusing or following an anchor drives progress to that section. A skip-to-content link.
- **Deep links:** each section and each content-scene item has a hash; loading it lands there
  ([content scene](recipes-world.md#content-scene-interaction)).
- **Counter:** a visible section counter ("02 / 05") in the direction's type voice.
- **Scroll hint:** visible at start, fades after the first delta.
- **DOM in sync:** copy and chrome change on the transition's beat, not on a timer
  ([DOM sync](recipes-world.md#dom-sync-during-transitions)).
- **Primary action** (the genre's: Book a table, Buy, Get tickets; [brief](brief.md#genre--primary-action-and-interactions)):
  persistently reachable in the chrome as a real, focusable `<a>` (never canvas-drawn), present
  in the portrait layout, and repeated in the content scene or the finale.
- **Chrome text:** never below the chrome-text minimum (desktop and phone values:
  [canonical numbers](recipes.md#canonical-numbers)).
- **Reduced motion (the one path):** the live renderer keeps running but draws **one settled
  frame per section change** (no camera flight, no idle motion, no scrubbed transitions);
  sections cross-fade; all content and the primary action stay reachable. Poster/stills are
  **only** for no WebGL, a blocklisted GPU, or a runtime failure, never for reduced motion.

## 5. Copy

- Terse and voiced. **≤12 visible words per scene.** The world is the headline.
- Label hierarchy by the direction's own type system (size, weight, case, or prefixes if the
  direction uses a HUD). No borrowed `//` prefixes by default.
- One manifesto block (3–5 lines) that says what the brand believes.
- Boilerplate (copyright, address, legal) is texture: small, low contrast, always present.
- The wordmark belongs to the world's light: it catches the signature light event (§3 row 6).
  If the world glows, WebGL with emissive above the bloom threshold or DOM with a CSS glow matched
  to the bloom's colour and radius; in a daylight or high-key world, the shaft, shadow or colour
  shift that crosses the scene crosses the wordmark too.

## 6. Build order

1. **Stage 1:** three keyframes per direction + a 3–4-row sketch storyboard under them.
2. **Stage 2a previs:** full 4–6-scene storyboard for the chosen direction + its portrait
   keyframe + greybox world +
   camera path, a 10–20 s low-res walkthrough of the whole journey (Workbench/EEVEE), plus a
   portrait pass. **STOP** for the user's OK.
3. **World + hero assets:** world type kit (terrain, interior kit, diorama or void cues), hero
   (procedural where possible), far layers, the signature light event's source (window, cookie,
   practicals or inner-glow mesh), content-scene objects. Bake
   procedural materials to textures, then AO/lightmaps. One `.blend` + one build script per asset.
4. **Camera + sections:** export the camera animation (plus portrait framing per section);
   sections = time ranges with copy, chrome state and post settings.
5. **Runtime skeleton:** designed loader → `compileAsync` → opening shot → scroll model →
   section changes with DOM sync. Colour management first: sRGB output, textures tagged sRGB
   vs linear, tone mapping in one place only. Fonts preloaded, reveal on `document.fonts.ready`.
   Head/SEO: `<title>`, meta description, OG image (reuse the poster), favicon, canonical URL,
   real DOM content for crawlers (the §4 section list), and a `<noscript>` fallback (poster,
   section copy, primary action). Recipe: [head, SEO and noscript](recipes-world.md#head-seo-and-noscript).
6. **Atmosphere:** fog or haze, particles, the light event, bloom (if emissive), grain, vignette, CA. Tune against the baked light,
   never against a bare scene.
7. **Signature interactions:** opening shot, hover/tap, content-scene detail + back + deep link,
   particle morph (if chosen), transitions, cursor states.
8. **Sound** (sourced or procedural), then **quality tiers** and **fallbacks**.
9. **Gauntlet** (SKILL.md Stage 5) against the per-project bar picked in SKILL.md Stage 5
   (genre-matched, judged on craft).

## 7. Taste rules (universal)

- **One dominant palette logic, restraint in accents.** One temperature or value family carries
  the world; at most one or two accents, used where the story needs the eye. Derived from the
  brand (igloo happens to be cold near-monochrome; a restaurant might be warm umbers + one ember
  orange). Four equally saturated colours read as a template.
- **Everything moves a little, nothing moves a lot.** Particles drift, the light breathes, the
  camera sways a few centimetres. Idle stillness is a bug; idle chaos is worse.
- **Weight.** Long damped curves (critically damped springs, `expo.out`). Never linear; bounce
  only when bounce is the point.
- **Small, confident type.** The hero is the headline. Big display text only where the story needs it.
- **Materials read at 2x zoom.** Bevels catch light, roughness varies, no default grey
  `MeshStandardMaterial` anywhere. Critics zoom in.
- **Depth layers.** Foreground, midground hero, background recedes through fog, haze, value falloff, desaturation or scale. A flat
  single-plane scene cannot score 8.5.
- **Transitions are choreographed** (out-motion, masked moment, in-motion) and the words move with them.
- **Mobile is a composition, not a crop.** Every scene has its own portrait framing (the
  storyboard column): re-frame the camera, keep the hero whole, let the world fill the rest; the
  chrome restacks and never drops below the chrome-text minimum (§4;
[portrait framing](recipes-world.md#portrait-framing)).

## 8. Budgets and quality tiers

**Policy:** every tier is live 3D, reduced motion included (§4); the poster is only for WebGL
unsupported/blocklisted or a runtime failure at the lowest tier. Tiers, their settings, the detection
and the runtime step-down monitor: [recipes.md#gpu-tiers-and-adaptive-quality](recipes.md#gpu-tiers-and-adaptive-quality).
Record which tier each test device landed on.

Ship targets not covered by a recipe (starting points; record what you measured):

| Item | Budget |
|---|---|
| Hero GLB (Draco/Meshopt) | ≤ 3 MB |
| Textures (KTX2) | ≤ 6 MB total, **lightmap atlas included** |
| Lightmap atlas | Counted inside the texture budget. Ship UltraHDR JPEG or normalized UASTC KTX2; EXR is for dev only. Sizes and encode: [lightmap recipe](recipes.md#lightmap-and-ao-bake) |
| First meaningful frame | ≤ 3 s on broadband |
| Frame rate | Hold each device's target (desktop and phone targets, and the step-down threshold relative to each, live in the [tiers recipe](recipes.md#gpu-tiers-and-adaptive-quality)); measure on a mid laptop and a mid phone |

Draw calls, triangles and transmission passes: see the [tiers recipe](recipes.md#gpu-tiers-and-adaptive-quality)
and the [refractive recipe](recipes.md#refractive-and-crystal-materials).

Things top-tier sites do that no screenshot shows (igloo is one): continuous performance
measurement on low-end devices, custom exporters to shrink load, background shader
compilation. Do all three.

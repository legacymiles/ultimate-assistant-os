---
name: blender-to-web
description: >-
  Design and build a website whose 3D centerpiece or world is modeled in Blender (Python,
  .blend, compressed GLB) and brought to life with Three.js: a living hero, a scroll-told
  product story, or a world-class immersive scroll journey. Any brand, product, person, venue
  or cause, from a full brief or from nothing (gaps are invented). Starts with three divergent
  mockup directions, waits for a choice, builds, verifies, ends with a gauntlet-loop gate. Use
  WHENEVER the asset or world should be modeled in Blender for a site: "3D hero for my brand,
  modeled in Blender", "model it in Blender and put it on the site", "my sneaker / bottle in 3D
  on the site", "an igloo.inc-level 3D world built in Blender", "blender to web". Tie-breaker:
  "a site as good as igloo.inc" / "an immersive 3D world" with authored assets comes here even
  without the word Blender (Blender is the default modeling route for tier 3). Code-only 3D with
  no Blender asset → interactive-web-studio; photo/video-driven scroll → scroll-craft; teardown
  mechanic only, no Blender asset → exploded-showcase.
---

# Blender to Web — universal

Turn *any* brand, product, person, place or cause into a 3D centerpiece or world that is modeled
in Blender and lives in the browser. Blender owns the asset. The browser owns the live response.

**Not this skill:** photo/video-driven scroll → `scroll-craft`; 2D/CSS motion or code-only 3D →
`interactive-web-studio`. Pairs with `exploded-showcase` (mechanic only), `animation-director`
(rendered film), `gauntlet-loop` (the final gate).

**Never default to one look.** Generalized from [cth9191/blender-to-web](https://github.com/cth9191/blender-to-web);
its examples are banned unless named by the user: LUMA, the robotic iris, the infinity of tiles,
the **APERTURE look (charcoal `#101214` + acid yellow `#f5f400`)**. igloo.inc, lusion.co and
activetheory.net are **quality** references only: take their craft, never their palette, HUD or subject.

## The flow and its gates

| Stage | Output | Then |
|---|---|---|
| 0 Brief | Given/Invented table (incl. tier, mode, chrome); the one batched question, if any (e.g. literal mode with no photos) | CONTINUE (or wait for that one answer) |
| 1 Directions | 3 directions + divergence check + mockups | **STOP** — user picks / mixes / confirms tier; new round → Stage 1 again |
| 1b Mix (only if mixed) | one new mockup of the combined direction + divergence/contrast check | **STOP** — user says yes |
| 1c Tier change (only if the tier changed at a stop) | that tier's mockups regenerated (the chosen direction, or all three if none chosen yet) | **STOP** again |
| 2a Previs (tier 3 only) | full 4–6-scene storyboard + greybox world + camera-path walkthrough + a portrait (9:16) keyframe of the chosen direction | **STOP** — user OKs the journey |
| 2 Blender | asset(s), GLB, fixed-view renders vs mockup | **STOP** — user reviews; changes → iterate, **STOP** again |
| 3 Website | running page in the browser pane | CONTINUE (user may interject) |
| 4 Polish & measure | fixes, measured budgets | CONTINUE automatically into 5 |
| 5 Gauntlet | scored critic rounds, reported each round | pass → deliver · fail after round 5 → report + ask |

## Ambition tiers (a brief slot, never silent)

| Tier | What it is | Scroll model | Default chrome | Mobile default |
|---|---|---|---|---|
| **1. Living hero** | One centerpiece: idle motion, hover/click/drag, HTML page around it | native scroll, canvas pinned, text travels | nav bar + CTA (or per layout grammar) | still fallback on coarse pointer |
| **2. Showcase** | Hero + scroll story + teardown or state changes + post-processing | native scroll, pinned canvas, scroll-scrubbed states | nav bar + CTA | live 3D at reduced quality; still on low tier |
| **3. World-class / immersive** (craft level of igloo.inc, lusion.co, activetheory.net — never their look) | A whole world: baked light, atmosphere, camera journey through sections, transitions, particle morphs, sound, designed loader | virtual scroll **or** tall-spacer native scroll, chosen per project (see below) | per direction: nav, wordmark or HUD — derived from the brand | **live 3D on every GPU tier** (quality scales); poster only for no WebGL / blocklisted GPU / runtime failure; reduced motion = settled frames + cross-fades |

Tier comes from the user: "like igloo.inc", "a world you scroll through", "immersive journey" →
propose 3. "Awwwards-level", "the best possible" → propose 2 or 3 with a one-line reason. Else 2.
It is a **row in the Stage 0 table** (Given/Invented), **confirmed at the Stage 1 stop**. For
tier 3, read [igloo-tier.md](references/igloo-tier.md) before Stage 1 (disciplines derived from
the brand, storyboard); the scroll model and wayfinding are chosen per project by
[igloo-tier.md §4](references/igloo-tier.md#4-scroll-model-and-wayfinding-single-source-for-these-rules).

## Stage 0 — Resolve the brief (never interrogate) → CONTINUE

Read [references/brief.md](references/brief.md). Fill every slot from what the user said:

| Slot | Examples | If missing |
|---|---|---|
| Name | "NOVA", "my coffee roastery" | coin one, say it is invented |
| Genre | any genre — see the [brief.md genre table](references/brief.md#genre--primary-action-and-interactions) (unlisted → derive) | infer from context |
| Story | "noise-cancelling earbuds", "a bistro in Porto" | invent a specific one |
| **Mode** | **literal** (model the real product/thing) or **metaphor** (a sculpture of what it does) | literal if the user names a physical thing they own/sell ("my sneaker"); else metaphor |
| Centerpiece | "petals", "my bottle (photos attached)", "a geometric orb" | derive from mode + idea bank |
| Tier | 1 / 2 / 3 (table above) | propose per the rules above |
| Palette | "black and gold", "any color" | per direction, palette method. **Given → family 8 shared by all three, family rule suspended**; directions diverge by ground value (light/mid/dark), accent ratio, material, lighting; "at least one light" applies only if the palette allows a light ground. **One or two colors given → locked accents**; each direction still picks a different family for ground and neutrals around them |
| Brand assets | logo, typefaces, guidelines | none. Logo (and product photos) passed to the mockup script with `--image`. Metaphor: the logo lives in the chrome, never on the sculpture. Literal: the product keeps its printed branding as decals, exactly as photographed; no added text |
| Mood / genre energy | "brutalist", "warm bistro", "gig-poster" | per direction |
| Headline + voice | "Sleep like it's your job" · dry, warm, manifesto | write one per direction |
| Chrome | nav bar · HUD corners · minimal wordmark · none | from tier + layout grammar |
| Primary action | Buy · Book a table · Listen · Donate · Get tickets · See work | from genre (brief.md) |
| Interactions | pulse, hover, click open/close, drag rotate, reveal, scroll | tier + genre defaults |
| Mobile | live 3D / still fallback | tier default above |
| Delivery | hub app (`src/lib/catalog.ts`, root `CLAUDE.md`) or standalone site | hub app when working inside the owner's hub repo |
| References | photos, URLs, a mockup they like | none |

**Given = locked** (identical across all three directions). **Missing = invented**, specific and
good, with a reason. The mockups are the question; do not stop to ask about gaps. Ask one batched
question only if even the category cannot be guessed; "surprise me" / "anything" means invent the
category too, no question. Show the table with a `Given / Invented` column, then continue.

**Literal mode:** model the actual object from the user's photos/references (no photos and the
shape cannot be guessed → ask for 3+ angles as Stage 0's one batched question; else build from
what is given and flag guessed dimensions). Photos go to the mockup script with `--image`.
Colorway varies across directions only if the user gave no product photos/colors or asked for
variants; otherwise directions vary staging, light and ground only. Teardown/inside heroes →
`exploded-showcase` for the separation/callout **mechanic only**; labels, type and chrome follow
the direction, never its default mono HUD. Interactions become a reveal (open, explode, spin a
detail, change colorway where allowed) rather than an abstract pulse.

Defaults by tier (only when the user said nothing): tier 1–2 = idle light pulse, hover response,
click open/close, drag-rotate with inertia, whole object visible on a large desktop, real HTML
headline + chrome + primary action; tier 3 =
[a designed opening shot out of the loader](references/recipes-world.md#loader-and-opening-shot)
(assembly is one option) whose loader and opening chrome use a
[text reveal + chrome in the direction's voice](references/recipes.md#text-reveal-and-chrome),
scroll-driven journey, hover reactions per scene, chrome per direction (nav, wordmark or HUD),
sound off by default, live 3D on phones.

## Stage 1 — Three divergent directions → STOP

Write three directions — **safe**, **bold**, **unexpected** — following
[brief.md](references/brief.md#making-three-directions-actually-different). Each states: name,
one-line idea, genre energy, palette (hex), materials, centerpiece and its **motion mechanism**
(which parts move, how), layout grammar + chrome, type voice, headline, primary action, why it
fits. Rules:

- **Divergence check before any image:** fill the axes × A/B/C table from brief.md and show it.
  Any pair sharing more than two unlocked axes is rewritten. **Any Given slot** (mood, shapes,
  chrome, layout, lighting, palette, typeface) reads "(locked)" and does not count as shared;
  under three free axes left → diverge on those plus staging/composition, and say so. At least
  one is light/high-key; at most one is "dark ground + single accent" (a given palette overrides).
- **Blender plausibility:** repeated parts, revolves, curve + bevel, arrays, simple booleans,
  clean sculpted forms, soft materials textured not simulated; maps to a route in
  [workflow.md](references/workflow.md). No photoreal humans, no impossible topology.
- **Tier 1–2:** one desktop 16:9 hero frame per direction (optional: a 9:16 frame of the chosen
  direction at the 1b / Stage 2 stop). **Tier 3:** three 16:9 keyframes per direction
  (intro/hero · mid-journey or inside reveal · a content scene) plus a 3–4-row sketch
  storyboard; no portrait keyframe at Stage 1. The full 4–6-scene storyboard and a portrait
  keyframe of the chosen direction come at the Stage 2a stop. Prompts in brief.md.

Make the images:

1. **Preferred:** `node <skill>/scripts/mockups.mjs --out <dir> --prompts <prompts.json>
   [--env <.env.local>] [--image <photo|logo>]...` (Gemini image via OpenRouter,
   `OPENROUTER_API_KEY`; retries once; prints failed directions; format in the script header).
2. Otherwise any image-generation tool in the session.
3. **No tool / no key / a failed direction:** a static HTML mockup (CSS or Three.js
   placeholder), screenshotted in the browser pane, labeled "code mockup, not a render".

Show all three with their notes, the tier and the delivery choice, and **STOP**. The user picks,
mixes ("A's palette with C's centerpiece"), changes the tier, or asks for a new round. **A mix**
gets one new mockup of the combined direction plus a divergence/contrast check (the mix must
still pass contrast and not collapse into a banned look), then **STOP** again for a yes before
Stage 2. **A tier change** → row 1c of the flow table.

## Stage 2 — Build in Blender → STOP

**Tier 3 first — Stage 2a previs → STOP:** expand the sketch into the full 4–6-scene storyboard
([igloo-tier.md §2](references/igloo-tier.md#2-journey-storyboard-required-artifact)),
then greybox world + the camera path, rendered as a short low-res walkthrough against it, plus
a portrait (9:16) keyframe of the chosen direction
([portrait framing](references/recipes-world.md#portrait-framing)). Wait for the user's OK
before detailing assets. Interiors/sets →
[recipes-world.md](references/recipes-world.md#interior-and-set-worlds).

Treat the approved mockup as the visual contract, not proof it can be built. Write the contract
(silhouette, parts + stable names + pivots, material roles, camera, rest pose, motion states,
mobile intent), then:

- Deterministic Blender Python is the source of truth (`blender --background --python` or the
  `blender` MCP's `execute_blender_code`): find nodes **by type**, never hardcode enums (assign in
  `try/except TypeError`), render device OPTIX→CUDA→HIP→METAL→ONEAPI→CPU, screenshot after changes.
- Graybox (silhouette + camera) first, then bevels, normals, materials, lighting. Start the
  hero material from [signature material presets](references/recipes.md#signature-material-presets)
  and the lights from [light rig per mood](references/recipes.md#light-rig-per-mood), tuned to the
  direction. Procedural materials don't export to glTF →
  [bake to textures](references/recipes-world.md#baking-procedural-materials-to-textures).
- Moving parts are separate objects with stable IDs and pivots; repeated parts share one mesh.
  Literal: real proportions, printed branding as decals exactly as photographed, no added text.
- Tier 2–3 **AO/lightmap bake** to a second UV set → [scripts/bake_lightmap.py](scripts/bake_lightmap.py),
  [recipe](references/recipes.md#lightmap-and-ao-bake) (mind the active-UV / active-node gotcha there).
- Camera journeys authored in Blender → [scripts/export_camera_path.py](scripts/export_camera_path.py),
  [recipe](references/recipes.md#camera-path-export-and-scroll-mapping). Compress (Draco/Meshopt,
  KTX2) → [recipe](references/recipes.md#compression-and-loaders).
- Export the GLB, fresh-import it, compare authored vs imported counts, render fixed views
  (rest, open/expanded, side, three-quarter; tier 3: each storyboard scene).

Keep the build script and `.blend` together; record Blender version, device and export settings.
Show previews next to the mockup, fix visible problems, **STOP** for the user's review.

## Stage 3 — Build the website → CONTINUE

Build around the approved asset with Three.js + the GLB, matching the mockup's layout, type,
chrome and light. Always:

- Pointer intent is separated: hover affects a local region, drag rotates after a movement
  threshold, click toggles only if no drag happened. Immutable rest transforms; bounded springs
  with a fixed step and elapsed-time caps; pointer rays in local space.
- Recreate lighting deliberately (color space, tone mapping, environment, baked maps, material
  overrides; runtime side of the [material presets](references/recipes.md#signature-material-presets)
  and [light rig](references/recipes.md#light-rig-per-mood)). Cycles lighting and Blender physics/constraints do **not** transfer through glTF;
  say which behavior is exported and which is written in the browser.
- Text and actions are real accessible HTML. Pause control; suspend when hidden/offscreen;
  handle WebGL context loss; fallback per the tier's mobile default. **Reduced motion:** the live
  renderer keeps running, one settled frame per section change, cross-fades between them; the
  poster/stills are only for no WebGL, a blocklisted GPU or a runtime failure.
- **Scroll per tier:** tier 1–2 native scroll with a pinned canvas; text visibly travels; scroll
  never resets the visitor's rotation. Tier 3 uses the model chosen above.

Tier 3 build order (R = [recipes.md](references/recipes.md), W = [recipes-world.md](references/recipes-world.md)):
designed loader + [fonts (W)](references/recipes-world.md#fonts-and-loading) → `compileAsync` →
[a designed opening shot out of the loader (W)](references/recipes-world.md#loader-and-opening-shot),
[assembly (R)](references/recipes.md#hero-assembly-intro) being one option →
[scroll controller (R)](references/recipes.md#virtual-scroll-controller) on the exported camera path →
scene states + [content scene interaction (W)](references/recipes-world.md#content-scene-interaction) →
[fog](references/recipes.md#fog-with-custom-shaders), [post (R)](references/recipes.md#post-processing-stack) →
[transitions (R)](references/recipes.md#scene-transitions) + [DOM sync (W)](references/recipes-world.md#dom-sync-during-transitions) →
[particle morphs](references/recipes.md#particle-morph-gpgpu) / [text reveal + chrome in the direction's voice (R)](references/recipes.md#text-reveal-and-chrome) →
[cursor/touch states (W)](references/recipes-world.md#cursor-and-touch-states) →
[sound (R)](references/recipes.md#sound-graph), off by default, [sourcing/fallback (W)](references/recipes-world.md#sound-sourcing-and-procedural-fallback) →
[GPU tiers (R)](references/recipes.md#gpu-tiers-and-adaptive-quality) + [portrait framing (W)](references/recipes-world.md#portrait-framing).
Each discipline's look is derived from the brand (igloo-tier.md); numbers live in recipes.md.

Show it in the browser pane. Hub app: add it to `src/lib/catalog.ts`, follow the root `CLAUDE.md`.
Standalone: any static server (`npx serve <dir>`); the infinity reference is technique only.

## Stage 4 — Polish and measure → CONTINUE into Stage 5

Compare screenshots with the approved mockup at matching viewports; refine composition, light,
text flow, motion. Check every implemented state (idle, hover, click, drag, scroll, pause,
fallback, narrow, keyboard; tier 3: every scene, wayfinding, reduced motion). Measure GLB size,
draw calls, triangles, frame time, and record the actual device/GPU. A fast desktop GPU is not
evidence for phones.

## Stage 5 — Gauntlet (runs automatically after Stage 4)

Load **gauntlet-loop** and run its panel on the running site.

- **Bar:** a real top-tier site, **genre-matched, picked per project**, named up front (an
  Awwwards/FWA winner, studio flagship or flagship product page of matching genre and ambition;
  never the bundled infinity reference), optionally plus a style-matched second bar. **Judged
  on craft** (light, motion, depth, type, performance, polish), not on resembling the bar.
- **Five lenses:** art direction · 3D & light · motion & interaction · responsive & robustness
  (mobile, reduced motion, fallback, console, performance) · **brief fidelity & content UX**
  (approved mockup, locked slots, brand; copy, primary action, wayfinding).
- Each round, first run the shared capture (gauntlet-loop templates §1) into `<run>/r<N>/shared`;
  critics read it and still run a targeted capture of their own.
- Each critic shoots its own evidence with `node <gauntlet-loop skill dir>/scripts/critic-shots.mjs
  --url <site> --out <dir>` (here: `C:/Users/honey/.claude/skills/gauntlet-loop/scripts/critic-shots.mjs`),
  flags per lens from the **3D / WebGL** EVIDENCE block in gauntlet-loop's templates §2b, run
  with a 600000 ms Bash timeout or in the background. Shoot the bar once with the same flags.
- **Pass = mean of lenses, rounded to one decimal, ≥ 8.6 AND zero errors (per gauntlet-loop:**
  first-party errors plus third-party errors a critic confirms the build caused). Report the
  lowest lens every round; any lens < 8.0 supplies issue #1. On a fail, the ranked list goes to
  parallel builders on disjoint files (Blender assets / light & post / interaction & scroll /
  layout & chrome / mobile & fallback), then a fresh panel. Round 1 is the first panel; retries
  are rounds 2–5. Report every round's lens scores as it finishes.
- **Still failing after round 5:** stop, report scores, remaining issues and the likely cause
  (asset, hardware, scope), and ask the user whether to continue, cut scope or accept.

Deliver: site, Blender script(s) + `.blend`, GLB, poster, per-round scores, verified/untested report.

## References

- [brief.md](references/brief.md) — slots, modes, idea bank, genre → action, palette method,
  divergence check, mockup prompts, stage prompts. [igloo-tier.md](references/igloo-tier.md) —
  tier-3 disciplines, storyboard, scroll model + wayfinding/a11y, live 3D on mobile.
- [recipes.md](references/recipes.md) — code recipes, the single source for numbers (material
  presets, light rigs, text reveal + chrome). [recipes-world.md](references/recipes-world.md) — bakes,
  sets, content scenes, loader, portrait, fonts, sound, DOM sync, cursor/touch, head/SEO/noscript.
- [workflow.md](references/workflow.md) (motion routes, build sequence) ·
  [infinity.md](references/infinity.md) (runnable reference anatomy, technique only; never edit
  it) · [fibers.md](references/fibers.md) · [prompts.md](references/prompts.md) (historical) ·
  [upstream-SKILL.md](references/upstream-SKILL.md).

Repository publication, hosting and paid generation stay user-directed. Keep dependency licenses
(Three.js MIT and Inter OFL are vendored in the reference).

# Brief, directions and universal prompts

## Filling gaps well

Invent specifics, not placeholders. "A premium product" is a placeholder; "HALO, a
sleep-tracking ring for night-shift nurses" is a brief.

- **"Surprise me" / "anything":** invent the category too (genre, story, name) — no question.
- **Brand assets given (logo, typefaces, guidelines):** locked. A given typeface fixes the Type
  voice axis for all three ("(locked)", not counted as shared); the logo goes to the mockup
  script with `--image` (with any product photos). **Metaphor mode:** no text or logo on the
  sculpture; the logo lives in the chrome. **Literal mode:** the real product keeps its printed
  branding as decals exactly as photographed; no *added* text on it; the logo also sits in the chrome.
- **Name missing:** coin a short, ownable name (4–6 letters, pronounceable, not a real trademark
  you know of). Say it is invented.
- **Product missing but name given:** infer the category from the name or context and say so.
- **Genre:** the site is not always a product launch. Person/portfolio, band/album/event,
  nonprofit/cause, place/venue/restaurant and company/SaaS all change the headline, the primary
  action, the interactions and the mood (table below).
- **Mode:**
  - **Literal** — the user names a physical thing they make or sell ("my sneaker", "our bottle",
    "these headphones", "the chair I designed"). Model the real object from their photos or
    references; flag guessed dimensions; printed branding stays as decals exactly as
    photographed, nothing added. Teardown/inside heroes use `exploded-showcase` for the
    separation/callout **mechanic only**; labels, type and chrome follow the approved direction,
    never its default mono HUD. Directions vary staging, light, ground, layout and reveal — never
    the object's shape. **Colorway** varies only if the user supplied no product photos/colors
    or asked for variants; otherwise staging, light and ground carry the divergence.
  - **Metaphor** — no physical product, or the user asks for a sculpture. Derive a moving
    sculpture from what the brand *does* (idea bank). It is a metaphor, not a product render.
  - Both are allowed in one site (the real product + a metaphor world around it for tier 3).
- **Palette missing or "any color":** pick per direction with the palette method below.
- **Shapes given ("hexagons", "petals", "rings"):** they are the building block. Keep them in all
  three directions and vary how they are assembled.
- **Headline + voice:** one headline per direction, in a named voice (dry, warm, manifesto,
  deadpan, lyrical, technical). Real copy, not "Welcome to X".

## Genre → primary action and interactions

| Genre | Primary action | Interactions that fit (instead of drag-to-rotate by default) |
|---|---|---|
| Physical product (literal) | Buy / Pre-order / Find a store | spin to inspect, explode into parts, swap between real colorways, open the lid/case |
| Tech / SaaS / AI | Start free / Request access | object responds to cursor like a sensor, splits into layers on scroll |
| Person / artist / portfolio | See work / Get in touch | each project is a facet or room; hover reveals a piece; click enters it |
| Band / album / event | Listen / Get tickets | reacts to audio (off by default, one click on), stage lights on hover, tracklist as scenes |
| Nonprofit / cause | Donate / Join | a reveal that shows impact (something restores, grows, lights up) as you scroll |
| Place / venue / restaurant | Book a table / Plan a visit | a miniature of the place or signature dish that opens, day→night light on scroll |
| Finance / security | Open an account | shells lock and unlock, calm precise motion, no playful physics |
| Fashion / apparel | Shop the drop / Book a fitting | garment or accessory on a turntable, fabric catches light on hover, look-by-look scenes |
| Game / app launch | Wishlist / Download | the game world or app icon as a playable-feeling miniature, a teaser mechanic on click |
| Publication / editorial | Read / Subscribe | issue cover that opens into scenes, stories as objects on a shelf, pages that fold |
| Wedding / private event | RSVP | the venue or a keepsake object, day → night on scroll, schedule as scenes |
| Education / course | Enroll / Start lesson 1 | a model that assembles one idea per module, progress lights up as you scroll |
| Healthcare / clinic | Book an appointment | calm, precise anatomy-free metaphor (breath, repair), no gore, reassuring pace |

**Unlisted genre:** derive the action from what the visitor must do next, then pick interactions
that rehearse it.

## Idea bank (starting points, not a menu)

| What it is / does | Centerpieces that can move |
|---|---|
| Sees, focuses, captures (optics, cameras, AI vision) | Lens stack that telescopes · prism array that splits light · faceted eye of plates |
| Protects, secures (security, insurance, banking) | Nested shells that lock · interlocking rings · vault petals that seal |
| Connects, networks (social, telecom, dev tools) | Lattice of nodes on struts · braided strands · chain of linked modules |
| Grows, nurtures (health, finance, education) | Kinetic flower · unfurling fern of plates · branching coral of segments |
| Moves, powers (mobility, energy, fitness) | Turbine of vanes · spring coil · segmented wheel that expands |
| Listens, sounds (audio, music, voice) | Concentric ribs that ripple · speaker cone of rings · waveform of slats |
| Calms, cleans (wellness, skincare, sleep) | Breathing sphere of scales · pebble stack · folding paper-like planes |
| Computes, thinks (AI, data, SaaS) | Cube that splits into layers · Möbius band of segments · orb of hex cells |
| Makes, builds (tools, hardware, creative apps) | Exploded gearbox · origami that unfolds · modular blocks that re-stack |
| Tastes, hosts (food, drink, hospitality) | Stacked discs like a sliced fruit · pouring ribbon of plates · blooming vessel |
| Person / artist / portfolio | A cabinet of their objects that rotates · a bust built from their materials · a room per project |
| Band / album / event | The album motif as a stage set · a speaker stack that breathes · a poster that folds into 3D |
| Nonprofit / cause | A thing that is repaired as you scroll (reef, forest, bridge) · hands of many parts forming one shape |
| Place / venue / restaurant | A tilt-shift miniature of the building · the signature dish exploded into ingredients · a door that opens inside |
| Physical product (literal) | The product itself: hero turntable, exploded layers, cutaway, lineup of its real colorways |
| Fashion / apparel | A garment of folded plates on a form · a knit of repeated loops · a shoe that unlaces |
| Game / app launch | The game's key object or world as a diorama · app screens as stacked glass panes that fan out |
| Publication / editorial | A stack of pages that fans open · a masthead letterform built from parts |
| Wedding / private event | A table setting that assembles · a paper-cut venue miniature · two rings of many segments |
| Education / course | A puzzle that solves itself module by module · a tree of glowing nodes |
| Healthcare / clinic | Soft capsule of shells that opens · a calm breathing form · a bridge of parts mending |

A good centerpiece: one readable silhouette at thumbnail size, 20–2,000 repeated parts or 3–30
large rigid parts (or one real product), an obvious rest pose and an obvious "opened"/revealed pose.

## Palette method

**Palette given (brand colors, "black and gold"):** family 8 is shared by all three directions
and the one-family-per-direction rule is suspended. Divergence comes from **ground value**
(light / mid / dark), **accent ratio** (which given color leads, how much of the rest shows),
**material** and **lighting**. "At least one light" yields to the locked palette unless the
palette allows a light ground; "at most one dark + single accent" still applies where the
palette permits alternatives. In the divergence table, the palette row reads "8 (locked)" for
all three and does not count as a shared axis; add a "Ground value / accent ratio" row instead.

**One or two colors given (e.g. "our orange"):** they are **locked accents**, identical in all
three. Each direction still picks a different family (below) for its ground and neutrals around
them; the palette row names the family plus "+ locked accent", and counts as an axis as usual.

**Palette not given:** for each direction pick one palette **family** and never repeat a family
across the three:

1. Dark neutral + one electric accent (e.g. graphite + acid green, ink + signal orange)
2. Light / paper neutral + deep ink + one warm accent
3. Tonal monochrome of one hue (all blues, all terracottas)
4. Metallic-led (brushed titanium, copper, gold) on a neutral ground
5. Saturated duotone (two strong hues fighting)
6. Soft pastel / chalk with a dark type color
7. High-key daylight (white/sky/sand ground, color in the object, soft shadows)
8. Brand-given colors (locked when the user supplies them; vary the ratios, ground and materials)

**At least one direction is light / high-key. At most one is "dark ground + single accent"**
(unless a given palette rules it out, above).
Banned unless asked: charcoal `#101214` + acid yellow `#f5f400` (the bundled APERTURE look).

Give hexes: background, surface, text, accent, centerpiece base, emissive/pulse color. Check text
contrast (4.5:1 body, 3:1 large). The pulse color must read against the centerpiece material.

## Making three directions actually different

Axes:

- **Palette family** (above)
- **Material language:** machined metal · glass/translucent · ceramic/matte · soft-touch rubber ·
  iridescent · wood/stone · emissive/neon · fabric/felt · paper/card · clay/plaster · wax/soap ·
  food-real (glaze, crumb, juice) — soft and organic materials are fine when textured, not simulated
- **Centerpiece interpretation:** different metaphor or assembly (blades vs petals vs rings); in
  literal mode: staging (turntable, exploded, cutaway, in-use scene, lineup,
  literal-in-metaphor-world — the real product inside a metaphor set)
- **Layout grammar + chrome:** centered monument + nav · asymmetric split + nav · object bleeding
  off-canvas + minimal wordmark · editorial grid with object as a column · full-bleed stage with
  HUD corners · poster composition with no nav
- **Type voice:** geometric sans · grotesk · high-contrast serif · monospace technical · condensed
  display · rounded/friendly · handwritten accent
- **Lighting:** hard rim · soft studio · single spotlight in darkness · daylight/high-key ·
  golden hour · colored gels / club light
- **Genre energy / mood:** premium launch · warm bistro · gig-poster · museum-quiet · lab-clinical ·
  toy-playful · editorial magazine · brutalist

One direction is the **safe** read, one **bold**, one **unexpected**. Hold every user-locked slot
constant. Any pair may share **at most two unlocked axes**. **Any Given slot** (mood, shapes,
chrome, layout, lighting, palette, typeface) reads "(locked)" in its row for all three and does
not count as shared. If fewer than three free axes remain, the directions diverge on the
remaining free axes plus staging/composition (camera, framing, ground, scale) — say so under the
table. Fill and show this check before generating images; rewrite a direction if a pair fails:

| Axis | A (safe) | B (bold) | C (unexpected) |
|---|---|---|---|
| Palette family | | | |
| Material language | | | |
| Centerpiece / staging | | | |
| Layout + chrome | | | |
| Type voice | | | |
| Lighting | | | |
| Genre energy | | | |
| Ground value / accent ratio (if palette locked) | | | |
| High-key? / dark+accent? (constraint, not an axis) | | | |
| Shared axes (locked rows excluded) | A–B: n | B–C: n | A–C: n |

## Mockup image prompt — tier 1–2 (one hero frame per direction)

```
Website hero mockup, large desktop screen, 16:9, flat screenshot of a web page (not a photo of a
monitor). <GENRE> site for "<NAME>" — <one-line story>.
Centerpiece: <literal product | sculpture: number and shape of parts, current pose>, the ENTIRE
object visible with breathing room, <position in layout>.
Art direction "<DIRECTION NAME>", <genre energy / mood>: <palette with hexes>, <material
language>, <lighting>.
Page chrome: <one of: "top navigation with wordmark "<NAME>" and 3–4 links" | "small HUD labels
in the four corners, no navigation bar, no buttons" | "minimal wordmark only" | "no navigation,
poster composition">. Headline "<headline>" in a <voice> voice; one line of supporting copy;
<primary action as a button | as a small text link | none>. <type voice> typography.
<layout grammar>.
The centerpiece must look buildable in Blender: <for hard surface: clean parts, bevels | for soft
or organic: clean sculpted forms, textured fabric/clay/food surfaces, no melted shapes>.
<Metaphor: "No text or logo on the object; the logo appears only in the page chrome." |
Literal with photos: "Match the product in the attached photos exactly, including its printed
branding as it appears; add no other text to it. Change only staging, light and ground<, and
colorway if variants were requested>.">
```

## Mockup image prompts — tier 3 (three keyframes per direction)

Same header, palette, materials and chrome line as above, then one prompt per keyframe
(name them `a-1-intro`, `a-2-journey`, `a-3-content`, …):

```
Keyframe <1|2|3> of an immersive 3D scroll-journey website for "<NAME>", 16:9 flat web
screenshot. <1: intro/hero — the world or centerpiece assembled, headline "<headline>", chrome
per direction | 2: mid-journey — camera inside/through <the world or the opened centerpiece>,
<light event derived from the brand: daylight shaft, colour shift, practicals switching on,
strobe or inner glow — bloom only if emissive>, <particle event or none>, a small progress indicator | 3: a content scene — each brand item
(<projects / products / specs / tickets / menu dishes>) is a 3D OBJECT standing in the world
(<plinths / shelf / crates / plates …>), lit by the scene, with at most a short HTML label next
to it; NOT HUD panels, NOT flat HTML cards; primary action "<action>">.
World: <terrain / room / void / miniature>, atmosphere <fog color, particles or none, bloom
only if emissive>, <lighting; high-key allowed>. Same world and palette as the other keyframes.
Buildable in Blender with baked light: <materials>, no impossible topology. <Metaphor: no text
or logo on objects. | Literal: the product's printed branding exactly as photographed, no added
text.>
```

**Stage 1 deliverable, tier 3 (per direction):** three 16:9 keyframes (intro/hero,
mid-journey or inside reveal, content scene) shown as a strip, with a 3–4-row sketch storyboard
(columns from [igloo-tier.md §2](igloo-tier.md#2-journey-storyboard-required-artifact)) under
it. **No portrait keyframe at Stage 1.** Keyframe 3's content scene follows
[recipes-world.md](recipes-world.md#content-scene-interaction).

**Stage 2a previs stop (chosen direction only):** the full 4–6-scene storyboard, the greybox
walkthrough, and one **portrait (9:16) keyframe** — the intro/hero recomposed for a phone per
[recipes-world.md](recipes-world.md#portrait-framing) (run the script with `--aspect 9:16`).

**Tier 1–2 (optional):** a 9:16 frame of the chosen direction at the 1b / Stage 2 stop.

**Tier changed at a stop:** regenerate that tier's mockups (the chosen direction, or all three
if none is chosen) and STOP again.

**If the user mixes directions:** make one new mockup (tier 3: its keyframes) of the combined
direction, rerun the divergence/contrast check on it, and STOP again for a yes before Stage 2.

Text in generated images can garble; the real page uses real HTML. Say so when showing mockups.

## Copy-paste stage prompts — tier 1–2

Anything left in `[brackets]` or deleted is invented by the agent.

### 1. Design the look

```
Use the blender-to-web skill to create a [tier 1 living hero | tier 2 showcase] for [name, or
"invent one"] — [what it is / who it's for, or "invent it"]. The centerpiece is [my product
(photos attached) | a sculpture / shape / building block | "design one around what it does"].
Give me three genuinely different directions [palette hints or "any colors"], at least one of
them light unless my palette rules that out. Show the headline, chrome and primary action, with the entire centerpiece visible on
a large desktop screen. Plan for [interactions, or "whatever fits the genre"]. Mobile: [still
fallback | live 3D]. Deliver as [a hub app | a standalone site]. Show the mockups and wait for my
choice before modeling.
```

### 2. Build and inspect in Blender

```
Use direction [A/B/C, or the mix I described]. Build it in Blender with reproducible Python,
graybox and camera check first. Keep the editable .blend and the builder script. Moving parts are
separate objects with stable names and pivots. [Tier 2: bake AO/lightmaps to a second UV set.]
Export a compressed GLB and verify it by importing it into a fresh scene. Show renders of the rest
and open poses plus a side view next to the mockup, fix visible problems, and let me review.
```

### 3. Build the interactive website

```
Build the site around the approved asset with Three.js and the GLB. Match the mockup's layout,
chrome, typography and lighting. Implement [the planned interactions]. Native scroll with a
pinned canvas; text travels; scroll never resets rotation. Clicks and drags are distinct. Text
and actions are accessible HTML. Pause control, offscreen suspension, context-loss handling, and
[still fallback | live 3D] on mobile. Show it in the browser pane.
```

### 4. Polish, test, gauntlet

```
Compare browser screenshots against the approved mockup at matching viewports and refine
composition, light, text flow and motion. Check every state, narrow layouts, reduced motion and
keyboard access. Measure payload, draw calls and frame time on the actual device. Then run the
gauntlet automatically per the skill's Stage 5 rules against [a genre-matched top-tier site]
judged on craft. Deliver the site, Blender source, GLB, poster and a short
verified/not-verified report.
```

## Copy-paste stage prompts — tier 3 (world-class / immersive)

### 1. World + journey directions

```
Use the blender-to-web skill at tier 3 (world-class, the craft level of igloo.inc / lusion.co —
not their look) for [name or "invent one"] — [story]. [Literal: my product, photos attached |
Metaphor: a world built around what it does]. Give me three directions that differ in world,
palette (at least one light, unless my palette rules it out), materials, chrome (nav, wordmark
or HUD, derived from the brand) and genre energy. For each: three keyframes (intro,
mid-journey, content scene) and a 3–4-row sketch storyboard (igloo-tier.md §2). Say which
scroll model it uses and why (igloo-tier.md §4). Wait for my choice.
```

### 2. Previs, then the world build

```
Use direction [X]. First a previs: the full 4–6-scene storyboard, then a greybox world plus the
full camera path, rendered as a short low-res walkthrough against it, plus a portrait (9:16)
keyframe of the direction. Stop for my OK.
Then build the world in Blender with reproducible Python: final assets, procedural materials
baked to textures (recipes-world.md), AO/lightmap bakes with scripts/bake_lightmap.py, the camera
path exported with scripts/export_camera_path.py, Draco/Meshopt + KTX2. Fresh-import the GLBs and
render every storyboard scene next to its keyframe. Stop for my review.
```

### 3. Runtime

```
Build the site: designed loader + fonts → compileAsync → a designed opening shot out of the
loader (assembly is one option) → the chosen scroll model mapped to the exported camera path →
scene states + content-scene interaction → fog and post stack → transitions with DOM sync →
particle morphs / text reveal + chrome in the direction's voice → cursor/touch states → sound
(off by default, procedural fallback) → GPU tiers with live 3D on phones + portrait framing.
Follow recipes.md and recipes-world.md for each; wayfinding per igloo-tier.md §4. Show it in the
browser pane.
```

### 4. Verify + gauntlet

```
Capture every scene with wheel-driven shots (flags per the skill's Stage 5) and compare each
against its keyframe. Measure payload, draw calls and frame time per GPU tier. Then run the
gauntlet automatically per the skill's Stage 5 rules against [a genre-matched top-tier site]
judged on craft; report every round; after round 5, report and ask.
```

### One-liner

```
Use blender-to-web for [brand or "anything"] — surprise me with three directions.
```

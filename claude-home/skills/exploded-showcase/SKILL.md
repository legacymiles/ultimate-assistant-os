---
name: exploded-showcase
description: >-
  Build cinematic, interactive 3D product showcases with an "exploded teardown"
  hero — a single object on a slowly orbiting stage that separates into
  individually labeled, inspectable parts, with technical leader-line callouts,
  corner-anchored monospace HUD chrome, atmospheric lighting/fog/bloom, and a
  scroll-driven transition from the calm showcase into an immersive first-person
  mode. Inspired by igloo.inc. Use this WHENEVER the user wants to present a
  product, device, vehicle, machine, gadget, or any hero 3D object interactively
  — especially requests mentioning "exploded view", "teardown", "showcase",
  "rotate/orbit around it", "inspect the parts", "labeled parts", "hover to
  expand", "spec sheet", "annotations", "callouts", "like igloo.inc", or a hero
  object the user can pull apart, explore, and then dive into. Trigger even when
  the user only describes the behavior (parts spreading out, labels appearing,
  camera circling a product, scrolling into a first-person experience) without
  naming the technique. This skill is a specialist companion to
  interactive-web-studio — use both together for this kind of build.
---

# Exploded Showcase

A recipe for the single most memorable move in interactive product sites:
take one hero 3D object, let the visitor **orbit it**, **pull it apart into
labeled parts they can inspect**, and then **scroll straight into it** — the
calm "spec sheet" giving way to an immersive first-person payoff.

This is the [igloo.inc](https://www.igloo.inc) mechanic, generalized. It works
for a watch, an engine, a sneaker, a satellite, a race kart, a graphics card —
anything with parts worth showing off.

> **This skill is a specialist. Load `interactive-web-studio` alongside it** for
> the broader craft (cursor, smooth scroll, typography, motion language,
> guardrails). This skill only covers the exploded-showcase *mechanic* in depth.

## The reference: what igloo.inc actually does

Study `assets/igloo-reference.jpeg` (a captured hero frame) before building.
The language, distilled:

- **One glowing hero object** lit from *within*, sitting in an atmospheric,
  hazy, monochrome environment (fog, soft ground, a faint film grain). The
  object is the whole page — not a card on a page.
- **Technical leader-line annotations** float over the object: a tiny `+` or dot
  node sits on a point of interest, a thin 1px line runs out to a small
  **monospace label**. On igloo.inc these are decorative measurements; we make
  them *mean something* (part name + one-line spec).
- **Corner-anchored HUD chrome**, never a normal nav bar: wordmark top-left,
  a `// small print` line under it, a right-aligned manifesto top-right,
  `Scroll down to discover.` + a sound toggle bottom-left. All uppercase,
  monospace, industrial, low-opacity.
- **Cold, desaturated palette** and a **slow, weighty camera**. Scroll is a
  *journey*, not pagination.

## The signature mechanic (build this, in order)

Think of it as four systems that layer. Each has a dedicated reference file with
copy-paste-ready code — **read the file before writing that system** rather than
reconstructing from memory.

1. **The stage & orbit** — a hero object on a reflective floor in volumetric
   fog, key/rim lighting, bloom, and a camera that slowly auto-orbits and
   subtly parallaxes toward the pointer. → `references/stage-and-orbit.md`
2. **The exploded view** — every part has a *home* transform and an *exploded*
   transform (displaced along an assembly vector). Grouping parts into
   **regions** (front, cockpit, powertrain, wheels, aero…) lets a hover on one
   region explode just that cluster, spring-animated with weight. Click a part
   to **isolate** it (dim the rest, push the camera in).
   → `references/exploded-view.md`
3. **The annotations** — leader-line callouts that track their 3D anchor into
   screen space every frame, revealing name + spec with a snappy stagger. Plus
   the corner HUD. → `references/annotations.md`
4. **The scroll-to-immersion transition** — ScrollTrigger + Lenis reassemble the
   object, then fly the camera *into* it for a first-person mode (speed lines,
   motion blur, a live HUD). Scroll back up reverses it cleanly.
   → `references/scroll-transition.md`

Art-direction defaults (palette, lighting, type, degradation) live in
`references/art-direction.md`. Read it during the direction phase.

## Worked example: a racing-kart teardown ("APEX/01")

A concrete instantiation of all four systems, to make the abstract template
land. The object is a procedurally-modelled go-kart; the same shape works for any
machine by swapping the part registry.

- **Stage & orbit** — the kart floats on a reflective charcoal floor in cold
  fog; a warm key + cyan rim light it; the camera auto-orbits and leans toward
  the pointer. Idle life: the engine's combustion strip pulses ("revs") and the
  whole kart breathes.
- **Exploded view** — five regions (`front`, `cockpit`, `powertrain`, `wheels`,
  `aero`) each map to 2–4 parts (nose, seat, engine, four slicks, rear wing…).
  Hovering a region damps that cluster out along assembly vectors off a static
  chassis frame; clicking a part isolates it (rest dims, camera pushes in). A
  huge display region number (`04 / WHEELS`) reads on the left as you hover.
- **Annotations** — each exploded part draws a cyan `+`-node leader line to a
  callout: `FRONT SLICK — 10" magnesium rim · soft compound`, revealed with a
  stagger. Corner HUD: `APEX/01` wordmark, a `// small print` line, a manifesto,
  a `Scroll down to drive` hint, and a sound toggle.
- **Scroll → immersion** — scrolling reassembles the kart and dives the camera
  into the driver's seat; the world warms from cold studio to a neon dusk
  tunnel (magenta/cyan arches, centre-line dashes, speed streaks) with a live
  `KM/H` + `GEAR` readout. Scrolling back up rebuilds the kart. An engine-audio
  bed (off by default) rises in pitch with speed.

The lesson to carry over: **one part registry drives everything**, the two
temperatures (cold stage / hot accent) keep it from turning to mush, and the
scroll is a genuine gear-change — the calm teardown physically *becomes* the
rush.

## The invention step (do not skip)

The mechanic above is a *template*, not the idea. Before coding, decide the one
thing that makes **this** showcase unforgettable — the surprise beyond "parts
spread out." Pick at least one:

- The object **reacts when idle** (an engine revs, a watch ticks, a drone's
  props twitch) so nothing important sits fully dead.
- The **regions tell a story** in a deliberate order as you orbit, not just five
  equivalent clusters.
- The **transition is a genuine gear-change** — the exploded calm literally
  *becomes* the immersive rush (parts slam home → you're inside it).
- A **living stage**: the rim light tracks the pointer, the floor reflects
  everything, dust drifts through the key light.

Write a 6–10 line brief (object, the 5 regions + their parts, the one surprise,
the palette, what the scroll-down payoff is) and confirm it before building.

## Architecture

Compose small, configurable parts — never one giant file. A typical tree:

```
components/three/
  Stage.tsx          // canvas, lights, fog, floor, post-processing
  CameraRig.tsx      // auto-orbit + pointer parallax + scroll-driven fly-in
  ExplodedModel.tsx  // the object; owns parts, regions, explode/isolate state
  Part.tsx           // one mesh: home vs exploded transform, hover/select
  Annotation.tsx     // one leader-line callout (3D anchor -> screen label)
  ImmersiveMode.tsx  // first-person scene revealed on scroll
components/hud/
  CornerHUD.tsx      // wordmark, small print, manifesto, scroll hint, sound
  SpeedHUD.tsx       // speed/gear readout for immersive mode
lib/
  parts.ts           // the part registry: id, region, home, explodeDir, label
  useExplodeState.ts // hovered region, isolated part, reduced-motion
shaders/             // any custom GLSL (speed lines, fresnel rim, etc.)
```

The **part registry** (`lib/parts.ts`) is the heart. Everything else reads from
it. Data-drive it so the same components work for any object — swap the registry,
get a new showcase. See `references/exploded-view.md` for its exact shape.

## Non-negotiable guardrails

- **60fps.** Instance repeated meshes (4 identical wheels = one instanced mesh
  where sensible), cap `dpr={[1, 2]}`, keep post-processing lean (bloom +
  tone-mapping is usually enough), and animate transforms — not geometry
  rebuilds — every frame.
- **`prefers-reduced-motion`.** Kill the auto-orbit, the idle animation, and the
  scroll-driven camera fly-in; make hover *instantly* show the exploded state
  and labels with no travel. The content and every label must be fully readable
  with motion off.
- **Graceful degradation.** No WebGL / low-end device → serve a static hero
  image of the object with the same corner HUD and a plain anchored list of the
  parts + specs. Never a blank canvas.
- **Typography leads.** The labels and HUD are the product here. If the type is
  weak, a beautiful explode reads as a tech demo. Confident condensed/industrial
  sans for display, monospace for specs and HUD.
- **SSR safety (Next.js).** `dynamic(() => import(...), { ssr: false })` for the
  canvas; guard `window`/`document`; drive DOM-measuring animation in
  `useGSAP`/`useLayoutEffect` with `gsap.context()` cleanup.

## Quality bar

Before calling it done: Does hovering a region feel like the machine *opening
itself* to you (weight, overshoot, settle) rather than parts teleporting? Do the
labels read instantly and track their part smoothly as the camera moves? Is the
scroll-down a real payoff — does the calm actually *become* the rush? Does it
hold 60fps, degrade to something tasteful without WebGL, and stay fully readable
with reduced motion on? If any answer is no, it isn't finished.

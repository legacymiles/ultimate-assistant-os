# Art Direction

The exploded-showcase look is **cold technical studio** with the object as the
only source of warmth and light. igloo.inc is fully monochrome-cold; for a
product with energy (a vehicle, a gaming rig) inject one **hot accent** for
heat/speed. Keep it to two temperatures — cold stage, hot object accent — or it
turns to mush.

## Palette

```css
:root {
  /* Stage — near-black, cold, low chroma */
  --stage-0:   #07090c;   /* deepest background / fog */
  --stage-1:   #0a0c10;   /* canvas bg */
  --stage-2:   #12161c;   /* panels, floor tint */

  /* Cold light — rim, glow, UI accents */
  --cold-1:    #5ec8ff;   /* electric cyan rim */
  --cold-2:    #cfe8ff;   /* label node / cold highlight */

  /* Hot accent — ONLY for energy objects (engine glow, speed, CTAs). Omit for pure-cold. */
  --heat-1:    #ff5a1f;   /* racing orange */
  --heat-2:    #ffd28a;   /* warm key highlight */

  /* Type */
  --ink-1:     #ffffff;   /* display */
  --ink-2:     #9fb4c7;   /* specs, secondary */
  --ink-3:     #5f7183;   /* fine print */
}
```

Immersive/ride mode may shift the world toward a **neon dusk** (magenta + cyan
track lighting) so the two modes feel like different places — but carry the same
type and HUD so it still reads as one product.

## Lighting recipe

- **Key**: one warm spot, high and to one side, casting real shadow. This is the
  hero light — it defines the object's form.
- **Rim**: one cold spot from behind/opposite, low intensity, to separate the
  silhouette from the fog.
- **Fill**: very low ambient (0.1–0.2) + an HDRI environment at ~0.3 so metals
  have something to reflect. Never flat-light it.
- **Fog** tuned to just kiss the object's far edge; **bloom** on the bright
  emissive bits (glow-from-within, engine, headlights); **ACES tone-mapping**
  for filmic rolloff; **vignette** to pull focus center.

Emissive-from-within is the igloo signature: give the object (or its core) a
low emissive that bloom picks up, so it looks lit from inside the fog.

## Typography

Type leads — the labels and HUD *are* the design.

- **Display**: a confident condensed/industrial or tight geometric sans
  (Geist, Space Grotesk, Archivo, or an eyebrow-condensed like Oswald for a
  racing feel). Uppercase, tight tracking for wordmark/headlines.
- **Spec / HUD / callouts**: a monospace (Geist Mono, JetBrains Mono, Space
  Mono). Monospace is what sells the "technical readout" language.
- Big size contrast: huge display numerals (speed, section numbers) against tiny
  uppercase mono labels. That contrast is most of the aesthetic.

## Motion language

- **Weighty, confident.** Parts ease out with a *hair* of overshoot then settle;
  camera moves are slow and smooth. Never linear, never bouncy-toy.
- **Snappy reveals.** Callout labels and split-text headlines come in fast
  (250–350ms) with a small stagger — crisp, not floaty.
- Easing defaults: `cubic-bezier(.2,.8,.2,1)` for UI reveals; per-frame `damp`
  (lambda ~6) for the 3D explode; `easeInOutCubic` for the scroll camera dive.

## Sound (optional, high-impact)

igloo.inc ships a sound toggle for a reason. A low studio hum on the showcase, a
mechanical *chunk* when a region explodes, and an engine/wind bed that rises with
speed in ride mode massively deepen immersion. **Default off, one obvious toggle,
never autoplay** (browsers block it and it's rude).

## Degradation & reduced motion (design, not just code)

- **No WebGL / low-end**: a beautifully-lit static render of the object with the
  same corner HUD and an anchored, readable parts+specs list. Still on-brand.
- **Reduced motion**: no orbit, no camera dive, no speed ramp. Hover (or focus)
  instantly shows the exploded state and all labels. Two static, legible
  sections instead of one animated journey. It should still look intentional and
  premium — a calmer version of the same art direction, not a broken one.

# Art Direction Toolkit

Read this during the direction phase — before code. The goal is a coherent point of view, not a pile of effects. Decide the world first, then pick the minimum set of systems that express it.

## Table of contents
1. Choosing a direction
2. Motion & easing system
3. Lighting & atmosphere system
4. Color & type worlds
5. Per-archetype recipes

---

## 1. Choosing a direction

Answer these, then write the 4–8 line brief the SKILL.md workflow asks for:

- **One feeling.** If the site evokes a single emotion (awe, calm, urgency, luxury, playfulness, trust), which one? Everything serves it.
- **One memory.** What's the single thing a visitor should recall tomorrow — the hero moment, a transition, a phrase, a color?
- **Reference, then depart.** Name 1–2 sites/films/objects whose *vibe* you're channeling, then choose one way to make it your own. Don't clone.
- **Intensity dial.** Restrained ↔ maximalist. Map it to the brand: enterprise/luxury/medical sit low; creative studio/music/gaming sit high. Intensity governs particle counts, motion amplitude, contrast, and how loud the hero is.
- **The signature.** Commit to ONE hero device executed flawlessly (a shader hero, a scroll flythrough, a liquid cursor, a kinetic type wall). Supporting effects stay quiet so it lands.

Coherence test before building: do the color world, motion personality, and lighting all point at the same feeling? If the palette says "calm spa" and the motion says "glitchy rave," fix it now.

---

## 2. Motion & easing system

Motion personality is mostly carried by **easing + duration**, not by what moves. Pick one personality and reuse its tokens everywhere.

```ts
// lib/motion.ts — easing tokens (GSAP strings + cubic-beziers for CSS/Motion)
export const ease = {
  // Confident / editorial — fast out, gentle settle. Safe default.
  out:      "power3.out",          // cubic-bezier(0.16, 1, 0.3, 1)
  // Weighty / luxury — slow, expensive deceleration.
  expo:     "expo.out",            // cubic-bezier(0.16, 1, 0.3, 1) (steeper)
  // Snappy / techy — quick, decisive.
  power4:   "power4.out",
  // Playful / springy — overshoot and settle. Use sparingly, on small elements.
  elastic:  "elastic.out(1, 0.45)",
  back:     "back.out(1.7)",       // cubic-bezier(0.34, 1.56, 0.64, 1)
  // Continuous scroll-linked motion — must be linear.
  none:     "none",
};

export const dur = { fast: 0.4, base: 0.7, slow: 1.1, hero: 1.6 }; // seconds
```

Framer Motion spring personalities:

```ts
export const spring = {
  soft:   { type: "spring", stiffness: 120, damping: 20, mass: 1 },     // smooth UI
  snappy: { type: "spring", stiffness: 400, damping: 30 },              // buttons, toggles
  bouncy: { type: "spring", stiffness: 300, damping: 12 },              // playful accents
};
```

Rules of thumb:
- **Stagger** related items 0.04–0.08s for a hand-dealt cascade; never reveal a grid all at once.
- **Scroll-linked = `ease: "none"` / linear.** Easing belongs on triggered (enter) animations, not on scrubbed ones.
- **Enter from one direction** consistently (e.g. up + fade) so the page has a grammar.
- **Anticipation & overshoot** sell weight: a slight scale-down before a pop, a small overshoot before settling.
- **Durations scale with size:** big hero elements move slower (1.2–1.6s); micro-interactions are quick (0.2–0.4s).

---

## 3. Lighting & atmosphere system

Lighting is mood. Choose one approach and commit; mismatched lighting is what makes a 3D site read as a demo.

- **Flat / graphic** — no 3D lighting model; bold fields of color, hard or no shadows, posterized depth. Great for editorial, fashion, brutalist, type-led sites. Cheapest and often the most stylish.
- **Volumetric / glow** — dark scene + emissive materials + Unreal Bloom; light feels like it has substance. The default "premium tech" look (AI, crypto, dev tools). Keep `luminanceThreshold` high enough that only highlights bloom, or it turns to mush.
- **HDRI / image-based** — drei `<Environment>` for physically plausible reflections on metal/glass. Essential for product/automotive/luxury where material realism sells the object. Pair low `roughness` + high `metalness`.
- **Rim / fresnel** — bright edge light separating an object from a dark background; instant drama and depth. A fresnel term in the shader, or a back light.

Atmosphere layers that add depth cheaply: subtle film grain/noise overlay, vignette, drifting dust/particles, fog (`<fog>` / `<fogExp2>`), and a faint chromatic aberration in post. A little goes far — atmosphere should be felt, not noticed.

---

## 4. Color & type worlds

**Color.** Build a small, intentional system, not a rainbow.
- Pick a **dominant** (usually the background — most premium sites lean very dark `#05060A`-ish or very light/off-white `#F6F4EF`), a **secondary** surface, and ONE **accent** that owns all energy (CTAs, highlights, emissive glow, focus rings). One accent used consistently reads as confidence; three accents read as a template.
- For glow/WebGL looks, choose accents that survive bloom (saturated violets, electric blues, acid greens, warm ambers).
- Add depth with gradients between two hues of the same family, not by adding new colors. Keep contrast ≥ AA for text.

**Type.** Typography carries more "premium" signal than any effect.
- A confident pairing: one expressive **display** face (large, tight tracking, often a variable or grotesk/serif with character) + one clean **body/UI** face. Don't exceed two families.
- Go **big** on the hero headline (clamp-scaled, e.g. `clamp(2.5rem, 8vw, 9rem)`), tight line-height (1.0–1.1), tight letter-spacing on caps.
- Load with `next/font` (no FOUT). Reserve weight contrast (e.g. 300 vs 800) for hierarchy instead of many sizes.
- Kinetic type (split reveals, marquees, mask wipes) is a high-ROI signature when the brand is type-forward.

---

## 5. Per-archetype recipes

Starting points, not straitjackets. Each line: **palette · motion · lighting · hero signature.** Adapt to the actual brand.

- **Creative studio / agency** — off-white or deep-black world, one loud accent · confident snappy reveals, kinetic type, magnetic everything · flat or subtle volumetric · hero: oversized kinetic headline + custom cursor + a single shader/WebGL accent. Maximalist permitted.

- **Portfolio (designer/dev)** — restrained mono palette + 1 accent · smooth weighty scroll, project images that scale/reveal on scroll · flat, image-led · hero: name in huge type with a split reveal; works as a horizontal or pinned scroll gallery with parallax thumbnails.

- **SaaS / B2B product** — clean light or dark, trustworthy single accent, plenty of whitespace · subtle, fast, purposeful (no gimmicks that undercut trust) · flat with soft shadows · hero: crisp value prop + an animated product UI mock or a calm gradient/mesh background. Restraint dial.

- **AI startup** — near-black, electric/violet accent, glow · sharp energetic motion, data/particle motifs · volumetric bloom · hero: a reactive shader/particle field (neural/flow look) behind a bold claim; pointer interacts with the field.

- **Fintech** — deep navy/black or clean light, green/blue accent, precise grid · controlled, confident, smooth · flat or subtle glow · hero: animated number/graph motifs, a globe or network, secure/solid feel. Avoid anything that reads as unstable.

- **Crypto / web3** — black, neon/iridescent accents, chrome · high-energy, glitch and parallax · heavy volumetric bloom + chromatic aberration · hero: chrome/iridescent 3D object on a dark glowing field, scroll flythrough. High intensity.

- **Dev tools** — dark "editor" palette, terminal greens/blues, monospace accents · snappy, precise, code-reveal animations · flat/volumetric · hero: animated code or a live demo; tasteful, fast, no fluff.

- **Luxury brand / watch / jewelry** — black or cream, gold/metal accent, vast whitespace · slow, weighty, expensive easing (expo) · HDRI image-based for material realism · hero: the product on a turntable/scroll-rotated rig with pristine reflections; silence and space. Low intensity, maximum polish.

- **Fashion** — editorial high-contrast, monochrome + one bold accent · bold image transitions, distortion/displacement on hover, big type · flat/graphic · hero: full-bleed imagery with WebGL image-distortion transitions and kinetic type. Editorial maximalism.

- **Automotive** — dark cinematic, metallic accent · scroll-driven camera flythrough around the car, weighty motion · HDRI + rim light · hero: 3D vehicle, scroll rotates/pans the camera, hotspots reveal features.

- **Music / artist** — moody, genre-driven palette, expressive · rhythmic, audio-reactive if possible, heavy atmosphere · volumetric, colored lights · hero: reactive visuals (waveform/particles), immersive full-screen. High intensity.

- **Photography** — pure neutral canvas, image is the hero · minimal, let images breathe, smooth scroll, subtle parallax · flat · hero: full-bleed image with a refined mask/scale reveal; gallery with image-on-scroll reveals.

- **Product launch / landing** — focused palette, one accent, single narrative · cinematic scroll storytelling, staged reveals building to a CTA · matches product mood · hero: scene-by-scene scrollytelling that assembles the product/story, ending in a magnetic CTA.

- **Restaurant / hospitality** — warm, textured, appetizing palette · slow, sensual, parallax food imagery · flat/warm · hero: full-bleed imagery, elegant type, gentle parallax and reveal. Mid intensity, lots of warmth.

When the brand isn't in this list, pick the nearest archetype's intensity + lighting and rebuild the palette/type around the actual brand. The recipe is a launch point; the coherence test in §1 is the real gate.

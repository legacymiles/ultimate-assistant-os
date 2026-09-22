# Source technique

Origin: "WebGL Image Reveal Tutorial with Framer and Unicorn.Studio" —
a designer workflow (not hand-written GLSL) using Unicorn Studio's no-code
WebGL editor, embedded into a Framer site.

Description of the effect from a builder who replicated it (Threads/LinkedIn,
2025): *"I layered two perfectly matched images, one with a helmet and one
without, added a reveal background mouse trail, and used subtle pixel
distortion to create that interactive scanning effect."*

Unicorn Studio's own docs describe the primitives this is built from, without
naming this exact recipe:
- Layers can be images, shapes, text, or masks.
- Almost any layer property can respond to events: appear, hover, scroll,
  mouse move.
- Effects can respond to cursor **speed**, not just position — used to add
  "energy" as the user moves faster.
- The library ships 70+ configurable effects across Distortion, Blur,
  Lighting, Stylize, Filters.

Translating that into a hand-written GLSL/R3F implementation (no Unicorn
Studio dependency, fully in-repo):
- The "reveal background" = the hidden image layer, masked in via a
  **mouse-trail mask** (memory of recent cursor path), not a static hover
  circle.
- The "subtle pixel distortion" = a thin RGB-channel-split / UV-jitter band
  right at the mask boundary — closer to a scanner artifact than a flame.
- The "scanning" read comes from the trail's elongated, path-shaped mask —
  a spotlight reads as a flashlight; a trail reads as a scan.

## What NOT to build (learned from a first failed attempt)

A first implementation of this technique used a single noisy "fire front"
circle around the live cursor position, with cartoon flame colors and ember
particles. It technically revealed the second image, but it read as a
generic hover-glow effect, not the Unicorn Studio scanning look, for two
reasons: (1) no trail memory — the mask only ever reflected the current
frame's pointer position, so it looked like a spotlight, and (2) the color
and noise treatment was loud (saturated orange blob) instead of subtle
(thin chromatic-aberration edge). Both are corrected by the ring-buffer
trail + thin-distortion-band approach in SKILL.md.

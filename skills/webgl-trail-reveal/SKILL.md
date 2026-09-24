---
name: webgl-trail-reveal
description: >-
  Build a WebGL "mouse-trail image reveal" — two perfectly-aligned images
  (e.g. a calm subject and a dramatic/transformed version) stacked in one
  shader, where moving the cursor paints a persistent trail that reveals the
  hidden layer underneath with subtle pixel/chromatic distortion at the
  boundary, and the trail fades a moment after the pointer leaves. This is
  the technique popularized by Unicorn Studio + Framer tutorials (see
  references/technique.md). Use this WHENEVER the user asks for: an "image
  reveal" effect, "hover to reveal" / "reveal on scan", a mouse-trail /
  scanning effect over an image, a "before/after" or "hidden version"
  interaction, or references unicorn.studio, or describes two images where
  one is hidden under the other and revealed by moving the mouse. This is a
  specialist companion to interactive-web-studio — use both together: this
  skill owns the reveal shader mechanic, interactive-web-studio owns the
  page/section it lives in.
---

# WebGL Trail Reveal

A hover/scan mechanic: two images occupy the exact same frame. The cursor
doesn't just show a spotlight at its current position — it **paints a trail**
as it moves, and that trail is the reveal mask. The boundary between "hidden"
and "revealed" isn't a flame or a hard edge — it's a **thin, subtle pixel/RGB
-split distortion band**, closer to a document scanner or a heat-vision
sweep than a cartoon effect. When the pointer stops, the trail lingers for a
beat, then fades, returning to the calm image.

**The single most common mistake:** building a blob/fireball that follows the
*current* cursor position and calling it done. That is a spotlight, not a
trail, and it reads as a cheap hover effect, not the "how did they build
that" reaction this technique is known for. The trail — a path with memory —
is the entire trick. Read `references/technique.md` before writing the
shader.

## What actually makes this effect read as premium

1. **Trail, not spotlight.** The mask must remember the last ~0.4–0.8s of
   pointer path, not just the current point. Implemented as a small ring
   buffer of recent positions with per-point age, summed in the shader (see
   below) — not a single circle around `uMouse`.
2. **Subtle edge treatment, not chaos.** The boundary gets a thin band of
   distortion: a few pixels of UV jitter (fbm-driven, small amplitude) plus a
   slight RGB channel split (chromatic aberration). No noisy flame blobs, no
   loud particle bursts. Restraint is what makes it look expensive.
3. **Decay with weight.** The trail doesn't vanish instantly when the pointer
   stops — it holds for a moment, then eases closed. Every point in the ring
   buffer ages independently so the tail of the trail fades before the head.
4. **Two images must be pixel-aligned.** Same crop, same composition, same
   subject position — the whole illusion depends on the two layers matching
   perfectly so the reveal feels like removing a layer, not replacing a
   photo. If the user's two images don't align, say so before building.
5. **Speed can modulate intensity subtly** — a faster sweep can widen the
   trail band or brighten the distortion — but keep this restrained (10–30%
   variation), not the dominant driver. Unlike a fire-reveal fireball, this
   technique's energy comes from the trail's persistence, not from explosive
   reactivity.
6. **Reduced motion / no-WebGL fallback still required** — see the
   guardrails in the `interactive-web-studio` skill (drag-to-reveal slider or
   static crossfade).

## Shader approach (ring-buffer trail mask)

Avoid a full ping-pong framebuffer trail (accurate but heavier) unless the
project already has an FBO pipeline. A ring buffer of recent pointer
positions passed as uniform arrays is simpler, fully GPU-side per fragment,
and reads identically for a cursor-sized trail:

```glsl
uniform vec2  uTrailPos[TRAIL_N];  // last N pointer positions, uv space
uniform float uTrailAge[TRAIL_N];  // 0 = newest .. 1 = oldest/fully faded
uniform float uPlaneAspect;

float trailMask(vec2 uv) {
  float m = 0.0;
  for (int i = 0; i < TRAIL_N; i++) {
    vec2 d = uv - uTrailPos[i];
    d.x *= uPlaneAspect; // keep the trail circular regardless of aspect
    float age = uTrailAge[i];
    float radius = mix(0.09, 0.02, age);      // head is fat, tail tapers
    float falloff = 1.0 - smoothstep(radius * 0.4, radius, length(d));
    m = max(m, falloff * (1.0 - age));         // age fades contribution
  }
  return clamp(m, 0.0, 1.0);
}
```

CPU side (per frame, in the R3F component): push the smoothed pointer
position into a fixed-size ring buffer only when it has moved past a small
threshold (avoids flooding the buffer while idle), age every existing entry
upward each frame (`age += dt / holdDuration`), drop points once
`age >= 1`, and upload the arrays to the shader's uniforms every frame.
`TRAIL_N` of 20–28 points is enough for a fluid trail without hitting
uniform-count limits on low-end GPUs.

Edge distortion (apply where `trailMask` is in the 0.1–0.9 transition band):

```glsl
float edge = 4.0 * mask * (1.0 - mask); // peaks at the boundary
vec2 jitter = (vec2(fbm(uv * 40.0 + uTime), fbm(uv * 40.0 - uTime)) - 0.5) * 0.006 * edge;
vec3 revealR = texture2D(uReveal, uv + jitter + vec2(0.003, 0.0) * edge).rgb;
vec3 revealG = texture2D(uReveal, uv + jitter).rgb;
vec3 revealB = texture2D(uReveal, uv + jitter - vec2(0.003, 0.0) * edge).rgb;
vec3 revealSplit = vec3(revealR.r, revealG.g, revealB.b);
vec3 result = mix(base, revealSplit, smoothstep(0.0, 1.0, mask));
result += vec3(1.0, 0.55, 0.2) * edge * 0.35; // thin warm rim, not a blob
```

## Build checklist

- [ ] Confirm the two source images are pixel-aligned (same crop/composition).
- [ ] Ring-buffer trail (position + age arrays), not a single spotlight circle.
- [ ] Edge = thin distortion band (fbm UV jitter + RGB split), not noise-blob fire.
- [ ] Trail holds briefly on pointer-stop, then eases closed — never snaps.
- [ ] `prefers-reduced-motion` → static crossfade slider; no-WebGL → static image.
- [ ] Verify in-browser by scripting a pointer sweep across the canvas and
      screenshotting mid-sweep — a still screenshot after the pointer has
      been moving for ~1s should show a visible *trail shape*, not a single
      dot, and the boundary should look like a thin scan-line, not a flame.

See `references/technique.md` for the sourcing behind this (Unicorn Studio /
Framer tutorial breakdown) and `references/pitfalls.md` for mistakes to
avoid on the next build.

# Reusable Effects Library

Copy-paste-ready, SSR-safe, TypeScript implementations of the signature interactions. Read the relevant section before writing that effect — these encode the correct current APIs and the reduced-motion/cleanup handling that's easy to get wrong. Tune the numbers to the project's motion language (see `art-direction.md`); don't ship the defaults unexamined.

**Reduced motion, the clean way.** Wrap nontrivial GSAP work in `gsap.matchMedia()` keyed to `(prefers-reduced-motion: no-preference)`. The animation only registers when motion is allowed, and matchMedia auto-reverts on cleanup — no manual flags scattered everywhere. For non-GSAP effects (cursor, tilt), bail early with a `matchMedia` check. Always make the no-motion state show final content immediately.

## Table of contents
1. Foundations — `useReducedMotion`, `lerp`/`clamp`
2. `SmoothScrollProvider` (Lenis + ScrollTrigger)
3. `CustomCursor` (inertia)
4. `Magnetic`
5. `AnimatedText` (split reveal)
6. `Reveal` (scroll-in)
7. Pinned & horizontal scroll
8. `ParallaxLayer`
9. `Marquee`
10. `TiltCard`
11. R3F `Scene` scaffold (lighting + bloom)
12. `ShaderBackground` (GLSL fbm gradient)

---

## 1. Foundations

```ts
// lib/math.ts
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
export const map = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((v - a) * (d - c)) / (b - a);
```

```tsx
// hooks/useReducedMotion.ts
import { useEffect, useState } from "react";
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}
```

---

## 2. SmoothScrollProvider — Lenis synced to GSAP ScrollTrigger

Mount once near the root (in `layout.tsx`, inside `<body>`). This is the canonical sync: drive Lenis from GSAP's ticker so smooth scroll and ScrollTrigger never drift.

```tsx
"use client";
import { ReactNode, useEffect } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function SmoothScrollProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Respect reduced motion: keep native scroll, skip Lenis entirely.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // expo-out, weighty
      smoothWheel: true,
    });

    lenis.on("scroll", ScrollTrigger.update);
    const onRaf = (time: number) => lenis.raf(time * 1000); // gsap ticker is seconds, lenis wants ms
    gsap.ticker.add(onRaf);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(onRaf);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
```

After fonts/images load and shift layout, call `ScrollTrigger.refresh()` so pin/scrub math stays correct.

---

## 3. CustomCursor — inertia follow

Mutates the DOM directly in a rAF loop (never React state per frame). Skips touch devices. Pair with `* { cursor: none }` only on pointer-fine devices, and never let it obscure keyboard focus.

```tsx
"use client";
import { useEffect, useRef } from "react";

export function CustomCursor() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return; // no custom cursor on touch
    const el = ref.current!;
    let mx = innerWidth / 2, my = innerHeight / 2, x = mx, y = my;

    const onMove = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; };
    addEventListener("pointermove", onMove);

    let raf = 0;
    const render = () => {
      x += (mx - x) * 0.18; // lower = laggier/heavier
      y += (my - y) * 0.18;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    const grow = () => el.classList.add("is-hover");
    const shrink = () => el.classList.remove("is-hover");
    const targets = document.querySelectorAll('a, button, [data-cursor="hover"]');
    targets.forEach((t) => { t.addEventListener("pointerenter", grow); t.addEventListener("pointerleave", shrink); });

    return () => {
      removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
      targets.forEach((t) => { t.removeEventListener("pointerenter", grow); t.removeEventListener("pointerleave", shrink); });
    };
  }, []);

  return <div ref={ref} className="cursor" aria-hidden />;
}
```

```css
/* globals.css — fine-pointer only */
@media (hover: hover) and (pointer: fine) {
  body { cursor: none; }
  .cursor {
    position: fixed; top: 0; left: 0; z-index: 9999; pointer-events: none;
    width: 16px; height: 16px; border-radius: 9999px;
    background: white; mix-blend-mode: difference; /* reads on any background */
    transition: width .3s ease, height .3s ease, background .3s ease;
  }
  .cursor.is-hover { width: 56px; height: 56px; background: white; }
}
```

Variants: swap the dot for a ring + dot, add a `blur()` for a goo cursor, or render trailing dots each lerping toward the previous one for a particle/comet trail.

---

## 4. Magnetic — pull toward the pointer

Wrap CTAs, logos, nav links. Uses `gsap.quickTo` so high-frequency pointer moves reuse one tween instead of spawning hundreds.

```tsx
"use client";
import { ReactNode, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

export function Magnetic({ children, strength = 0.4 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const el = ref.current!;
    const xTo = gsap.quickTo(el, "x", { duration: 0.6, ease: "elastic.out(1, 0.4)" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.6, ease: "elastic.out(1, 0.4)" });

    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * strength);
      yTo((e.clientY - (r.top + r.height / 2)) * strength);
    };
    const onLeave = () => { xTo(0); yTo(0); };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => { el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", onLeave); };
  }, { scope: ref });

  return <span ref={ref} className="inline-block will-change-transform">{children}</span>;
}
```

---

## 5. AnimatedText — split-text reveal

SplitText ships free with GSAP 3.12+. Words rise out of clipped lines (mask reveal). Reduced motion → text renders normally (matchMedia simply doesn't register the tween).

```tsx
"use client";
import { ElementType, ReactNode, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, SplitText);

export function AnimatedText({
  children, as: Tag = "h2", stagger = 0.05,
}: { children: ReactNode; as?: ElementType; stagger?: number }) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const split = new SplitText(ref.current!, { type: "lines,words", linesClass: "overflow-hidden" });
      gsap.from(split.words, {
        yPercent: 115, opacity: 0, duration: 0.9, ease: "power4.out", stagger,
        scrollTrigger: { trigger: ref.current!, start: "top 85%" },
      });
      return () => split.revert(); // restore original DOM
    });
  }, { scope: ref });

  return <Tag ref={ref as never}>{children}</Tag>;
}
```

For character-level reveals use `type: "chars"` and animate `split.chars`. For a heavier feel, animate `rotationX` from `-90` with `transformOrigin: "50% 100% -20px"`.

---

## 6. Reveal — generic scroll-in wrapper

```tsx
"use client";
import { ReactNode, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger);

export function Reveal({ children, y = 48, delay = 0 }: { children: ReactNode; y?: number; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(ref.current, {
        y, opacity: 0, duration: 1, delay, ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 88%" },
      });
    });
  }, { scope: ref });
  return <div ref={ref}>{children}</div>;
}
```

---

## 7. Pinned section & horizontal scroll story

The signature "scroll moves the camera/story" device. Pin the container and translate panels horizontally as the user scrolls vertically.

```tsx
"use client";
import { ReactNode, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger);

export function HorizontalScroll({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    // Horizontal pinning is disorienting with reduced motion → fall back to vertical stack.
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const panels = gsap.utils.toArray<HTMLElement>(".panel", track.current!);
      gsap.to(panels, {
        xPercent: -100 * (panels.length - 1),
        ease: "none",
        scrollTrigger: {
          trigger: container.current!,
          pin: true,
          scrub: 1,
          end: () => "+=" + (track.current!.scrollWidth - innerWidth),
          invalidateOnRefresh: true,
        },
      });
    });
  }, { scope: container });

  return (
    <section ref={container} className="overflow-hidden">
      <div ref={track} className="flex h-screen flex-nowrap [&>.panel]:h-screen [&>.panel]:w-screen [&>.panel]:shrink-0">
        {children}
      </div>
    </section>
  );
}
```

Same `pin + scrub` pattern drives zoom stories, image sequences (swap frames by scroll progress), and R3F camera flythroughs (read `scrollTrigger` progress in `useFrame` and lerp the camera).

---

## 8. ParallaxLayer

```tsx
"use client";
import { ReactNode, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger);

/** speed > 0 moves slower than scroll (recedes); negative moves faster (advances). */
export function ParallaxLayer({ children, speed = 0.3 }: { children: ReactNode; speed?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.to(ref.current, {
        yPercent: speed * 100,
        ease: "none",
        scrollTrigger: { trigger: ref.current, start: "top bottom", end: "bottom top", scrub: true },
      });
    });
  }, { scope: ref });
  return <div ref={ref} className="will-change-transform">{children}</div>;
}
```

---

## 9. Marquee

CSS-driven infinite scroll (cheap, smooth). Duplicate the content so the loop is seamless; pause under reduced motion.

```tsx
export function Marquee({ children, seconds = 24 }: { children: React.ReactNode; seconds?: number }) {
  return (
    <div className="marquee" aria-hidden>
      <div className="marquee__track" style={{ animationDuration: `${seconds}s` }}>
        <span className="marquee__group">{children}</span>
        <span className="marquee__group">{children}</span>
      </div>
    </div>
  );
}
```

```css
.marquee { overflow: hidden; width: 100%; }
.marquee__track { display: flex; width: max-content; animation: marquee linear infinite; }
.marquee__group { display: flex; gap: 3rem; padding-right: 3rem; white-space: nowrap; }
@keyframes marquee { to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) { .marquee__track { animation: none; } }
```

For a marquee whose speed/direction reacts to scroll velocity, drive `translateX` with GSAP from a Lenis `velocity` value instead of the CSS keyframe.

---

## 10. TiltCard

3D tilt toward the pointer with a glare option. rAF-batched, resets on leave.

```tsx
"use client";
import { ReactNode, useRef } from "react";

export function TiltCard({ children, max = 12 }: { children: ReactNode; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const onMove = (e: React.PointerEvent) => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.transform = `perspective(900px) rotateY(${px * max}deg) rotateX(${-py * max}deg) scale(1.02)`;
    });
  };
  const onLeave = () => {
    cancelAnimationFrame(frame.current);
    ref.current!.style.transform = "perspective(900px) rotateY(0) rotateX(0) scale(1)";
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className="transition-transform duration-300 ease-out will-change-transform [transform-style:preserve-3d]"
    >
      {children}
    </div>
  );
}
```

---

## 11. R3F Scene scaffold

Always `dynamic(() => import(...), { ssr: false })` this from the page (see tech-stack.md). Includes lighting, environment, float, and bloom post-processing. Mark the canvas wrapper `aria-hidden` if purely decorative.

```tsx
"use client";
import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, Float } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";

export default function Scene() {
  return (
    <Canvas
      dpr={[1, 2]}                                   // never full DPR on 3x screens
      camera={{ position: [0, 0, 6], fov: 35 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#05060a"]} />
      <Suspense fallback={null}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[4, 6, 5]} intensity={2.2} />
        <Float speed={1.4} rotationIntensity={0.6} floatIntensity={1.2}>
          <mesh>
            <icosahedronGeometry args={[1.5, 12]} />
            <meshStandardMaterial color="#6d5dfc" roughness={0.15} metalness={0.9} />
          </mesh>
        </Float>
        <Environment preset="city" />          {/* image-based lighting / reflections */}
        <EffectComposer>
          <Bloom intensity={0.9} luminanceThreshold={0.25} luminanceSmoothing={0.9} mipmapBlur />
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}
```

R3F applies ACES filmic tone mapping and sRGB output by default — good cinematic baseline. Add `<OrbitControls enableZoom={false} />` from drei only for explore-style scenes; for hero scenes prefer a mouse-follow `CameraRig` (lerp `camera.position` toward a target derived from pointer in `useFrame`).

---

## 12. ShaderBackground — GLSL fbm gradient

A full-screen animated gradient (aurora/energy field) driven by flowing fbm noise, time, and the mouse. Uses a 2×2 plane whose vertex shader writes clip space directly, so it fills the viewport regardless of camera. Self-contained noise (no external chunks).

```tsx
"use client";
import * as THREE from "three";
import { useRef } from "react";
import { Canvas, useFrame, extend, type ThreeElement } from "@react-three/fiber";
import { shaderMaterial } from "@react-three/drei";
import { lerp } from "@/lib/math";

const GradientMaterial = shaderMaterial(
  { uTime: 0, uMouse: new THREE.Vector2(0.5, 0.5) },
  // vertex — pass uv, output clip-space position directly
  /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  // fragment — value-noise fbm flow field
  /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform vec2 uMouse;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                 mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
    }
    float fbm(vec2 p){
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.0; a *= 0.5; }
      return v;
    }
    void main(){
      float t = uTime * 0.08;
      vec2 q = vUv * 3.0;
      q.x += fbm(q + t);
      q.y += fbm(q - t);
      float n = fbm(q + uMouse * 0.6);
      vec3 base  = vec3(0.02, 0.02, 0.08);
      vec3 mid   = vec3(0.35, 0.18, 0.85);
      vec3 hi    = vec3(0.00, 0.70, 0.90);
      vec3 col = mix(base, mid, smoothstep(0.2, 0.8, n));
      col = mix(col, hi, smoothstep(0.55, 1.0, fbm(q * 1.5 - t)));
      gl_FragColor = vec4(col, 1.0);
    }
  `
);
extend({ GradientMaterial });

// TS: register the custom element so <gradientMaterial /> typechecks
declare module "@react-three/fiber" {
  interface ThreeElements {
    gradientMaterial: ThreeElement<typeof GradientMaterial>;
  }
}

function Plane() {
  const mat = useRef<any>(null);
  const target = useRef(new THREE.Vector2(0.5, 0.5));
  useFrame(({ clock, pointer }, delta) => {
    if (!mat.current) return;
    mat.current.uTime = clock.elapsedTime;
    // pointer is -1..1; remap to 0..1 and ease toward it
    target.current.set(pointer.x * 0.5 + 0.5, pointer.y * 0.5 + 0.5);
    mat.current.uMouse.x = lerp(mat.current.uMouse.x, target.current.x, delta * 3);
    mat.current.uMouse.y = lerp(mat.current.uMouse.y, target.current.y, delta * 3);
  });
  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <gradientMaterial ref={mat} />
    </mesh>
  );
}

export default function ShaderBackground() {
  return (
    <Canvas className="!fixed inset-0 -z-10" dpr={[1, 2]} gl={{ antialias: false }}>
      <Plane />
    </Canvas>
  );
}
```

This one shader is a template for the whole shader family — swap the fragment body for: fresnel rim (`pow(1.0 - dot(normal, viewDir), p)` on a mesh material), refraction/heat (sample a scene texture with noise-offset uv), dissolve (discard where `noise < threshold`, glow at the edge), chromatic aberration (sample rgb at offset uvs), hologram (scanlines + fresnel + flicker), or vertex displacement (offset `position` along `normal` by `noise` in the vertex shader). Keep one `ShaderMaterial` per effect and expose its knobs as uniforms.

**Older R3F (v8) note:** if the project is on R3F v8, replace the `declare module` block's `ThreeElement`/`ThreeElements` with the v8 form (`extend` + a `JSX.IntrinsicElements` augmentation using `ReactThreeFiber.Object3DNode`/`MaterialNode`). The runtime code is identical.

# Tech Stack, Project Structure & Production Checklist

Read this at project setup, or whenever wiring dependencies, structuring folders, or preparing to ship.

## Table of contents
1. Install & packages
2. Folder structure
3. SSR-safe WebGL & animation patterns (Next.js)
4. Performance playbook
5. Deployment / SEO / a11y checklist

---

## 1. Install & packages

Scaffold (App Router, TS, Tailwind):

```bash
npx create-next-app@latest my-site --typescript --tailwind --app --eslint --src-dir --import-alias "@/*"
cd my-site
```

Core animation + smooth scroll (almost always):

```bash
npm i gsap @gsap/react lenis motion
```

- `gsap` — timelines, ScrollTrigger, SplitText. **SplitText and ScrollTrigger ship free in GSAP 3.12+** (no Club membership needed). Register plugins client-side only.
- `@gsap/react` — the `useGSAP()` hook (handles `gsap.context()` scoping + cleanup automatically; the modern replacement for manual context in React).
- `lenis` — smooth scroll. (The package is `lenis`; the old `@studio-freight/lenis` name is deprecated.) React bindings also exist via `lenis/react` (`ReactLenis`).
- `motion` — Framer Motion's current package name. Import from `motion/react` (e.g. `import { motion, useScroll } from "motion/react"`). The legacy `framer-motion` package still works if a project already uses it.

3D / WebGL (only when the project needs it):

```bash
npm i three @react-three/fiber @react-three/drei @react-three/postprocessing
npm i -D @types/three
```

Optional, as the experience demands:

```bash
npm i @react-three/rapier        # physics
npm i leva                       # dev-time GUI for tuning uniforms/params
npm i maath                      # easing/math helpers for r3f (damp, etc.)
```

Tailwind: keep it for layout/utility, but reach for real CSS/GLSL for the cinematic parts. Add `tailwindcss-animate` only if you want utility keyframes; most signature motion lives in GSAP/Motion, not Tailwind.

---

## 2. Folder structure

Scale by concern. Never dump everything in `page.tsx`.

```
src/
├── app/
│   ├── layout.tsx              # fonts, metadata, <SmoothScrollProvider>, <CustomCursor>
│   ├── page.tsx                # composes sections; no effect logic inline
│   └── (sections)/             # Hero, Work, About, Footer as components
├── components/
│   ├── ui/                     # buttons, links, GlassPanel, etc.
│   ├── motion/                 # AnimatedText, Reveal, Magnetic, Marquee, ParallaxLayer
│   ├── cursor/                 # CustomCursor
│   ├── providers/              # SmoothScrollProvider
│   └── three/                  # Scene, Hero3D, ShaderBackground, CameraRig, Particles
├── shaders/                    # *.vert.glsl / *.frag.glsl (or .ts template literals)
├── hooks/                      # useReducedMotion, useMousePosition, useDimensions
├── lib/                        # utils, constants, easing tokens, lerp/clamp
└── styles/                     # globals.css, fonts
public/
├── models/                     # .glb (draco/meshopt compressed)
├── textures/                   # .ktx2 / compressed
└── hdr/                        # environment maps
```

Loading GLSL files: either use template-literal strings in `.ts` (zero config, recommended for portability) or add a raw loader. With Turbopack/Next you can also `import frag from "./x.glsl"` after configuring a rule — but template literals avoid build-config friction.

---

## 3. SSR-safe WebGL & animation patterns (Next.js)

WebGL touches `window`/`document` and must not run during server render. Always dynamic-import 3D with `ssr: false`:

```tsx
// app/page.tsx
import dynamic from "next/dynamic";

const Scene = dynamic(() => import("@/components/three/Scene"), {
  ssr: false,
  loading: () => <div className="h-screen w-full bg-black" />, // reserve space, avoid layout shift
});
```

Register GSAP plugins on the client only, and prefer `useGSAP` so animations are scoped and auto-revert on unmount (prevents leaks + double-fire in Strict Mode):

```tsx
"use client";
import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function Section() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      gsap.from(".reveal", { y: 40, opacity: 0, stagger: 0.08, ease: "power3.out" });
    },
    { scope: root } // selectors resolve within root; everything reverts on unmount
  );
  return <section ref={root}>…</section>;
}
```

Guard any direct DOM measurement and run it in `useLayoutEffect` (or `useGSAP`), never module scope. For "is this the browser?" checks use `typeof window !== "undefined"`.

---

## 4. Performance playbook

Target 60fps. Measure (Chrome Performance panel, r3f `<Perf/>` from `r3f-perf`, or drei `<Stats/>`) before adding more.

**WebGL**
- Cap device pixel ratio: `<Canvas dpr={[1, 2]}>` — never render at full DPR on 3x phones.
- `frameloop="demand"` for static/idle scenes; call `invalidate()` only when something changes. Use continuous loop only when always animating.
- **Instance** repeated geometry: `<Instances>`/`<Instance>` (drei) or `InstancedMesh` — thousands of objects, one draw call.
- Compress textures to **KTX2** (basis) and models to **draco/meshopt** glb. Load with drei `useGLTF`/`useKTX2`.
- Reuse geometries/materials; don't recreate per render. Memoize uniforms objects.
- Frustum culling is on by default — keep it; add **LOD** (drei `<Detailed>`) for heavy models.
- Dispose on unmount (r3f does this for managed objects; manual `new THREE.*` needs manual `.dispose()`).

**DOM/motion**
- Animate `transform` and `opacity` only (GPU-composited). Avoid animating `width/height/top/left` — they trigger layout.
- Add `will-change: transform` to elements under continuous transform; remove it when idle.
- Use GSAP `quickTo`/`quickSetter` for high-frequency pointer-driven updates instead of new tweens per event.
- Throttle/rAF-batch `pointermove`/`scroll` work; never set React state every frame for cursor/parallax — mutate refs/DOM directly.
- `ScrollTrigger.refresh()` after layout-affecting async content (fonts, images) loads.

**Loading**
- Lazy-load below-the-fold sections and all 3D. Preload only the hero's critical assets.
- Use `next/image` for raster art and `next/font` for fonts (no FOUT, no extra request).

---

## 5. Deployment / SEO / a11y checklist

Every project ships with:

**Metadata & discovery**
- `export const metadata` (App Router) with `title`, `description`, `openGraph` (with a 1200×630 OG image), `twitter` card, `metadataBase`.
- `app/sitemap.ts` and `app/robots.ts`.
- Favicon set + `apple-icon` + theme-color.

**Accessibility (gating ship)**
- Honor `prefers-reduced-motion` everywhere (see effects-library — disable Lenis, kill nontrivial tweens, swap shaders for static fallback).
- Full keyboard navigation; visible `:focus-visible` styles (don't remove outlines without replacing them).
- Color contrast ≥ WCAG AA; content legible with motion off and with JS disabled where feasible.
- Semantic HTML + landmarks; `alt` text; `aria-label` on icon-only controls; respect tab order (custom cursor must not hide focus).
- Canvas/3D decorative scenes marked `aria-hidden` with real content in the DOM behind them.

**Robustness**
- Error boundaries around 3D/Canvas (a shader failure must not blank the page).
- `<Suspense>` + tasteful loading states for async scenes/models.
- WebGL/low-end detection → graceful fallback (static gradient or image instead of shader; fewer particles).

**Build & deploy**
- `npm run build` passes clean (no type errors) before deploy.
- Deploy on Vercel (Next.js native). Add `vercel.ts` or `vercel.json` only if you need custom headers/redirects/crons.
- `.env.example` documenting any env vars; never commit secrets.
- `README.md` with stack, install, dev, build, deploy, and an overview of the art direction + reusable components.

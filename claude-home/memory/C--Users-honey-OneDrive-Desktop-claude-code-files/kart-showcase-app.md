---
name: kart-showcase-app
description: "The APEX/01 kart teardown 3D app in the hub, and the 3D stack now installed"
metadata: 
  node_type: memory
  type: project
  originSessionId: fd9b778b-9bec-48ee-adfd-72e46c263663
---

The hub (Ultimate Assistant OS, Next.js 15 + React 19 + Tailwind v4) has an
interactive 3D app at `/apps/kart-showcase` — "APEX/01 Kart Teardown": a
procedural go-kart on an orbiting stage that explodes into labelled parts on
hover (igloo.inc-style leader-line callouts), click-to-isolate, then scrolls
into a first-person neon-tunnel ride. Code under `src/components/kart/` +
`src/lib/kart/`; registered in `src/lib/catalog.ts` (seed.ts auto-derives).

The 3D/animation stack was added to package.json for this: `three`,
`@react-three/fiber` v9, `@react-three/drei` v10, `@react-three/postprocessing`,
`postprocessing`, `maath`, `gsap`, `lenis` (+ `@types/three`). Reuse these for
future interactive/3D hub apps rather than reinstalling.

Built with the user's [[interactive-web-studio-skill]] plus the new
`exploded-showcase` skill (distilled from igloo.inc — orbit + hover-explode +
labelled parts + scroll-to-POV). Note: R3F pointer raycasting can't be driven by
synthetic PointerEvents in the preview harness — verify 3D hover via a dev store
handle (`window.__kartStore`, gated to non-production) instead.

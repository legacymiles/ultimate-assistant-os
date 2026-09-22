# Exploded View

The core mechanic. Every part knows two transforms: **home** (assembled) and
**exploded** (displaced along an assembly vector). Parts belong to a **region**;
hovering a region explodes just that cluster. Clicking a part **isolates** it.

## The part registry — the heart of the whole thing

Data-drive everything from one list. Swap this list, get a completely different
showcase with zero component changes.

```ts
// lib/parts.ts
import * as THREE from 'three';

export type Region = 'front' | 'cockpit' | 'powertrain' | 'wheels' | 'aero';

export interface PartDef {
  id: string;
  region: Region;
  name: string;          // shown big in the callout
  spec: string;          // one-line description under the name
  /** Displacement from home when this region explodes (object space). */
  explode: [number, number, number];
  /** Where the leader line attaches, relative to the part (object space). */
  anchor?: [number, number, number];
}

export const PARTS: PartDef[] = [
  { id: 'nose',     region: 'front',      name: 'Nose Cone',      spec: 'Impact-absorbing composite fairing',           explode: [0, 0.2, 1.4] },
  { id: 'steering', region: 'cockpit',    name: 'Steering Column',spec: 'Quick-release, 3° rake',                        explode: [0, 0.9, 0.2] },
  { id: 'seat',     region: 'cockpit',    name: 'Seat Shell',     spec: 'Carbon monocoque, 4-point harness',             explode: [0, 0.4, -0.6] },
  { id: 'engine',   region: 'powertrain', name: 'Engine',         spec: '2-stroke 125cc • 46 bhp @ 13,000 rpm',          explode: [0, 0.6, -1.5] },
  { id: 'exhaust',  region: 'powertrain', name: 'Expansion Chamber', spec: 'Tuned resonant exhaust',                     explode: [0.6, 0.3, -1.4] },
  { id: 'wheelFL',  region: 'wheels',     name: 'Front Slick',    spec: '10" magnesium rim • soft compound',             explode: [1.3, 0, 0.8] },
  { id: 'wheelFR',  region: 'wheels',     name: 'Front Slick',    spec: '10" magnesium rim • soft compound',             explode: [-1.3, 0, 0.8] },
  { id: 'rearWing', region: 'aero',       name: 'Rear Wing',      spec: 'Adjustable 3-element, +40kg downforce',         explode: [0, 0.9, -1.9] },
  // ...one entry per inspectable part.
];

export const REGIONS: Region[] = ['front', 'cockpit', 'powertrain', 'wheels', 'aero'];
```

For a procedurally-modeled object, each `PartDef.id` maps to a mesh you build in
code. For a loaded GLB, map `id` to `nodes['<mesh name>']`.

## Shared state

One tiny store so hover/isolate is global (the HUD and annotations read it too).

```ts
// lib/useExplodeState.ts
import { create } from 'zustand';
import type { Region } from './parts';

interface ExplodeState {
  hoveredRegion: Region | null;
  isolated: string | null;         // part id, or null
  reducedMotion: boolean;
  setHovered: (r: Region | null) => void;
  setIsolated: (id: string | null) => void;
}

export const useExplode = create<ExplodeState>((set) => ({
  hoveredRegion: null,
  isolated: null,
  reducedMotion: false,
  setHovered: (r) => set({ hoveredRegion: r }),
  setIsolated: (id) => set((s) => ({ isolated: s.isolated === id ? null : id })),
}));
```

## The Part component

A part damps from home → exploded based on whether its region is active. Use
`THREE.MathUtils.damp` (frame-rate independent) for weight, or drop to snappy
lerp under reduced motion.

```tsx
// components/three/Part.tsx
'use client';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PartDef } from '@/lib/parts';
import { useExplode } from '@/lib/useExplodeState';

const HOME = new THREE.Vector3();

export function Part({ def, home, children }: {
  def: PartDef;
  home: [number, number, number];   // assembled position
  children: React.ReactNode;        // the geometry+material (procedural or GLB node)
}) {
  const group = useRef<THREE.Group>(null!);
  const { hoveredRegion, isolated, reducedMotion, setHovered, setIsolated } = useExplode();

  const homeVec = new THREE.Vector3(...home);
  const explodedVec = homeVec.clone().add(new THREE.Vector3(...def.explode));

  useFrame((_, dt) => {
    const g = group.current;
    const active = hoveredRegion === def.region || isolated === def.id;
    const target = active ? explodedVec : homeVec;

    // Frame-rate independent smoothing. Higher lambda = snappier.
    const lambda = reducedMotion ? 999 : 6;
    g.position.x = THREE.MathUtils.damp(g.position.x, target.x, lambda, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, target.y, lambda, dt);
    g.position.z = THREE.MathUtils.damp(g.position.z, target.z, lambda, dt);

    // Dim everything except the isolated part.
    const dim = isolated && isolated !== def.id;
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'opacity' in m) {
        m.transparent = true;
        m.opacity = THREE.MathUtils.damp(m.opacity ?? 1, dim ? 0.12 : 1, 8, dt);
      }
    });
  });

  return (
    <group
      ref={group}
      position={home}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(def.region); document.body.style.cursor = 'pointer'; }}
      onPointerOut={(e) => { e.stopPropagation(); setHovered(null); document.body.style.cursor = 'auto'; }}
      onClick={(e) => { e.stopPropagation(); setIsolated(def.id); }}
    >
      {children}
    </group>
  );
}
```

### Why damp, not a one-shot tween?

The explode responds continuously to hover — the user can sweep across regions
and each cluster opens/closes with weight. A fixed-duration GSAP tween fights
rapid hover changes; per-frame damping toward a moving target just works and
feels physical (it eases, and if you flick away mid-open it smoothly reverses).

Add a **slight overshoot** for life: instead of damping straight to `explodedVec`,
damp to `explodedVec` then add `sin(t)*0.01` bob, or use a spring
(`maath`'s `damp3` with a lower lambda + a tiny `+` offset). Restraint — a hair
of overshoot reads as quality; a bouncy spring reads as a toy.

## Idle life

So the assembled object is never fully dead, bob the whole model a touch and
(optionally) fire a periodic "rev": every ~6s, kick one region's parts out 8%
and back over 400ms. Gate it off under reduced motion.

## Isolate → camera push

When `isolated` is set, tell the `CameraRig` to frame that part (pass the part's
world position as the orbit target and shrink the radius). Reset on the next
click / on background click (`onPointerMissed` on the Canvas → `setIsolated(null)`).

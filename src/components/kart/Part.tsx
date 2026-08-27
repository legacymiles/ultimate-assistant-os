"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PartDef } from "@/lib/kart/parts";
import { useKart, PHASE } from "@/lib/kart/store";

export function Part({ def, children }: { def: PartDef; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null!);

  const home = useRef(new THREE.Vector3(...def.home)).current;
  const exploded = useRef(
    new THREE.Vector3(...def.home).add(new THREE.Vector3(...def.explode)),
  ).current;

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const { hoveredRegion, isolated, reducedMotion, progress } = useKart.getState();

    const settling = progress > PHASE.showcaseEnd;
    const active = !settling && progress > PHASE.heroEnd &&
      (hoveredRegion === def.region || isolated === def.id);
    const target = active ? exploded : home;

    const lambda = reducedMotion ? 999 : 6.5;
    g.position.x = THREE.MathUtils.damp(g.position.x, target.x, lambda, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, target.y, lambda, dt);
    g.position.z = THREE.MathUtils.damp(g.position.z, target.z, lambda, dt);

    const dim = isolated ? (isolated !== def.id ? 0.1 : 1) : 1;
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material & { opacity?: number };
      if (m && typeof m.opacity === "number") {
        m.opacity = THREE.MathUtils.damp(m.opacity, dim, 8, dt);
      }
    });
  });

  return (
    <group
      ref={group}
      position={def.home}
      onPointerOver={(e) => {
        e.stopPropagation();
        useKart.getState().setHovered(def.region);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        if (useKart.getState().hoveredRegion === def.region)
          useKart.getState().setHovered(null);
        document.body.style.cursor = "auto";
      }}
      onClick={(e) => {
        e.stopPropagation();
        useKart.getState().toggleIsolated(def.id);
      }}
    >
      {children}
    </group>
  );
}

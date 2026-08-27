"use client";
/**
 * Atmosphere controller: samples the biome palette from scroll progress
 * every frame into a shared mutable object (`paletteNow`) that Sky, Arena
 * and the lights all read — one sample, zero allocations, no re-renders.
 * Also owns scene fog and the two main lights.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { createPaletteSample, samplePalette } from "@/lib/palette";
import { useArena } from "@/lib/store";
import { wallNow } from "@/lib/math";

/** Shared, mutated in place each frame. Import and read — never write. */
export const paletteNow = createPaletteSample();

export function Atmosphere() {
  const scene = useThree((s) => s.scene);
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    (window as unknown as Record<string, unknown>).__scene = scene;
  }
  const ambient = useRef<THREE.AmbientLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const rim = useRef<THREE.PointLight>(null);
  const fog = useMemo(() => new THREE.FogExp2("#7d6fc4", 0.016), []);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const store = useArena.getState();
    samplePalette(store.progress, paletteNow);

    // Neon event supercharges the accent + lights.
    const neon = store.event === "neon" && wallNow() < store.eventUntil;
    if (neon) {
      paletteNow.accent.offsetHSL(0, 0.1, 0.12);
      paletteNow.keyIntensity *= 1.35;
    }

    scene.fog = fog;
    fog.color.copy(paletteNow.fog);
    fog.density = paletteNow.fogDensity;

    if (ambient.current) {
      ambient.current.color.copy(paletteNow.ambient);
      ambient.current.intensity = paletteNow.ambientIntensity;
    }
    if (key.current) {
      key.current.color.copy(paletteNow.key);
      key.current.intensity = paletteNow.keyIntensity;
    }
    if (rim.current) {
      rim.current.color.copy(paletteNow.accent);
      rim.current.intensity = 30 + Math.sin(now * 1.8) * 8;
    }
  });

  return (
    <>
      <ambientLight ref={ambient} intensity={0.55} />
      <directionalLight ref={key} position={[6, 9, 4]} intensity={2.4} />
      {/* accent rim light from below-behind — makes silhouettes pop */}
      <pointLight ref={rim} position={[0, -3, -8]} intensity={30} distance={40} decay={2} />
    </>
  );
}

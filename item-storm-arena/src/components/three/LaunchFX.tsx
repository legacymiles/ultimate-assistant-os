"use client";
/**
 * Impact spectacle: a pooled particle system that bursts in the item's
 * color wherever a launch lands. One geometry, one draw call, recycled
 * forever — hits just claim the next slice of the pool.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useArena, arenaFx } from "@/lib/store";
import { TYPE_BY_KIND } from "@/lib/items";
import { wallNow } from "@/lib/math";

const POOL = 900;
const PER_BURST = 70;

export function LaunchFX() {
  const points = useRef<THREE.Points>(null);
  const cursorGlow = useRef<THREE.PointLight>(null);
  const nextSlot = useRef(0);
  const lastHitAt = useRef(0);

  const data = useMemo(() => {
    const positions = new Float32Array(POOL * 3);
    const colors = new Float32Array(POOL * 3);
    const velocities = new Float32Array(POOL * 3);
    const life = new Float32Array(POOL).fill(2); // dead
    // park dead particles far away
    for (let i = 0; i < POOL; i++) positions[i * 3 + 1] = -100;
    return { positions, colors, velocities, life };
  }, []);

  useFrame((state, dt) => {
    const now = state.clock.elapsedTime;
    const store = useArena.getState();

    // --- claim pool slices for any new hits ---
    for (const hit of store.hits) {
      if (hit.at <= lastHitAt.current) continue;
      lastHitAt.current = hit.at;
      const def = TYPE_BY_KIND[hit.kind];
      const color = new THREE.Color(def.emissive);
      const big = hit.kind === "coin" || hit.kind === "orb"; // showier bursts
      const count = big ? PER_BURST * 1.6 : PER_BURST;
      for (let n = 0; n < count; n++) {
        const i = nextSlot.current;
        nextSlot.current = (nextSlot.current + 1) % POOL;
        data.life[i] = 0;
        data.positions[i * 3] = arenaFx.kartX;
        data.positions[i * 3 + 1] = arenaFx.kartY + 0.4;
        data.positions[i * 3 + 2] = arenaFx.kartZ;
        // spherical burst with upward bias
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const speed = 2.5 + Math.random() * 4.5;
        data.velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
        data.velocities[i * 3 + 1] = Math.abs(Math.cos(phi)) * speed * 1.2 + 1;
        data.velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
        data.colors[i * 3] = color.r;
        data.colors[i * 3 + 1] = color.g;
        data.colors[i * 3 + 2] = color.b;
      }
    }
    store.consumeHits(wallNow() - 1);

    // --- integrate live particles ---
    for (let i = 0; i < POOL; i++) {
      if (data.life[i] >= 1.4) continue;
      data.life[i] += dt;
      data.velocities[i * 3 + 1] -= 6 * dt; // gravity
      data.positions[i * 3] += data.velocities[i * 3] * dt;
      data.positions[i * 3 + 1] += data.velocities[i * 3 + 1] * dt;
      data.positions[i * 3 + 2] += data.velocities[i * 3 + 2] * dt;
      if (data.life[i] >= 1.4) data.positions[i * 3 + 1] = -100;
    }
    if (points.current) {
      points.current.geometry.attributes.position.needsUpdate = true;
      points.current.geometry.attributes.color.needsUpdate = true;
    }

    // --- a soft light that follows the cursor, brighter with a full orbit ---
    if (cursorGlow.current) {
      cursorGlow.current.position.set(arenaFx.cursorX, arenaFx.cursorY, arenaFx.cursorZ);
      const load = Math.min(store.collected / 10, 1);
      cursorGlow.current.intensity = 4 + load * 26 + Math.sin(now * 4) * 2 * load;
    }
  });

  return (
    <>
      <points ref={points} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[data.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.09}
          vertexColors
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <pointLight ref={cursorGlow} color="#ffffff" intensity={4} distance={9} decay={2} />
    </>
  );
}

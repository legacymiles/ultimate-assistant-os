"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  TRAIL_N,
  trailRevealFragment,
  trailRevealVertex,
  type RevealMode,
  type RevealParams,
} from "@/shaders/trailReveal";

export interface RevealPlaneProps {
  base: THREE.Texture;
  reveal: THREE.Texture;
  mode: RevealMode;
  params: RevealParams;
  /** pointer target in uv space (0..1), y already flipped to GL orientation */
  mouseTarget: React.MutableRefObject<{ x: number; y: number }>;
  /** incremented on click to request a burst of trail points at the cursor */
  burstRequest: React.MutableRefObject<number>;
}

export function RevealPlane({ base, reveal, mode, params, mouseTarget, burstRequest }: RevealPlaneProps) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const { viewport } = useThree();

  const smooth = useRef({ x: 0.5, y: 0.5 });
  const vel = useRef({ x: 0, y: 0 });
  const prev = useRef({ x: 0.5, y: 0.5 });
  const lastSpawn = useRef({ x: 0.5, y: 0.5 });
  const writeIndex = useRef(0);
  const energy = useRef(0);
  const lastBurstSeen = useRef(0);

  const imageAspect = useMemo(() => {
    const img = base.image as { width?: number; height?: number } | undefined;
    return img?.width && img?.height ? img.width / img.height : 1;
  }, [base]);

  const uniforms = useMemo(
    () => ({
      uBase: { value: base },
      uReveal: { value: reveal },
      uTime: { value: 0 },
      uTrailPos: { value: Array.from({ length: TRAIL_N }, () => new THREE.Vector2(-10, -10)) },
      uTrailDir: { value: Array.from({ length: TRAIL_N }, () => new THREE.Vector2(0, 0)) },
      uTrailAge: { value: new Array(TRAIL_N).fill(1) },
      uPlaneAspect: { value: viewport.width / viewport.height },
      uImageAspect: { value: imageAspect },
      uRimColor: { value: new THREE.Vector3(...mode.rim) },
      uEnergy: { value: 0 },
      uRadius: { value: params.radius },
      uStrength: { value: params.strength },
      uHardness: { value: params.hardness },
      uFluidity: { value: params.fluidity },
      uChroma: { value: params.chromatic },
      uScale: { value: params.scale },
      uTailFade: { value: 1 },
      uMode: { value: mode.mode },
    }),
    // built once; everything below is updated imperatively per-frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const spawnAt = (x: number, y: number, dx: number, dy: number) => {
    const u = mat.current!.uniforms;
    const i = writeIndex.current;
    (u.uTrailPos.value[i] as THREE.Vector2).set(x, y);
    (u.uTrailDir.value[i] as THREE.Vector2).set(dx, dy);
    u.uTrailAge.value[i] = 0;
    writeIndex.current = (i + 1) % TRAIL_N;
  };

  useFrame((_, delta) => {
    const m = mat.current;
    if (!m) return;
    const dt = Math.min(Math.max(delta, 0.001), 0.05);
    const u = m.uniforms;

    u.uBase.value = base;
    u.uReveal.value = reveal;
    u.uImageAspect.value = imageAspect;
    u.uPlaneAspect.value = viewport.width / viewport.height;
    (u.uRimColor.value as THREE.Vector3).set(...mode.rim);
    u.uMode.value = mode.mode;
    u.uRadius.value = params.radius;
    u.uStrength.value = params.strength;
    u.uHardness.value = params.hardness;
    u.uFluidity.value = params.fluidity;
    u.uChroma.value = params.chromatic;
    u.uScale.value = params.scale;
    // Dissipation -> how fast the tail fades (exponent on remaining life)
    u.uTailFade.value = 0.8 + params.dissipation * 3.0;
    u.uTime.value += dt;

    // Momentum -> spring inertia. Low momentum snaps to the cursor; high
    // momentum lets the trail head lag and follow through with weight.
    const t = mouseTarget.current;
    const stiffness = 60 - params.momentum * 45; // 60 (snappy) .. 15 (heavy)
    const damping = 7 - params.momentum * 3.2;
    vel.current.x += (t.x - smooth.current.x) * stiffness * dt;
    vel.current.y += (t.y - smooth.current.y) * stiffness * dt;
    vel.current.x *= Math.max(0, 1 - damping * dt);
    vel.current.y *= Math.max(0, 1 - damping * dt);
    smooth.current.x += vel.current.x * dt;
    smooth.current.y += vel.current.y * dt;

    // age trail — Tail sets how long a point lives
    const ages = u.uTrailAge.value as number[];
    const holdDuration = 0.22 + params.tail * 1.5;
    for (let i = 0; i < TRAIL_N; i++) {
      ages[i] = Math.min(1, ages[i] + dt / holdDuration);
    }

    // speed -> small energy term (extra chroma while moving fast)
    const dvx = smooth.current.x - prev.current.x;
    const dvy = smooth.current.y - prev.current.y;
    prev.current.x = smooth.current.x;
    prev.current.y = smooth.current.y;
    const speed = Math.sqrt(dvx * dvx + dvy * dvy) / dt;
    const targetEnergy = Math.min(speed * 0.35, 1);
    energy.current += (targetEnergy - energy.current) * (1 - Math.exp(-dt * 6));
    if (!Number.isFinite(energy.current)) energy.current = 0;
    u.uEnergy.value = energy.current;

    // spawn a point once the head has travelled far enough
    const sdx = smooth.current.x - lastSpawn.current.x;
    const sdy = (smooth.current.y - lastSpawn.current.y) * (viewport.height / viewport.width);
    const moved = Math.sqrt(sdx * sdx + sdy * sdy);
    if (moved > 0.018) {
      const inv = 1 / Math.max(moved, 1e-4);
      spawnAt(smooth.current.x, smooth.current.y, sdx * inv, sdy * inv);
      lastSpawn.current.x = smooth.current.x;
      lastSpawn.current.y = smooth.current.y;
    }

    // flash: scatter a ring of points at the cursor
    if (burstRequest.current !== lastBurstSeen.current) {
      lastBurstSeen.current = burstRequest.current;
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        spawnAt(
          smooth.current.x + Math.cos(a) * 0.02,
          smooth.current.y + Math.sin(a) * 0.02,
          Math.cos(a),
          Math.sin(a),
        );
      }
    }
  });

  return (
    <mesh scale={[viewport.width, viewport.height, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={mat}
        vertexShader={trailRevealVertex}
        fragmentShader={trailRevealFragment}
        uniforms={uniforms}
      />
    </mesh>
  );
}

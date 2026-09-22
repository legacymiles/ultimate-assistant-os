# Stage & Orbit

The object should feel like it's floating in a photographed studio, not sitting
on a webpage. Three ingredients: **atmosphere** (fog + grain + volumetric key),
**a reflective floor**, and **a camera that's always gently moving**.

## Stage

```tsx
// components/three/Stage.tsx
'use client';
import { Canvas } from '@react-three/fiber';
import { Environment, MeshReflectorMaterial, AdaptiveDpr } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { Suspense } from 'react';

export function Stage({ children }: { children: React.ReactNode }) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 1.4, 6], fov: 38, near: 0.1, far: 60 }}
    >
      {/* Cold studio haze. Tune `near`/`far` so fog hugs the object. */}
      <color attach="background" args={['#0a0c10']} />
      <fog attach="fog" args={['#0a0c10', 8, 22]} />

      {/* Key + rim. Rim (cold) reads the silhouette; key (warm) is the hero light. */}
      <ambientLight intensity={0.15} />
      <spotLight
        position={[4, 8, 5]} angle={0.5} penumbra={0.8}
        intensity={140} color="#fff4e6" castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002}
      />
      <spotLight position={[-6, 3, -4]} angle={0.7} penumbra={1} intensity={60} color="#5ec8ff" />
      {/* Image-based lighting gives metals something to reflect. */}
      <Environment preset="city" environmentIntensity={0.35} />

      <Suspense fallback={null}>{children}</Suspense>

      <ReflectiveFloor />

      <EffectComposer enableNormalPass={false}>
        <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.85} luminanceSmoothing={0.2} />
        <Vignette eskil={false} offset={0.25} darkness={0.85} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
      <AdaptiveDpr pixelated />
    </Canvas>
  );
}

function ReflectiveFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, 0]} receiveShadow>
      <planeGeometry args={[60, 60]} />
      <MeshReflectorMaterial
        resolution={1024} mixBlur={1} mixStrength={12} blur={[400, 100]}
        roughness={0.9} depthScale={1.1} minDepthThreshold={0.4} maxDepthThreshold={1.2}
        color="#0a0c10" metalness={0.6} mirror={0}
      />
    </mesh>
  );
}
```

Notes:
- `intensity={140}` looks huge — that's correct for R3F's physically-based
  lights at these distances. Tune to taste; the object should have a bright hot
  edge and deep shadow.
- Keep post minimal. Bloom + tone-mapping + vignette carries the "cinematic"
  look. Adding SSAO/DOF too early tanks the framerate for little gain — add DOF
  only for the isolate-a-part moment if you want it.

## Camera rig: auto-orbit + pointer parallax

The camera is never still. It slowly circles and leans toward the pointer, which
is what makes a static object feel alive. During the scroll transition this same
rig hands control to the scroll timeline (see `scroll-transition.md`).

```tsx
// components/three/CameraRig.tsx
'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

export function CameraRig({
  radius = 6, height = 1.4, autoOrbit = true, target = [0, 0.2, 0], enabled = true,
}: {
  radius?: number; height?: number; autoOrbit?: boolean;
  target?: [number, number, number]; enabled?: boolean;
}) {
  const angle = useRef(0);
  const pointer = useRef(new THREE.Vector2());
  const tgt = new THREE.Vector3(...target);

  useFrame((state, dt) => {
    if (!enabled) return;                 // scroll timeline owns the camera when false
    if (autoOrbit) angle.current += dt * 0.12;

    // Pointer parallax: lerp toward the mouse so it feels weighted, not glued.
    pointer.current.lerp(state.pointer, 0.05);
    const px = pointer.current.x * 0.6;
    const py = pointer.current.y * 0.3;

    const x = Math.sin(angle.current + px) * radius;
    const z = Math.cos(angle.current + px) * radius;
    state.camera.position.lerp(new THREE.Vector3(x, height + py, z), 0.06);
    state.camera.lookAt(tgt);
  });

  return null;
}
```

Pair it with a subtle idle "breath" on the object itself (a tiny sinusoidal
bob) so even the hero mesh isn't perfectly static — see the idle-life note in
`exploded-view.md`.

## Reduced motion

When `prefers-reduced-motion` is set, pass `autoOrbit={false}` and `enabled`
still true but freeze the angle, OR drop the rig entirely and set a good fixed
three-quarter camera. The object must be fully legible without any camera
movement.

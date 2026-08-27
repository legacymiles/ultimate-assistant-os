"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, MeshReflectorMaterial, AdaptiveDpr } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Suspense, useEffect, useRef } from "react";
import * as THREE from "three";
import { useKart, PHASE } from "@/lib/kart/store";
import { COLORS } from "./materials";
import { KartModel } from "./KartModel";
import { RideScene } from "./RideScene";
import { CameraController } from "./CameraController";

export function Scene() {
  return (
    <Canvas
      shadows
      dpr={[1, 1.8]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 1.25, 5.3], fov: 40, near: 0.05, far: 120 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      onPointerMissed={() => useKart.getState().setIsolated(null)}
    >
      <Atmosphere />

      <ambientLight intensity={0.16} />
      <spotLight
        position={[4, 7, 5]} angle={0.5} penumbra={0.85} intensity={130}
        color="#fff3e4" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002}
      />
      <spotLight position={[-6, 3, -4]} angle={0.7} penumbra={1} intensity={55} color={COLORS.cyan} />

      <Suspense fallback={null}>
        <Environment resolution={256}>
          <Lightformer intensity={2} position={[0, 4, 3]} scale={[8, 3, 1]} color="#fff2e0" />
          <Lightformer intensity={1.4} position={[-4, 1, -3]} scale={[3, 6, 1]} color={COLORS.cyan} />
          <Lightformer intensity={1.2} position={[4, 1, -2]} scale={[3, 6, 1]} color={COLORS.heat} />
        </Environment>

        <KartModel />
        <RideScene />
        <ShowcaseFloor />
      </Suspense>

      <CameraController />
      <Readiness />

      <EffectComposer>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.72} luminanceSmoothing={0.25} />
        <Vignette eskil={false} offset={0.28} darkness={0.9} />
      </EffectComposer>
      <AdaptiveDpr pixelated />
    </Canvas>
  );
}

function Atmosphere() {
  const fog = useRef<THREE.FogExp2>(null!);
  const { scene } = useThree();
  const cold = new THREE.Color(COLORS.stage);
  const dusk = new THREE.Color("#12060f");
  const tmp = new THREE.Color();

  useEffect(() => {
    scene.background = cold.clone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    const p = useKart.getState().progress;
    const t = THREE.MathUtils.smoothstep(p, PHASE.diveStart, PHASE.diveEnd + 0.08);
    // Fade back to cold during outro
    const outroFade = THREE.MathUtils.smoothstep(p, PHASE.outroStart, 0.95);
    tmp.copy(cold).lerp(dusk, t * (1 - outroFade * 0.6));
    if (scene.background instanceof THREE.Color) scene.background.copy(tmp);
    if (fog.current) {
      fog.current.color.copy(tmp);
      fog.current.density = THREE.MathUtils.lerp(0.05, 0.028, t);
    }
  });

  return <fogExp2 ref={fog} attach="fog" args={[COLORS.stage, 0.05]} />;
}

function ShowcaseFloor() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(() => {
    if (ref.current) ref.current.visible = useKart.getState().progress < PHASE.diveEnd;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.62, 0]} receiveShadow>
      <planeGeometry args={[60, 60]} />
      <MeshReflectorMaterial
        resolution={1024} mixBlur={1} mixStrength={10} blur={[300, 90]}
        roughness={0.9} depthScale={1.1} minDepthThreshold={0.4} maxDepthThreshold={1.2}
        color="#080a0e" metalness={0.6} mirror={0}
      />
    </mesh>
  );
}

function Readiness() {
  const set = useKart((s) => s.setReady);
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 3) set(true);
  });
  return null;
}

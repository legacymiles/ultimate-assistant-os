"use client";

// ---------------------------------------------------------------------------
// The Forge — the crucible, wired to the three lanes.
//
// Blender owns the asset (tools/forge-crucible/build.py). This owns the
// response: the three ingots' emission is driven by real lane state, so the
// sculpture is a readout rather than decoration. An ingot burning is a lane
// thinking; an ingot held at half heat is a lane stopped at a gate; a dark
// ingot is a lane finished, and a cracked grey one is a lane that died.
//
// Two rules this file keeps, both of which the hub has been bitten by before:
//
//   NOTHING ANIMATES THROUGH REACT STATE. Heat is a target written into a ref
//   and eased inside useFrame, so a lane thinking at 450ms poll intervals does
//   not re-render a React tree sixty times a second.
//
//   The rest transforms are IMMUTABLE. Every frame derives from the imported
//   values rather than mutating them cumulatively, because a drifting rest pose
//   is a bug that only shows up after a few minutes and cannot be reproduced.
// ---------------------------------------------------------------------------

import { Canvas, useFrame } from "@react-three/fiber";
import { AdaptiveDpr, Environment, Lightformer, useGLTF } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

const MODEL = "/models/forge-crucible.glb";

/** The Forge palette, the same hexes the Blender build used. */
export const FORGE = {
  ground: "#0B0E11",
  steel: "#3A4049",
  steelLight: "#8A939E",
  cyan: "#4FD8E8",
  molten: "#FF6B14",
};

const HOT = new THREE.Color(FORGE.molten);
const COLD = new THREE.Color("#171A1F");
const DEAD = new THREE.Color("#2A1416");

export interface ForgeLaneState {
  /** 0 = cold and dark, 1 = pouring. */
  heat: number;
  /** A lane that died. Its ingot goes to ash rather than to cold metal. */
  failed: boolean;
  /** The lane the pointer is over, which lifts its ingot slightly. */
  hovered: boolean;
}

/** Ease a value toward a target at a rate that does not depend on frame rate. */
function approach(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.damp(current, target, lambda, dt);
}

function Crucible({ lanes }: { lanes: ForgeLaneState[] }) {
  const { scene } = useGLTF(MODEL);

  /**
   * Root, meshes and materials from ONE memo.
   *
   * This was three memos — clone the scene, find the ingots, clone their
   * materials — and it rendered a bright ingot while the frame loop dutifully
   * drove a cold one. React invokes a memo factory twice in development, so the
   * second pass cloned a second set of materials and assigned THOSE to the
   * meshes, while the kept result was the first pass's set. The renderer drew
   * one object and the animation mutated another.
   *
   * Deriving everything in a single memo makes that impossible: whichever pass
   * React keeps, its root, its meshes and its materials are the same pass's.
   * (The clone is still needed — useGLTF caches the scene, and mutating the
   * cached one leaks a hot ingot into every later mount.)
   */
  const rig = useMemo(() => {
    const root = scene.clone(true);

    const ingots = [1, 2, 3].map(
      (i) => root.getObjectByName(`ingot_${i}`) as THREE.Mesh | undefined,
    );
    const ingotMats = ingots.map((mesh) => {
      if (!mesh) return null;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mesh.material = mat;
      return mat;
    });

    const molten: THREE.MeshStandardMaterial[] = [];
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !/pour_|melt/.test(mesh.name)) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat || Array.isArray(mat)) return;
      const own = mat.clone();
      mesh.material = own;
      molten.push(own);
    });

    const rest = ingots.map((m) => (m ? m.position.clone() : new THREE.Vector3()));
    return { root, ingots, ingotMats, molten, rest };
  }, [scene]);

  const heat = useRef<number[]>([0, 0, 0]);
  const lift = useRef<number[]>([0, 0, 0]);
  const pour = useRef(0);
  const colour = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    // A tab that was hidden hands back a huge delta; easing against it snaps
    // every ingot to its target in one frame, which reads as a glitch.
    const dt = Math.min(delta, 0.05);

    let anyHot = 0;
    for (let i = 0; i < 3; i += 1) {
      const lane = lanes[i];
      // With no run in progress the three ingots would sit dark and identical,
      // and the hero would read as broken — which is exactly how it looks on
      // the deployed hub, where the local agent is never running. So at rest
      // the forge keeps pouring: three ingots cycling through the same states a
      // real run puts them in, slowly and out of phase. It is the state model
      // demonstrating itself, not decoration, and a real run overrides it on
      // the first frame.
      const idle = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 0.5 - i * 2.1);
      const targetHeat = lane ? lane.heat : idle * idle;
      const targetLift = lane?.hovered ? 0.09 : 0;
      heat.current[i] = approach(heat.current[i], targetHeat, 3.2, dt);
      lift.current[i] = approach(lift.current[i], targetLift, 9, dt);
      anyHot = Math.max(anyHot, targetHeat);

      const mat = rig.ingotMats[i];
      const mesh = rig.ingots[i];
      if (!mat || !mesh) continue;

      const h = heat.current[i];
      const base = lane?.failed ? DEAD : COLD;
      colour.copy(base).lerp(HOT, h);
      mat.emissive.copy(colour);
      // A breathing wobble only while it is actually hot, so a finished lane is
      // visibly still rather than quietly pulsing.
      const breathe = h > 0.02 ? 1 + Math.sin(state.clock.elapsedTime * 2.1 + i * 1.7) * 0.07 : 1;
      mat.emissiveIntensity = h * 1.9 * breathe;
      mat.color.copy(colour).multiplyScalar(0.3 + h * 0.7);

      const r = rig.rest[i];
      mesh.position.set(r.x, r.y, r.z + lift.current[i]);
    }

    // The pour follows the hottest lane: nothing running, nothing flows.
    pour.current = approach(pour.current, anyHot, 2.4, dt);
    for (const mat of rig.molten) {
      mat.emissiveIntensity = 0.08 + pour.current * 1.05;
      mat.color.setRGB(0.22 + pour.current * 0.78, 0.09 + pour.current * 0.33, 0.05);
    }
  });

  return <primitive object={rig.root} />;
}

function Rig() {
  return (
    <>
      {/* Hard rim in near-darkness — the Forge direction's light, rebuilt for
          the browser. Cycles lighting does not travel through glTF. */}
      <ambientLight intensity={0.09} />
      <spotLight
        position={[-3.4, 3.4, 3.0]}
        angle={0.55}
        penumbra={0.9}
        intensity={90}
        color="#C2D0E8"
      />
      <spotLight position={[3.0, 2.4, -3.2]} angle={0.7} penumbra={1} intensity={55} color={FORGE.cyan} />
      <Environment resolution={128}>
        <Lightformer intensity={0.6} position={[0, 4, 2]} scale={[6, 2, 1]} color="#9FB2CC" />
        <Lightformer intensity={0.9} position={[-3, 1, 2]} scale={[2, 4, 1]} color={FORGE.cyan} />
      </Environment>
    </>
  );
}

export function Forge({
  lanes,
  reduced = false,
}: {
  lanes: ForgeLaneState[];
  reduced?: boolean;
}) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 1.9, 7.2], fov: 34, near: 0.1, far: 60 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
      }}
      // The console beside this is the point of the screen; the canvas must
      // never swallow a click meant for a lane.
      style={{ pointerEvents: "none" }}
      frameloop={reduced ? "demand" : "always"}
    >
      <Rig />
      <Suspense fallback={null}>
        <group position={[0, -1.35, 0]}>
          <Crucible lanes={lanes} />
        </group>
      </Suspense>
      <EffectComposer>
        <Bloom mipmapBlur intensity={0.7} luminanceThreshold={0.55} luminanceSmoothing={0.3} />
        <Vignette eskil={false} offset={0.3} darkness={0.85} />
      </EffectComposer>
      <AdaptiveDpr pixelated />
    </Canvas>
  );
}

useGLTF.preload(MODEL);

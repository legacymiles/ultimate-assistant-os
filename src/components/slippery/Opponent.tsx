"use client";
// The opponent: a rigged humanoid (three.js Xbot mannequin) given a dark oiled body
// and DRESSED as an original character in the "opulent oiled bruiser" look — open
// black silk robe, gold chains + pendant, waist sash, dark shorts, gold watch — and
// holding a bottle of baby oil in each hand. Torso clothing is body-fitted geometry
// on the root (world-scaled, stays glued to the torso); the watch + oil bottles are
// attached to the actual hand/forearm BONES so they move with the animation. He runs
// idle → walk → run based on his speed. Original figure, not a real-person likeness.

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { ARENA } from "@/lib/slippery/config";
import type { OpponentState } from "@/lib/slippery/ai";

const MODEL = "/models/opponent.glb";
useGLTF.preload(MODEL);

const FACING_OFFSET = 0; // model faces +Z; sim's `facing` maps +Z to movement dir
const TARGET_HEIGHT = 1.95;

// --- baby-oil bottle + watch, built imperatively so they can be parented to bones ---
function buildOilBottle(): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: "#f4f2ee", roughness: 0.3, metalness: 0.05 });
  const pink = new THREE.MeshStandardMaterial({ color: "#f5c6d0", roughness: 0.4 });
  const cap = new THREE.MeshStandardMaterial({ color: "#e8e6e2", roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.14, 16), white);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.055, 16), pink);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.035, 12), cap);
  top.position.y = 0.088;
  g.add(body, label, top);
  return g;
}

function buildWatch(): THREE.Group {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: "#e6c583", metalness: 0.95, roughness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: "#0a0a0c", roughness: 0.2, metalness: 0.6 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 10, 24), gold);
  band.rotation.y = Math.PI / 2;
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 20), dark);
  face.rotation.z = Math.PI / 2;
  face.position.x = 0.045;
  g.add(band, face);
  return g;
}

function disposeDeep(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    }
  });
}

export function Opponent({ stateRef }: { stateRef: MutableRefObject<OpponentState> }) {
  const root = useRef<THREE.Group>(null);
  const gltf = useGLTF(MODEL);
  const { actions } = useAnimations(gltf.animations, root);
  const current = useRef<string>("idle");

  const skin = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#2a1b12",
        roughness: 0.22,
        metalness: 0.5,
        emissive: new THREE.Color("#0a0503"),
      }),
    [],
  );

  // scale + oiled skin + attach bone-mounted props (bottles, watch)
  useEffect(() => {
    const s = gltf.scene;
    s.scale.setScalar(1);
    s.position.set(0, 0, 0);
    let box = new THREE.Box3().setFromObject(s);
    const size = new THREE.Vector3();
    box.getSize(size);
    s.scale.setScalar(TARGET_HEIGHT / (size.y || 1));
    box = new THREE.Box3().setFromObject(s);
    s.position.y -= box.min.y;
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = skin;
        m.frustumCulled = false;
        m.castShadow = false;
      }
    });

    s.updateMatrixWorld(true);
    const attached: { parent: THREE.Object3D; child: THREE.Object3D }[] = [];
    // GLTFLoader strips reserved chars (":", ".") from names, so match by suffix.
    const norm = (n: string) => n.replace(/[:.\s]/g, "").toLowerCase();
    const findBone = (suffix: string) => {
      let hit: THREE.Object3D | null = null;
      const want = suffix.toLowerCase();
      s.traverse((o) => {
        if (!hit && o.name && norm(o.name).endsWith(want)) hit = o;
      });
      return hit as THREE.Object3D | null;
    };
    const attach = (suffix: string, obj: THREE.Object3D) => {
      const bone = findBone(suffix);
      if (!bone) return;
      const ws = new THREE.Vector3();
      bone.getWorldScale(ws);
      obj.scale.setScalar(1 / (ws.x || 1)); // bones are cm-scaled; counter it → meters
      bone.add(obj);
      attached.push({ parent: bone, child: obj });
    };
    attach("righthand", buildOilBottle());
    attach("lefthand", buildOilBottle());
    attach("rightforearm", buildWatch());

    return () =>
      attached.forEach((a) => {
        a.parent.remove(a.child);
        disposeDeep(a.child);
      });
  }, [gltf.scene, skin]);

  useEffect(() => {
    actions.idle?.reset().fadeIn(0.2).play();
    return () => void actions.idle?.fadeOut(0.2);
  }, [actions]);

  const play = (name: "idle" | "walk" | "run") => {
    if (current.current === name || !actions[name]) return;
    actions[current.current]?.fadeOut(0.22);
    actions[name]?.reset().fadeIn(0.22).play();
    current.current = name;
  };

  useFrame(() => {
    const st = stateRef.current;
    const g = root.current;
    if (!g) return;
    g.position.set(st.pos.x, 0, st.pos.z);
    g.rotation.y = st.facing + FACING_OFFSET;

    if (st.speed < 0.4) play("idle");
    else if (st.speed < 3.6) play("walk");
    else play("run");
    const run = actions.run;
    if (run) run.timeScale = THREE.MathUtils.clamp(st.speed / 5.5, 0.7, 1.5);
  });

  return (
    <group ref={root} position={[ARENA.opponentSpawn.x, 0, ARENA.opponentSpawn.z]}>
      <pointLight position={[0, 3.2, 1.3]} intensity={9} distance={9} color="#ffe4bd" />
      <primitive object={gltf.scene} />

      {/* --- open black silk robe (body-fitted, stays on the torso) --- */}
      {/* shoulder yoke + short sleeves */}
      <mesh position={[0, 1.56, -0.02]} rotation={[0.12, 0, 0]}>
        <boxGeometry args={[0.52, 0.2, 0.36]} />
        <meshStandardMaterial color="#08080a" roughness={0.28} metalness={0.45} />
      </mesh>
      <mesh position={[0.28, 1.48, 0]}>
        <boxGeometry args={[0.16, 0.34, 0.34]} />
        <meshStandardMaterial color="#08080a" roughness={0.28} metalness={0.45} />
      </mesh>
      <mesh position={[-0.28, 1.48, 0]}>
        <boxGeometry args={[0.16, 0.34, 0.34]} />
        <meshStandardMaterial color="#08080a" roughness={0.28} metalness={0.45} />
      </mesh>
      {/* back panel */}
      <mesh position={[0, 1.18, -0.16]}>
        <boxGeometry args={[0.52, 1.15, 0.06]} />
        <meshStandardMaterial color="#08080a" roughness={0.28} metalness={0.45} />
      </mesh>
      {/* open front panels (leave the oiled chest showing between them) */}
      <mesh position={[0.18, 1.12, 0.13]} rotation={[0, 0, -0.08]}>
        <boxGeometry args={[0.2, 1.18, 0.05]} />
        <meshStandardMaterial color="#0a0a0c" roughness={0.26} metalness={0.5} />
      </mesh>
      <mesh position={[-0.18, 1.12, 0.13]} rotation={[0, 0, 0.08]}>
        <boxGeometry args={[0.2, 1.18, 0.05]} />
        <meshStandardMaterial color="#0a0a0c" roughness={0.26} metalness={0.5} />
      </mesh>
      {/* lapels (the V of the open robe) */}
      <mesh position={[0.1, 1.4, 0.15]} rotation={[0, 0, 0.32]}>
        <boxGeometry args={[0.07, 0.5, 0.04]} />
        <meshStandardMaterial color="#101012" roughness={0.25} metalness={0.5} />
      </mesh>
      <mesh position={[-0.1, 1.4, 0.15]} rotation={[0, 0, -0.32]}>
        <boxGeometry args={[0.07, 0.5, 0.04]} />
        <meshStandardMaterial color="#101012" roughness={0.25} metalness={0.5} />
      </mesh>

      {/* --- gold chains + pendant --- */}
      <mesh position={[0, 1.5, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.12, 0.014, 10, 28]} />
        <meshStandardMaterial color="#e6c583" metalness={0.95} roughness={0.15} />
      </mesh>
      <mesh position={[0, 1.37, 0.11]} rotation={[1.15, 0, 0]}>
        <torusGeometry args={[0.1, 0.013, 10, 28]} />
        <meshStandardMaterial color="#d9b878" metalness={0.95} roughness={0.15} />
      </mesh>
      <mesh position={[0, 1.28, 0.16]}>
        <boxGeometry args={[0.08, 0.1, 0.03]} />
        <meshStandardMaterial color="#e6c583" metalness={0.95} roughness={0.15} />
      </mesh>

      {/* --- waist sash + hanging ties --- */}
      <mesh position={[0, 0.96, 0.06]}>
        <boxGeometry args={[0.44, 0.1, 0.34]} />
        <meshStandardMaterial color="#050506" roughness={0.3} metalness={0.4} />
      </mesh>
      <mesh position={[0.06, 0.8, 0.2]}>
        <boxGeometry args={[0.05, 0.34, 0.04]} />
        <meshStandardMaterial color="#050506" roughness={0.3} metalness={0.4} />
      </mesh>
      <mesh position={[-0.04, 0.78, 0.2]}>
        <boxGeometry args={[0.05, 0.38, 0.04]} />
        <meshStandardMaterial color="#050506" roughness={0.3} metalness={0.4} />
      </mesh>

      {/* --- dark shorts --- */}
      <mesh position={[0, 0.74, 0]}>
        <boxGeometry args={[0.4, 0.42, 0.32]} />
        <meshStandardMaterial color="#0c0c10" roughness={0.35} metalness={0.3} />
      </mesh>
    </group>
  );
}

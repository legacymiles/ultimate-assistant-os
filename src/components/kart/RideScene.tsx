"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useKart, PHASE } from "@/lib/kart/store";
import { COLORS } from "./materials";

const ARCHES = 36;
const ARCH_SPACING = 3.6;
const PYLONS = 40;
const PYLON_SPACING = 2.4;
const DASHES = 60;
const DASH_SPACING = 1.6;
const STREAKS = 90;
const GATES = 8;
const GATE_SPACING = 18;
const FLOATERS = 12;

const dummy = new THREE.Object3D();
const cArch = new THREE.Color();

function travelOf(progress: number) {
  return THREE.MathUtils.clamp((progress - PHASE.rideStart) / (PHASE.rideEnd - PHASE.rideStart), 0, 1) * 420;
}
function wrap(v: number, len: number) {
  return ((v % len) + len) % len;
}

export function RideScene() {
  const group = useRef<THREE.Group>(null!);
  const arches = useRef<THREE.InstancedMesh>(null!);
  const pylonsL = useRef<THREE.InstancedMesh>(null!);
  const pylonsR = useRef<THREE.InstancedMesh>(null!);
  const dashes = useRef<THREE.InstancedMesh>(null!);
  const streaks = useRef<THREE.InstancedMesh>(null!);
  const gates = useRef<THREE.InstancedMesh>(null!);
  const floaters = useRef<THREE.InstancedMesh>(null!);
  const floorMat = useRef<THREE.MeshStandardMaterial>(null!);

  const streakData = useMemo(
    () =>
      Array.from({ length: STREAKS }, () => ({
        x: (Math.random() - 0.5) * 8,
        y: 0.1 + Math.random() * 3.5,
        z: Math.random() * 80,
        len: 2 + Math.random() * 6,
      })),
    [],
  );

  const floaterData = useMemo(
    () =>
      Array.from({ length: FLOATERS }, (_, i) => ({
        x: (i % 2 === 0 ? -1 : 1) * (1.5 + Math.random() * 2),
        y: 0.5 + Math.random() * 2,
        z: i * 14 + Math.random() * 6,
        rotSpeed: 0.5 + Math.random() * 2,
        scale: 0.15 + Math.random() * 0.2,
      })),
    [],
  );

  useFrame((state, dt) => {
    const { progress, velocity, reducedMotion, setDrive } = useKart.getState();
    const visible = progress > PHASE.rideStart - 0.02;
    if (group.current) group.current.visible = visible;
    if (!visible) return;

    const rideNorm = THREE.MathUtils.smoothstep(progress, PHASE.rideStart, PHASE.rideStart + 0.1);
    const travel = travelOf(progress);
    const speed = Math.min(Math.abs(velocity) * 0.7, 60);

    // Fade out during outro
    const outroFade = 1 - THREE.MathUtils.smoothstep(progress, PHASE.outroStart, PHASE.outroStart + 0.06);

    const kph = Math.round((60 + rideNorm * 120 + speed * 4) * outroFade);
    const gear = Math.min(6, 1 + Math.floor((kph / 260) * 6));
    setDrive(kph, gear);

    // ---- arches ----
    if (arches.current) {
      const L = ARCHES * ARCH_SPACING;
      for (let i = 0; i < ARCHES; i++) {
        const z = wrap(i * ARCH_SPACING - travel, L);
        dummy.position.set(0, 1.4, z + 0.2);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        const pulse = reducedMotion ? 1 : 1 + Math.sin(state.clock.elapsedTime * 2 + i * 0.5) * 0.03;
        const s = (1 - Math.min(z / L, 1) * 0.1) * pulse;
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        arches.current.setMatrixAt(i, dummy.matrix);
        const hue = (i / ARCHES + state.clock.elapsedTime * 0.02) % 1;
        cArch.set(hue < 0.5 ? COLORS.duskB : COLORS.duskA);
        arches.current.setColorAt(i, cArch);
      }
      arches.current.instanceMatrix.needsUpdate = true;
      if (arches.current.instanceColor) arches.current.instanceColor.needsUpdate = true;
    }

    // ---- side pylons ----
    const doPylons = (mesh: THREE.InstancedMesh | null, side: number) => {
      if (!mesh) return;
      const L = PYLONS * PYLON_SPACING;
      for (let i = 0; i < PYLONS; i++) {
        const z = wrap(i * PYLON_SPACING - travel, L);
        const heightPulse = reducedMotion ? 1.2 : 1.2 + Math.sin(state.clock.elapsedTime * 3 + i) * 0.3;
        dummy.position.set(side * 3.4, heightPulse * 0.5, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, heightPulse, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const brightness = 0.5 + Math.sin(z * 0.1 + state.clock.elapsedTime * 4) * 0.5;
        cArch.set(side < 0 ? COLORS.duskA : COLORS.duskB);
        cArch.multiplyScalar(0.5 + brightness * 0.5);
        mesh.setColorAt(i, cArch);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    doPylons(pylonsL.current, -1);
    doPylons(pylonsR.current, 1);

    // ---- center-line dashes ----
    if (dashes.current) {
      const L = DASHES * DASH_SPACING;
      for (let i = 0; i < DASHES; i++) {
        const z = wrap(i * DASH_SPACING - travel, L);
        dummy.position.set(0, 0.02, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        dashes.current.setMatrixAt(i, dummy.matrix);
      }
      dashes.current.instanceMatrix.needsUpdate = true;
    }

    // ---- speed streaks ----
    if (streaks.current) {
      const t = state.clock.elapsedTime;
      const active = reducedMotion ? 0 : Math.min(speed / 20 + rideNorm * 0.4, 1);
      for (let i = 0; i < STREAKS; i++) {
        const d = streakData[i];
        const z = wrap(d.z - travel * 2 - t * (6 + speed), 80);
        dummy.position.set(d.x, d.y, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, d.len * active);
        dummy.updateMatrix();
        streaks.current.setMatrixAt(i, dummy.matrix);
      }
      streaks.current.instanceMatrix.needsUpdate = true;
      const sm = streaks.current.material as THREE.MeshBasicMaterial;
      sm.opacity = 0.35 * active * outroFade;
    }

    // ---- checkpoint gates ----
    if (gates.current) {
      const L = GATES * GATE_SPACING;
      for (let i = 0; i < GATES; i++) {
        const z = wrap(i * GATE_SPACING - travel, L);
        dummy.position.set(0, 1.6, z);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        const gateScale = 1.4 + Math.sin(state.clock.elapsedTime * 1.5 + i * 2) * 0.1;
        dummy.scale.setScalar(gateScale);
        dummy.updateMatrix();
        gates.current.setMatrixAt(i, dummy.matrix);
        const gateColor = i % 2 === 0 ? "#ff5a1f" : "#57c8ff";
        cArch.set(gateColor);
        gates.current.setColorAt(i, cArch);
      }
      gates.current.instanceMatrix.needsUpdate = true;
      if (gates.current.instanceColor) gates.current.instanceColor.needsUpdate = true;
    }

    // ---- floating kart parts (interactive moving pieces) ----
    if (floaters.current) {
      const t = state.clock.elapsedTime;
      const L = FLOATERS * 14;
      for (let i = 0; i < FLOATERS; i++) {
        const d = floaterData[i];
        const z = wrap(d.z - travel * 0.8, L);
        const bobY = d.y + Math.sin(t * d.rotSpeed + i) * 0.3;
        dummy.position.set(d.x, bobY, z);
        dummy.rotation.set(t * d.rotSpeed, t * d.rotSpeed * 0.7, t * d.rotSpeed * 0.3);
        dummy.scale.setScalar(d.scale * rideNorm);
        dummy.updateMatrix();
        floaters.current.setMatrixAt(i, dummy.matrix);
        cArch.set(i % 3 === 0 ? COLORS.heat : i % 3 === 1 ? COLORS.cyan : "#ffffff");
        cArch.multiplyScalar(0.6);
        floaters.current.setColorAt(i, cArch);
      }
      floaters.current.instanceMatrix.needsUpdate = true;
      if (floaters.current.instanceColor) floaters.current.instanceColor.needsUpdate = true;
    }

    if (floorMat.current) {
      floorMat.current.opacity = rideNorm * outroFade;
    }
  });

  return (
    <group ref={group} visible={false}>
      <pointLight position={[0, 3, 6]} intensity={30} distance={30} color={COLORS.duskB} />
      <pointLight position={[0, 1, 2]} intensity={16} distance={16} color={COLORS.duskA} />
      <pointLight position={[0, 2, 20]} intensity={20} distance={40} color={COLORS.heat} />

      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 40]}>
        <planeGeometry args={[16, 440]} />
        <meshStandardMaterial
          ref={floorMat}
          color="#05070c"
          metalness={0.85}
          roughness={0.35}
          transparent
          opacity={0}
        />
      </mesh>

      {/* tunnel arches */}
      <instancedMesh ref={arches} args={[undefined, undefined, ARCHES]}>
        <torusGeometry args={[2.6, 0.045, 8, 40, Math.PI * 1.15]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* side pylons */}
      <instancedMesh ref={pylonsL} args={[undefined, undefined, PYLONS]}>
        <boxGeometry args={[0.08, 1.2, 0.08]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={pylonsR} args={[undefined, undefined, PYLONS]}>
        <boxGeometry args={[0.08, 1.2, 0.08]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* center dashes */}
      <instancedMesh ref={dashes} args={[undefined, undefined, DASHES]}>
        <boxGeometry args={[0.14, 0.02, 0.7]} />
        <meshBasicMaterial color={COLORS.cyan} toneMapped={false} />
      </instancedMesh>

      {/* speed streaks */}
      <instancedMesh ref={streaks} args={[undefined, undefined, STREAKS]}>
        <boxGeometry args={[0.02, 0.02, 1]} />
        <meshBasicMaterial color="#eaf6ff" transparent opacity={0} toneMapped={false} />
      </instancedMesh>

      {/* checkpoint gates */}
      <instancedMesh ref={gates} args={[undefined, undefined, GATES]}>
        <torusGeometry args={[3.2, 0.06, 8, 32, Math.PI * 1.1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* floating kart parts — spinning shapes alongside the tunnel */}
      <instancedMesh ref={floaters} args={[undefined, undefined, FLOATERS]}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial metalness={0.9} roughness={0.2} transparent opacity={0.7} />
      </instancedMesh>
    </group>
  );
}

"use client";
/**
 * The kart — fully original, built from primitives, and never still.
 * Suspension bobs, front wheels make idle steering corrections, the engine
 * glow breathes, exhaust particles drift. Crystal hits raise a shield;
 * a 6+ item volley sends it into a backflip stunt.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useArena, arenaFx } from "@/lib/store";
import { wallNow } from "@/lib/math";

const BODY = "#ff6a5e"; // coral
const TRIM = "#fff3e0"; // cream
const DARK = "#22243c";
const GLOW = "#37f5e2"; // teal engine energy

const EXHAUST_COUNT = 60;

export function Kart() {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const wheelFL = useRef<THREE.Group>(null);
  const wheelFR = useRef<THREE.Group>(null);
  const engineMat = useRef<THREE.MeshStandardMaterial>(null);
  const shield = useRef<THREE.Mesh>(null);
  const shieldMat = useRef<THREE.MeshStandardMaterial>(null);
  const exhaust = useRef<THREE.Points>(null);
  const stuntStart = useRef(-1);

  const exhaustData = useMemo(() => {
    const positions = new Float32Array(EXHAUST_COUNT * 3);
    const life = new Float32Array(EXHAUST_COUNT);
    for (let i = 0; i < EXHAUST_COUNT; i++) life[i] = Math.random();
    return { positions, life };
  }, []);

  useFrame((state, dt) => {
    const now = state.clock.elapsedTime;
    const store = useArena.getState();
    if (!root.current || !body.current) return;

    // --- idle life: suspension bob, chassis sway, steering corrections ---
    body.current.position.y = 0.34 + Math.sin(now * 3.1) * 0.022 + Math.sin(now * 7.3) * 0.008;
    body.current.rotation.z = Math.sin(now * 2.2) * 0.012;
    body.current.rotation.x = Math.sin(now * 1.7) * 0.01;
    const steer = Math.sin(now * 0.6) * 0.22 + Math.sin(now * 0.23) * 0.1;
    if (wheelFL.current) wheelFL.current.rotation.y = steer;
    if (wheelFR.current) wheelFR.current.rotation.y = steer;

    // Engine glow breathes; goes hot during any event.
    if (engineMat.current) {
      const eventHot = store.event && wallNow() < store.eventUntil ? 1.6 : 0;
      engineMat.current.emissiveIntensity = 2.2 + Math.sin(now * 5) * 0.7 + eventHot;
    }

    // --- stunt: 6+ volley → jump + backflip with squash & stretch ---
    if (store.event === "stunt" && stuntStart.current < 0) stuntStart.current = now;
    if (stuntStart.current >= 0) {
      const t = (now - stuntStart.current) / 1.6;
      if (t >= 1) {
        stuntStart.current = -1;
        root.current.position.y = 0;
        root.current.rotation.x = 0;
        root.current.scale.setScalar(1);
      } else {
        root.current.position.y = Math.sin(t * Math.PI) * 2.2;
        root.current.rotation.x = -t * Math.PI * 2; // full backflip
        const squash = t < 0.12 ? 1 - t * 1.5 : t > 0.85 ? 1 - (1 - t) * 1.2 : 1.04;
        root.current.scale.set(1 / squash, squash, 1 / squash);
      }
    }

    // Slow idle turntable so every side gets seen.
    root.current.rotation.y = now * 0.1;

    // --- crystal shield ---
    if (shield.current && shieldMat.current) {
      const active = wallNow() < arenaFx.shieldUntil;
      const target = active ? 0.35 + Math.sin(now * 6) * 0.08 : 0;
      shieldMat.current.opacity += (target - shieldMat.current.opacity) * Math.min(1, dt * 8);
      shield.current.visible = shieldMat.current.opacity > 0.01;
      shield.current.scale.setScalar(1 + Math.sin(now * 2.5) * 0.03);
    }

    // --- exhaust particles: emitted from the twin pipes, drift back & up ---
    if (exhaust.current) {
      const pos = exhaustData.positions;
      for (let i = 0; i < EXHAUST_COUNT; i++) {
        exhaustData.life[i] += dt * 0.9;
        if (exhaustData.life[i] > 1) {
          exhaustData.life[i] = 0;
          pos[i * 3] = (i % 2 === 0 ? -0.22 : 0.22) + (Math.random() - 0.5) * 0.05;
          pos[i * 3 + 1] = 0.42;
          pos[i * 3 + 2] = -0.95;
        }
        const l = exhaustData.life[i];
        pos[i * 3 + 1] += dt * (0.5 + l * 0.6);
        pos[i * 3 + 2] -= dt * (0.8 - l * 0.4);
        pos[i * 3] += Math.sin(now * 4 + i) * dt * 0.08;
      }
      exhaust.current.geometry.attributes.position.needsUpdate = true;
      (exhaust.current.material as THREE.PointsMaterial).opacity = 0.5;
    }

    // Publish kart position for launch targeting.
    arenaFx.kartX = root.current.position.x;
    arenaFx.kartY = root.current.position.y + 0.6;
    arenaFx.kartZ = root.current.position.z;
  });

  return (
    <group ref={root} position={[0, 0, 0]}>
      <group ref={body}>
        {/* chassis */}
        <mesh position={[0, 0.1, 0.1]} castShadow>
          <boxGeometry args={[0.9, 0.26, 1.9]} />
          <meshStandardMaterial color={BODY} roughness={0.35} metalness={0.15} />
        </mesh>
        {/* nose cone */}
        <mesh position={[0, 0.08, 1.18]} rotation={[Math.PI / 2.6, 0, 0]}>
          <coneGeometry args={[0.34, 0.6, 4]} />
          <meshStandardMaterial color={BODY} roughness={0.35} metalness={0.15} />
        </mesh>
        {/* cockpit rim */}
        <mesh position={[0, 0.28, -0.05]}>
          <boxGeometry args={[0.62, 0.14, 0.8]} />
          <meshStandardMaterial color={TRIM} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.32, -0.05]}>
          <boxGeometry args={[0.48, 0.1, 0.62]} />
          <meshStandardMaterial color={DARK} roughness={0.2} metalness={0.6} />
        </mesh>
        {/* seat back */}
        <mesh position={[0, 0.46, -0.42]}>
          <boxGeometry args={[0.5, 0.4, 0.12]} />
          <meshStandardMaterial color={BODY} roughness={0.4} />
        </mesh>
        {/* steering wheel */}
        <mesh position={[0, 0.36, 0.36]} rotation={[Math.PI / 3, 0, 0]}>
          <torusGeometry args={[0.13, 0.03, 8, 20]} />
          <meshStandardMaterial color={DARK} roughness={0.3} />
        </mesh>
        {/* rear engine block */}
        <mesh position={[0, 0.28, -0.78]}>
          <boxGeometry args={[0.7, 0.34, 0.42]} />
          <meshStandardMaterial color={DARK} metalness={0.7} roughness={0.3} />
        </mesh>
        {/* engine core — the glowing heart */}
        <mesh position={[0, 0.3, -0.99]}>
          <cylinderGeometry args={[0.12, 0.12, 0.5, 16]} />
          <meshStandardMaterial
            ref={engineMat}
            color={GLOW}
            emissive={GLOW}
            emissiveIntensity={2.2}
            toneMapped={false}
          />
        </mesh>
        {/* twin exhaust pipes */}
        {[-0.22, 0.22].map((x) => (
          <mesh key={x} position={[x, 0.34, -1.02]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.07, 0.09, 0.24, 12]} />
            <meshStandardMaterial color={TRIM} metalness={0.8} roughness={0.25} />
          </mesh>
        ))}
        {/* spoiler */}
        <mesh position={[0, 0.56, -0.85]}>
          <boxGeometry args={[0.86, 0.05, 0.26]} />
          <meshStandardMaterial color={BODY} roughness={0.35} />
        </mesh>
        {[-0.36, 0.36].map((x) => (
          <mesh key={x} position={[x, 0.44, -0.85]}>
            <boxGeometry args={[0.05, 0.22, 0.2]} />
            <meshStandardMaterial color={TRIM} roughness={0.4} />
          </mesh>
        ))}
        {/* front wheels (steer) */}
        <group ref={wheelFL} position={[-0.55, 0, 0.68]}>
          <Wheel />
        </group>
        <group ref={wheelFR} position={[0.55, 0, 0.68]}>
          <Wheel />
        </group>
        {/* rear wheels */}
        <group position={[-0.55, 0, -0.62]}>
          <Wheel big />
        </group>
        <group position={[0.55, 0, -0.62]}>
          <Wheel big />
        </group>
      </group>

      {/* crystal shield */}
      <mesh ref={shield} position={[0, 0.55, 0]} visible={false}>
        <sphereGeometry args={[1.7, 24, 18]} />
        <meshStandardMaterial
          ref={shieldMat}
          color="#b48cff"
          emissive="#8a5cff"
          emissiveIntensity={1.6}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* exhaust particles */}
      <points ref={exhaust}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[exhaustData.positions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          color="#9fe8ff"
          size={0.06}
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

function Wheel({ big = false }: { big?: boolean }) {
  const r = big ? 0.26 : 0.22;
  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0, r, 0]}>
        <torusGeometry args={[r, r * 0.55, 10, 20]} />
        <meshStandardMaterial color="#1a1c2e" roughness={0.85} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0, r, 0]}>
        <cylinderGeometry args={[r * 0.5, r * 0.5, r * 1.3, 12]} />
        <meshStandardMaterial color="#ffd23e" metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

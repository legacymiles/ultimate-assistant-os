"use client";
// The bathroom arena. Everything collidable is driven by the shared layout data
// in config.ts so the visuals can never drift from what the sim collides against.

import { useMemo } from "react";
import { MeshReflectorMaterial } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { ARENA, OBSTACLES, OIL_PATCHES, DECOR, type Obstacle } from "@/lib/slippery/config";

const WALL_H = 5;
const width = ARENA.maxX - ARENA.minX;
const length = ARENA.maxZ - ARENA.minZ;
const cx = (ARENA.minX + ARENA.maxX) / 2;
const cz = (ARENA.minZ + ARENA.maxZ) / 2;

function Marble({ color = "#efe9dd", ...props }: { color?: string } & ThreeElements["meshStandardMaterial"]) {
  return <meshStandardMaterial color={color} roughness={0.35} metalness={0.05} {...props} />;
}

function Bench({ o }: { o: Obstacle }) {
  return (
    <group position={[o.x, 0, o.z]}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[2.0, 0.16, 0.75]} />
        <meshStandardMaterial color="#b8c0c6" roughness={0.5} metalness={0.15} />
      </mesh>
      {[-0.85, 0.85].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]}>
          <boxGeometry args={[0.12, 0.44, 0.7]} />
          <meshStandardMaterial color="#7d868c" roughness={0.4} metalness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Island({ o }: { o: Obstacle }) {
  return (
    <group position={[o.x, 0, o.z]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[2.5, 1.0, 2.5]} />
        <meshStandardMaterial color="#d9d2c4" roughness={0.3} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.02, 0]}>
        <boxGeometry args={[2.7, 0.08, 2.7]} />
        <Marble color="#f6f1e7" />
      </mesh>
    </group>
  );
}

function Tub({ o }: { o: Obstacle }) {
  return (
    <group position={[o.x, 0, o.z]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[2.4, 0.7, 1.4]} />
        <meshStandardMaterial color="#fbfbf8" roughness={0.15} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.62, 0]}>
        <boxGeometry args={[2.0, 0.5, 1.0]} />
        <meshStandardMaterial color="#0f1418" roughness={0.05} metalness={0.6} />
      </mesh>
      {[
        [-1.0, -0.55],
        [1.0, -0.55],
        [-1.0, 0.55],
        [1.0, 0.55],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.1, z]}>
          <cylinderGeometry args={[0.08, 0.1, 0.2, 8]} />
          <meshStandardMaterial color="#c9a26a" metalness={0.8} roughness={0.25} />
        </mesh>
      ))}
    </group>
  );
}

function ObstacleView({ o }: { o: Obstacle }) {
  if (o.kind === "bench") return <Bench o={o} />;
  if (o.kind === "island") return <Island o={o} />;
  if (o.kind === "tub") return <Tub o={o} />;
  return null;
}

function SinkWall() {
  // long counter + basins + mirror along the -X wall
  const basins = [-9, -5, -1, 3, 7];
  return (
    <group position={[ARENA.minX + 0.5, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
      <mesh position={[0, 0.9, 0]}>
        <boxGeometry args={[24, 0.12, 0.9]} />
        <Marble color="#f2ecdf" />
      </mesh>
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[24, 0.9, 0.85]} />
        <meshStandardMaterial color="#cfc7b6" roughness={0.4} />
      </mesh>
      {basins.map((z) => (
        <group key={z} position={[z, 0.9, 0.05]}>
          <mesh position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.28, 0.22, 0.14, 20]} />
            <meshStandardMaterial color="#12161a" roughness={0.1} metalness={0.5} />
          </mesh>
          <mesh position={[0, 0.2, -0.18]}>
            <cylinderGeometry args={[0.03, 0.03, 0.35, 8]} />
            <meshStandardMaterial color="#d9b878" metalness={0.9} roughness={0.2} />
          </mesh>
        </group>
      ))}
      {/* mirror band */}
      <mesh position={[0, 2.2, -0.42]}>
        <planeGeometry args={[23, 1.8]} />
        <meshStandardMaterial color="#8fa6b4" roughness={0.05} metalness={0.9} />
      </mesh>
    </group>
  );
}

function Stalls() {
  // a row of partitions along the +X wall
  const zs = [-11, -6.5, -2, 2.5];
  return (
    <group position={[ARENA.maxX - 1.2, 0, 0]}>
      {zs.map((z) => (
        <group key={z} position={[0, 0, z]}>
          <mesh position={[0, 1.1, 2.1]}>
            <boxGeometry args={[2.2, 2.2, 0.08]} />
            <meshStandardMaterial color="#c7d0d6" roughness={0.45} />
          </mesh>
          <mesh position={[0, 1.1, 0]}>
            <boxGeometry args={[0.06, 2.2, 0.08]} />
            <meshStandardMaterial color="#9aa4ab" roughness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Lockers() {
  return (
    <group>
      {DECOR.lockers.map((l, i) => (
        <mesh key={i} position={[l.x, 1.1, l.z]} castShadow>
          <boxGeometry args={[0.9, 2.2, 1.4]} />
          <meshStandardMaterial color={i % 2 ? "#3f5a6b" : "#476575"} roughness={0.5} metalness={0.25} />
        </mesh>
      ))}
    </group>
  );
}

function SmallProps() {
  return (
    <group>
      {DECOR.trash.map((t, i) => (
        <mesh key={`t${i}`} position={[t.x, 0.35, t.z]}>
          <cylinderGeometry args={[0.3, 0.26, 0.7, 16]} />
          <meshStandardMaterial color="#586066" metalness={0.5} roughness={0.35} />
        </mesh>
      ))}
      {DECOR.bottles.map((b, i) => (
        <mesh key={`b${i}`} position={[b.x, 1.08, b.z]}>
          <cylinderGeometry args={[0.06, 0.07, 0.24, 10]} />
          <meshStandardMaterial color={b.c} roughness={0.2} metalness={0.1} transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function ExitDoor() {
  const d = ARENA.door;
  return (
    <group position={[d.x, 0, ARENA.minZ + 0.06]}>
      {/* frame */}
      <mesh position={[0, 1.6, 0]}>
        <boxGeometry args={[2.6, 3.2, 0.3]} />
        <meshStandardMaterial color="#2a1a10" roughness={0.5} metalness={0.2} />
      </mesh>
      {/* twin doors (walnut, echoing the reference) */}
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 1.5, 0.18]}>
          <boxGeometry args={[1.1, 2.9, 0.1]} />
          <meshStandardMaterial color="#4a2e18" roughness={0.4} metalness={0.15} />
        </mesh>
      ))}
      {/* handles */}
      {[-0.15, 0.15].map((x) => (
        <mesh key={x} position={[x, 1.4, 0.28]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color="#e6c583" metalness={0.95} roughness={0.15} />
        </mesh>
      ))}
      {/* glowing EXIT sign */}
      <mesh position={[0, 3.5, 0.2]}>
        <boxGeometry args={[1.4, 0.5, 0.08]} />
        <meshStandardMaterial color="#08130c" />
      </mesh>
      <mesh position={[0, 3.5, 0.25]}>
        <planeGeometry args={[1.2, 0.34]} />
        <meshBasicMaterial color="#39ff9a" toneMapped={false} />
      </mesh>
      <pointLight position={[0, 3.4, 1.2]} color="#39ff9a" intensity={6} distance={9} />
    </group>
  );
}

export function Arena() {
  // reusable ceiling light-panel positions
  const panels = useMemo(() => {
    const out: [number, number][] = [];
    for (let x = -4; x <= 4; x += 4) for (let z = -12; z <= 12; z += 6) out.push([x, z]);
    return out;
  }, []);

  return (
    <group>
      {/* floor — wet reflective tile */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <MeshReflectorMaterial
          resolution={1024}
          blur={[420, 220]}
          mixBlur={1}
          mixStrength={2.4}
          roughness={0.82}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.2}
          color="#0c0f13"
          metalness={0.65}
        />
      </mesh>

      {/* heavy oil patches — glossy near-black pools you can read on the floor */}
      {OIL_PATCHES.map((p, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.015, p.z]}>
          <circleGeometry args={[p.r, 40]} />
          <meshStandardMaterial
            color="#050607"
            roughness={0.02}
            metalness={0.9}
            transparent
            opacity={0.9}
          />
        </mesh>
      ))}

      {/* walls */}
      <group>
        <mesh position={[cx, WALL_H / 2, ARENA.minZ]}>
          <boxGeometry args={[width, WALL_H, 0.3]} />
          <Marble />
        </mesh>
        <mesh position={[cx, WALL_H / 2, ARENA.maxZ]}>
          <boxGeometry args={[width, WALL_H, 0.3]} />
          <Marble />
        </mesh>
        <mesh position={[ARENA.minX, WALL_H / 2, cz]}>
          <boxGeometry args={[0.3, WALL_H, length]} />
          <Marble color="#e8e2d5" />
        </mesh>
        <mesh position={[ARENA.maxX, WALL_H / 2, cz]}>
          <boxGeometry args={[0.3, WALL_H, length]} />
          <Marble color="#e8e2d5" />
        </mesh>
      </group>

      {/* ceiling + light panels */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[cx, WALL_H, cz]}>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color="#1a1e24" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {panels.map(([x, z], i) => (
        <group key={i}>
          <mesh position={[x, WALL_H - 0.05, z]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[2.4, 1.2]} />
            <meshBasicMaterial color="#dfeaff" toneMapped={false} />
          </mesh>
          <pointLight position={[x, WALL_H - 0.4, z]} intensity={7} distance={12} color="#eaf1ff" />
        </group>
      ))}

      <ExitDoor />
      <SinkWall />
      <Stalls />
      <Lockers />
      <SmallProps />
      {OBSTACLES.map((o, i) => (
        <ObstacleView key={i} o={o} />
      ))}
    </group>
  );
}

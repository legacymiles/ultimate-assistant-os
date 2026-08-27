"use client";
// Procedural geometry for each go-kart part. Built from Three primitives +
// drei's RoundedBox so edges read as machined, not blocky. Each exported piece
// is centered on its own origin so Part.tsx can place/explode it cleanly.

import { RoundedBox } from "@react-three/drei";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MAT, COLORS } from "./materials";
import { useKart } from "@/lib/kart/store";

/* ------------------------------------------------------------------ Wheel */
export function Wheel({ radius = 0.28, width = 0.24 }: { radius?: number; width?: number }) {
  // Axis along X (left-right): rotate the default Y-axis cylinder by 90° on Z.
  return (
    <group rotation={[0, 0, Math.PI / 2]}>
      {/* tyre */}
      <mesh castShadow>
        <cylinderGeometry args={[radius, radius, width, 40]} />
        <meshStandardMaterial {...MAT.rubber} />
      </mesh>
      {/* sidewall bevel */}
      <mesh>
        <cylinderGeometry args={[radius * 0.99, radius * 0.86, width * 1.001, 40]} />
        <meshStandardMaterial {...MAT.rubber} />
      </mesh>
      {/* rim disc */}
      <mesh>
        <cylinderGeometry args={[radius * 0.58, radius * 0.58, width * 1.02, 28]} />
        <meshStandardMaterial {...MAT.rim} />
      </mesh>
      {/* glowing rim ring (bloom catches this) */}
      <mesh position={[0, width * 0.52, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius * 0.6, 0.012, 12, 32]} />
        <meshStandardMaterial {...MAT.accent} />
      </mesh>
      {/* hub */}
      <mesh>
        <cylinderGeometry args={[radius * 0.16, radius * 0.16, width * 1.1, 16]} />
        <meshStandardMaterial {...MAT.chrome} />
      </mesh>
      {/* spokes */}
      {Array.from({ length: 5 }).map((_, i) => (
        <mesh key={i} rotation={[0, (i / 5) * Math.PI * 2, 0]}>
          <boxGeometry args={[radius * 1.0, width * 0.5, 0.03]} />
          <meshStandardMaterial {...MAT.chromeDark} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------- Nose */
export function Nose() {
  return (
    <group scale={[1, 0.72, 1]}>
      {/* cone body pointing +Z */}
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.38, 0.8, 24]} />
        <meshStandardMaterial {...MAT.paint} />
      </mesh>
      {/* cyan racing stripe over the spine */}
      <mesh position={[0, 0.26, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <boxGeometry args={[0.09, 0.7, 0.02]} />
        <meshStandardMaterial {...MAT.accent} />
      </mesh>
      {/* number plate */}
      <mesh position={[0, 0.16, -0.18]} rotation={[-0.5, 0, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.02, 20]} />
        <meshStandardMaterial color="#f4f6fa" metalness={0.1} roughness={0.5} transparent depthWrite />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------ Front bumper */
export function Bumper() {
  return (
    <group>
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.36, 0.028, 14, 32, Math.PI]} />
        <meshStandardMaterial {...MAT.frame} />
      </mesh>
      {/* two rearward connectors */}
      {[-0.28, 0.28].map((x) => (
        <mesh key={x} position={[x, 0, -0.14]}>
          <cylinderGeometry args={[0.022, 0.022, 0.3, 12]} />
          <meshStandardMaterial {...MAT.frame} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------- Seat */
export function Seat() {
  return (
    <group>
      {/* backrest, reclined */}
      <group rotation={[0.32, 0, 0]}>
        <RoundedBox args={[0.52, 0.5, 0.1]} radius={0.05} smoothness={4} position={[0, 0.18, 0]} castShadow>
          <meshStandardMaterial {...MAT.carbon} />
        </RoundedBox>
        {/* side bolsters */}
        {[-0.26, 0.26].map((x) => (
          <RoundedBox key={x} args={[0.06, 0.42, 0.22]} radius={0.03} smoothness={3} position={[x, 0.14, 0.08]}>
            <meshStandardMaterial {...MAT.paintDeep} />
          </RoundedBox>
        ))}
      </group>
      {/* seat pan */}
      <RoundedBox args={[0.5, 0.1, 0.44]} radius={0.05} smoothness={4} position={[0, -0.08, 0.2]} castShadow>
        <meshStandardMaterial {...MAT.carbon} />
      </RoundedBox>
      {/* harness accent */}
      <mesh position={[0, 0.22, 0.05]}>
        <boxGeometry args={[0.34, 0.05, 0.02]} />
        <meshStandardMaterial {...MAT.accent} />
      </mesh>
    </group>
  );
}

/* --------------------------------------------------------------- Steering */
export function Steering() {
  return (
    <group>
      {/* column */}
      <mesh position={[0, -0.16, -0.12]} rotation={[0.7, 0, 0]}>
        <cylinderGeometry args={[0.02, 0.025, 0.5, 12]} />
        <meshStandardMaterial {...MAT.frame} />
      </mesh>
      {/* wheel, tilted toward driver */}
      <group rotation={[-0.9, 0, 0]}>
        <mesh castShadow>
          <torusGeometry args={[0.14, 0.022, 14, 32]} />
          <meshStandardMaterial {...MAT.chromeDark} />
        </mesh>
        {/* grips */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.13, 0, 0]}>
            <torusGeometry args={[0.05, 0.02, 10, 20]} />
            <meshStandardMaterial {...MAT.paint} />
          </mesh>
        ))}
        {/* hub + spokes */}
        <mesh>
          <cylinderGeometry args={[0.04, 0.04, 0.03, 16]} />
          <meshStandardMaterial {...MAT.accent} />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation={[0, 0, (i / 3) * Math.PI * 2]}>
            <boxGeometry args={[0.13, 0.02, 0.01]} />
            <meshStandardMaterial {...MAT.chromeDark} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ----------------------------------------------------------------- Engine */
export function Engine() {
  const glow = useRef<THREE.MeshStandardMaterial>(null!);
  const reduced = useKart((s) => s.reducedMotion);
  useFrame((state) => {
    if (!glow.current) return;
    // Idle "rev": the engine breathes hotter now and then.
    const t = state.clock.elapsedTime;
    const rev = reduced ? 0.6 : 0.6 + Math.pow((Math.sin(t * 1.7) + 1) / 2, 6) * 2.2;
    glow.current.emissiveIntensity += (rev - glow.current.emissiveIntensity) * 0.1;
  });
  return (
    <group>
      {/* block */}
      <RoundedBox args={[0.34, 0.36, 0.4]} radius={0.04} smoothness={3} castShadow>
        <meshStandardMaterial {...MAT.chrome} />
      </RoundedBox>
      {/* cooling fins */}
      {Array.from({ length: 5 }).map((_, i) => (
        <mesh key={i} position={[0, 0.08 + i * 0.05, 0]}>
          <boxGeometry args={[0.38, 0.015, 0.44]} />
          <meshStandardMaterial {...MAT.chromeDark} />
        </mesh>
      ))}
      {/* head */}
      <mesh position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 0.12, 20]} />
        <meshStandardMaterial {...MAT.chromeDark} />
      </mesh>
      {/* combustion glow strip */}
      <mesh position={[0, -0.05, 0.205]}>
        <boxGeometry args={[0.24, 0.14, 0.02]} />
        <meshStandardMaterial {...MAT.heat} ref={glow} />
      </mesh>
      {/* carb */}
      <mesh position={[-0.24, 0.02, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 0.14, 16]} />
        <meshStandardMaterial {...MAT.chromeDark} />
      </mesh>
    </group>
  );
}

/* ---------------------------------------------------------------- Exhaust */
export function Exhaust() {
  return (
    <group rotation={[0, 0, 0]}>
      {/* header from engine */}
      <mesh position={[0, 0.14, 0.34]} rotation={[0.6, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.4, 14]} />
        <meshStandardMaterial {...MAT.chromeDark} />
      </mesh>
      {/* expansion chamber (bulged) */}
      <mesh castShadow position={[0, 0, -0.05]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.12, 0.06, 0.34, 20]} />
        <meshStandardMaterial {...MAT.chromeDark} />
      </mesh>
      <mesh position={[0, 0, 0.16]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.12, 0.14, 20]} />
        <meshStandardMaterial {...MAT.chromeDark} />
      </mesh>
      {/* tail pipe */}
      <mesh position={[0, -0.02, -0.28]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.22, 14]} />
        <meshStandardMaterial {...MAT.frame} />
      </mesh>
    </group>
  );
}

/* -------------------------------------------------------------- Rear wing */
export function Wing() {
  return (
    <group>
      {/* main plane */}
      <RoundedBox args={[0.86, 0.03, 0.22]} radius={0.014} smoothness={3} castShadow>
        <meshStandardMaterial {...MAT.paint} />
      </RoundedBox>
      {/* second element */}
      <RoundedBox args={[0.82, 0.025, 0.12]} radius={0.012} smoothness={3} position={[0, 0.08, -0.12]} rotation={[-0.35, 0, 0]}>
        <meshStandardMaterial {...MAT.paintDeep} />
      </RoundedBox>
      {/* leading-edge glow */}
      <mesh position={[0, 0.005, 0.11]}>
        <boxGeometry args={[0.86, 0.02, 0.012]} />
        <meshStandardMaterial {...MAT.accent} />
      </mesh>
      {/* endplates */}
      {[-0.42, 0.42].map((x) => (
        <mesh key={x} position={[x, 0.02, -0.04]}>
          <boxGeometry args={[0.02, 0.2, 0.3]} />
          <meshStandardMaterial {...MAT.carbon} />
        </mesh>
      ))}
      {/* mounts */}
      {[-0.16, 0.16].map((x) => (
        <mesh key={x} position={[x, -0.2, 0]}>
          <boxGeometry args={[0.03, 0.4, 0.04]} />
          <meshStandardMaterial {...MAT.frame} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------- Floor tray */
export function Floor() {
  return (
    <group>
      {/* main pan */}
      <RoundedBox args={[0.9, 0.06, 2.0]} radius={0.03} smoothness={3} receiveShadow castShadow>
        <meshStandardMaterial {...MAT.carbon} />
      </RoundedBox>
      {/* side pods */}
      {[-0.52, 0.52].map((x) => (
        <RoundedBox key={x} args={[0.14, 0.2, 0.7]} radius={0.06} smoothness={3} position={[x, 0.1, 0.05]}>
          <meshStandardMaterial {...MAT.paint} />
        </RoundedBox>
      ))}
      {/* underglow strip */}
      <mesh position={[0, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.5, 1.6]} />
        <meshBasicMaterial color={COLORS.cyan} transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------- Static chassis skeleton */
// Not a Part — it never explodes. The panels/wheels fly off it, so the
// teardown reads against a visible frame instead of empty air.
export function Frame() {
  return (
    <group>
      {/* two main rails along Z */}
      {[-0.34, 0.34].map((x) => (
        <mesh key={x} position={[x, -0.28, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 1.9, 12]} />
          <meshStandardMaterial {...MAT.frame} />
        </mesh>
      ))}
      {/* cross members */}
      {[0.85, 0.2, -0.4, -0.85].map((z) => (
        <mesh key={z} position={[0, -0.28, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.028, 0.028, 0.75, 12]} />
          <meshStandardMaterial {...MAT.frame} />
        </mesh>
      ))}
      {/* front axle */}
      <mesh position={[0, -0.28, 0.9]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.022, 0.022, 1.2, 12]} />
        <meshStandardMaterial {...MAT.chromeDark} />
      </mesh>
      {/* rear axle */}
      <mesh position={[0, -0.26, -0.84]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 1.4, 14]} />
        <meshStandardMaterial {...MAT.chromeDark} />
      </mesh>
      {/* steering hoop */}
      <mesh position={[0, -0.05, 0.28]} rotation={[0.4, 0, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.5, 10]} />
        <meshStandardMaterial {...MAT.frame} />
      </mesh>
    </group>
  );
}

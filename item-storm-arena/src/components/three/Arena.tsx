"use client";
/**
 * The floating arena and its living world: drifting clouds below,
 * glowing edge ring, floodlight pylons with waving pennants, slow-turning
 * satellite islands, cargo drones on patrol — and an idle secret: leave
 * the cursor alone long enough and a flock of birds crosses the arena.
 * Paint hits temporarily repaint the platform.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { paletteNow } from "./Atmosphere";
import { arenaFx } from "@/lib/store";
import { seededRand, wallNow } from "@/lib/math";

const CLOUDS = 14;
const BIRDS = 5;

export function Arena() {
  const platformMat = useRef<THREE.MeshStandardMaterial>(null);
  const ringMat = useRef<THREE.MeshStandardMaterial>(null);
  const pylonHeads = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const flags = useRef<(THREE.Mesh | null)[]>([]);
  const clouds = useRef<(THREE.Sprite | null)[]>([]);
  const islands = useRef<(THREE.Group | null)[]>([]);
  const drones = useRef<(THREE.Group | null)[]>([]);
  const birds = useRef<THREE.Group>(null);
  const birdFlight = useRef(-1);
  const baseColor = useMemo(() => new THREE.Color("#3a3f63"), []);
  const paintTarget = useMemo(() => new THREE.Color(), []);

  const cloudTexture = useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.6, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }, []);

  const cloudSeeds = useMemo(
    () =>
      Array.from({ length: CLOUDS }, (_, i) => ({
        angle: seededRand(i * 3.1) * Math.PI * 2,
        radius: 7 + seededRand(i * 1.7) * 14,
        y: -2.5 - seededRand(i * 2.3) * 4,
        scale: 4 + seededRand(i * 4.7) * 6,
        speed: 0.01 + seededRand(i * 5.1) * 0.025,
      })),
    []
  );

  useFrame((state, dt) => {
    const now = state.clock.elapsedTime;
    const pal = paletteNow;

    // Platform picks up biome mood — and paint-bomb tint while active.
    if (platformMat.current) {
      const painted = wallNow() < arenaFx.paintUntil;
      if (painted) {
        paintTarget.setRGB(arenaFx.paintColor.r, arenaFx.paintColor.g, arenaFx.paintColor.b);
        platformMat.current.color.lerp(paintTarget, Math.min(1, dt * 6));
      } else {
        platformMat.current.color.lerp(baseColor, Math.min(1, dt * 1.5));
      }
    }
    if (ringMat.current) {
      ringMat.current.emissive.copy(pal.accent);
      ringMat.current.emissiveIntensity = 1.6 + Math.sin(now * 2.1) * 0.5;
    }
    pylonHeads.current.forEach((m, i) => {
      if (m) {
        m.emissive.copy(pal.accent);
        m.emissiveIntensity = 1.8 + Math.sin(now * 3 + i * 1.7) * 0.8;
      }
    });

    // Pennants wave.
    flags.current.forEach((f, i) => {
      if (f) {
        f.rotation.y = Math.sin(now * 3.2 + i * 2.1) * 0.5;
        f.rotation.z = Math.sin(now * 4.1 + i) * 0.12;
      }
    });

    // Clouds drift in slow circles, tinted per biome.
    clouds.current.forEach((c, i) => {
      const seed = cloudSeeds[i];
      if (!c) return;
      const a = seed.angle + now * seed.speed;
      c.position.set(Math.cos(a) * seed.radius, seed.y + Math.sin(now * 0.3 + i) * 0.3, Math.sin(a) * seed.radius);
      c.material.color.copy(pal.cloud);
      c.material.opacity = 0.55;
    });

    // Satellite islands rotate lazily.
    islands.current.forEach((g, i) => {
      if (!g) return;
      g.rotation.y = now * (i === 0 ? 0.12 : -0.09);
      g.position.y = (i === 0 ? 2.6 : 3.8) + Math.sin(now * 0.5 + i * 3) * 0.25;
    });

    // Cargo drones patrol.
    drones.current.forEach((g, i) => {
      if (!g) return;
      const a = now * (0.25 + i * 0.07) + i * 2.4;
      const r = 10.5 + i * 1.2;
      g.position.set(Math.cos(a) * r, 3.6 + Math.sin(now * 1.3 + i) * 0.5, Math.sin(a) * r);
      g.rotation.y = -a + Math.PI / 2;
      g.children[2]?.position.setY(-0.35 + Math.sin(now * 2 + i) * 0.05); // cargo sways
    });

    // Idle secret: 12s of stillness → bird flyby.
    const idle = wallNow() - arenaFx.lastActive;
    if (idle > 12 && birdFlight.current < 0) birdFlight.current = now;
    if (birds.current) {
      if (birdFlight.current >= 0) {
        const t = (now - birdFlight.current) / 9;
        if (t >= 1) {
          birdFlight.current = -1;
          birds.current.visible = false;
        } else {
          birds.current.visible = true;
          birds.current.position.set(-24 + t * 48, 4.5 + Math.sin(t * Math.PI) * 1.2, -6 + t * 4);
          birds.current.children.forEach((b, i) => {
            b.position.y = Math.sin(now * 7 + i * 1.3) * 0.18;
            b.rotation.z = Math.sin(now * 12 + i) * 0.45; // flap
          });
        }
      } else {
        birds.current.visible = false;
      }
    }
  });

  return (
    <group>
      {/* ---- platform ---- */}
      <mesh position={[0, -0.55, 0]}>
        <cylinderGeometry args={[6.2, 5.4, 1.1, 48]} />
        <meshStandardMaterial ref={platformMat} color="#3a3f63" roughness={0.7} metalness={0.15} />
      </mesh>
      {/* track band on top */}
      <mesh position={[0, 0.011, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.2, 5.4, 48]} />
        <meshStandardMaterial color="#2b2e4d" roughness={0.85} />
      </mesh>
      {/* glowing edge ring */}
      <mesh position={[0, -0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[6.05, 0.09, 10, 72]} />
        <meshStandardMaterial ref={ringMat} color="#0c0e1f" emissive="#22e6c8" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      {/* under-spires */}
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 2.8, -2.1, Math.sin(a) * 2.8]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.7 - i * 0.05, 2.4, 6]} />
            <meshStandardMaterial color="#2b2e4d" roughness={0.8} />
          </mesh>
        );
      })}
      <mesh position={[0, -2.9, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[1.6, 3.4, 8]} />
        <meshStandardMaterial color="#23264a" roughness={0.8} />
      </mesh>

      {/* ---- floodlight pylons + pennants ---- */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const x = Math.cos(a) * 5.5;
        const z = Math.sin(a) * 5.5;
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, 1.4, 0]}>
              <cylinderGeometry args={[0.07, 0.11, 2.8, 8]} />
              <meshStandardMaterial color="#454a76" roughness={0.6} metalness={0.4} />
            </mesh>
            <mesh position={[0, 2.9, 0]}>
              <sphereGeometry args={[0.18, 12, 10]} />
              <meshStandardMaterial
                ref={(m) => {
                  pylonHeads.current[i] = m;
                }}
                color="#0c0e1f"
                emissive="#22e6c8"
                emissiveIntensity={1.8}
                toneMapped={false}
              />
            </mesh>
            {/* pennant */}
            <mesh
              ref={(m) => {
                flags.current[i] = m;
              }}
              position={[0.34, 2.55, 0]}
            >
              <planeGeometry args={[0.62, 0.34]} />
              <meshStandardMaterial color={i % 2 ? "#ffd23e" : "#ff6a5e"} side={THREE.DoubleSide} roughness={0.7} />
            </mesh>
          </group>
        );
      })}

      {/* ---- satellite islands ---- */}
      {[0, 1].map((i) => (
        <group
          key={i}
          ref={(g) => {
            islands.current[i] = g;
          }}
          position={i === 0 ? [11, 2.6, -7] : [-12, 3.8, 6]}
        >
          <mesh rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[1.1, 1.8, 7]} />
            <meshStandardMaterial color="#2f3358" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[1.1, 1.1, 0.24, 7]} />
            <meshStandardMaterial color="#4a5080" roughness={0.7} />
          </mesh>
          {[0, 1, 2].map((j) => (
            <mesh key={j} position={[Math.cos(j * 2.3) * 0.5, 0.5, Math.sin(j * 2.3) * 0.5]} rotation={[0, j, 0.2]}>
              <octahedronGeometry args={[0.22 + j * 0.06, 0]} />
              <meshStandardMaterial color="#9d7bff" emissive="#7b4dff" emissiveIntensity={1.4} toneMapped={false} />
            </mesh>
          ))}
        </group>
      ))}

      {/* ---- cargo drones ---- */}
      {[0, 1, 2].map((i) => (
        <group
          key={i}
          ref={(g) => {
            drones.current[i] = g;
          }}
        >
          <mesh>
            <capsuleGeometry args={[0.12, 0.18, 4, 8]} />
            <meshStandardMaterial color="#fff3e0" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.14, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.14, 0.03, 6, 12]} />
            <meshStandardMaterial color="#22243c" roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.35, 0]}>
            <boxGeometry args={[0.16, 0.16, 0.16]} />
            <meshStandardMaterial color="#ffd23e" emissive="#ffb300" emissiveIntensity={1} toneMapped={false} />
          </mesh>
        </group>
      ))}

      {/* ---- idle-secret birds ---- */}
      <group ref={birds} visible={false}>
        {Array.from({ length: BIRDS }, (_, i) => (
          <group key={i} position={[i * 0.8 - 1.6, 0, (i % 2) * 0.9 - 0.45]}>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <coneGeometry args={[0.06, 0.3, 4]} />
              <meshStandardMaterial color="#fff3e0" roughness={0.6} />
            </mesh>
          </group>
        ))}
      </group>

      {/* ---- clouds below ---- */}
      {cloudSeeds.map((_, i) => (
        <sprite
          key={i}
          ref={(c) => {
            clouds.current[i] = c;
          }}
          scale={[cloudSeeds[i].scale, cloudSeeds[i].scale * 0.55, 1]}
        >
          <spriteMaterial map={cloudTexture} transparent opacity={0.55} depthWrite={false} color="#ffd9ec" />
        </sprite>
      ))}
    </group>
  );
}

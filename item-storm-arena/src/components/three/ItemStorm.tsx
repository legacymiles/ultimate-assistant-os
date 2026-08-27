"use client";
/**
 * The toy. A storm of items rides invisible energy paths around the arena.
 * The cursor is a gravity well: light items dart in, heavy ones resist,
 * orbs circle, fast cursor movement blows the light stuff away like wind.
 * Captured items stack into orbit rings; click fires the whole volley
 * at the kart, staggered in collection order (which is what makes
 * secret combos possible).
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { ITEM_TYPES, ItemState, TOTAL_ITEMS, type ItemTypeDef } from "@/lib/items";
import { useArena, arenaFx } from "@/lib/store";
import { seededRand, clamp, wallNow } from "@/lib/math";

interface ItemSim {
  def: ItemTypeDef;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  state: ItemState;
  /** storm path params */
  ringRadius: number;
  ringHeight: number;
  ringSpeed: number;
  phase: number;
  bob: number;
  /** orbit capture */
  orbitSlot: number;
  orbitAngle: number;
  /** launch */
  launchAt: number;
  spin: THREE.Vector3;
  seed: number;
}

const CAPTURE_RADIUS = 0.95;
const ATTRACT_RADIUS = 4.2;
const G = 18;

export function ItemStorm({ quality }: { quality: number }) {
  const { camera, pointer } = useThree();
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const orbitOrder = useRef<number[]>([]);
  const launchQueue = useRef<number[]>([]);
  const lastLaunchSignal = useRef(0);

  // Shared geometries + materials: one per kind, reused by every instance of that kind.
  const shared = useMemo(() => {
    const geos: Record<string, THREE.BufferGeometry> = {
      capsule: new THREE.CapsuleGeometry(0.55, 0.7, 6, 12),
      coin: new THREE.CylinderGeometry(0.7, 0.7, 0.16, 24),
      crystal: new THREE.OctahedronGeometry(0.85, 0),
      orb: new THREE.IcosahedronGeometry(0.7, 1),
      paint: new THREE.SphereGeometry(0.72, 10, 8),
      shell: new THREE.ConeGeometry(0.6, 1.1, 12),
      magnet: new THREE.TorusGeometry(0.55, 0.24, 10, 20),
      gravity: new THREE.TorusKnotGeometry(0.45, 0.16, 48, 8),
    };
    const mats: Record<string, THREE.MeshStandardMaterial> = {};
    for (const t of ITEM_TYPES) {
      mats[t.kind] = new THREE.MeshStandardMaterial({
        color: t.color,
        emissive: t.emissive,
        emissiveIntensity: t.emissiveIntensity,
        metalness: t.metalness,
        roughness: t.roughness,
      });
    }
    return { geos, mats };
  }, []);

  // Build the simulation state once. `quality` scales item count for low-end devices.
  const items = useMemo<ItemSim[]>(() => {
    const list: ItemSim[] = [];
    let seed = 1;
    for (const def of ITEM_TYPES) {
      const count = Math.max(2, Math.round(def.count * quality));
      for (let i = 0; i < count; i++) {
        seed++;
        const r = seededRand(seed);
        const r2 = seededRand(seed * 1.7);
        const r3 = seededRand(seed * 2.3);
        list.push({
          def,
          pos: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          state: ItemState.STORM,
          // Band 3.0–7.0: overlaps the cursor plane's reachable zone (~4.4 units
          // at hero framing) so items are actually catchable, not just scenery.
          ringRadius: 3.0 + r * 4.0,
          ringHeight: 1.2 + r2 * 3.6,
          ringSpeed: (0.12 + r3 * 0.2) * (r > 0.5 ? 1 : -1),
          phase: r * Math.PI * 2 + seed,
          bob: 0.2 + r2 * 0.5,
          orbitSlot: -1,
          orbitAngle: r * Math.PI * 2,
          launchAt: 0,
          spin: new THREE.Vector3(r - 0.5, r2 - 0.5, r3 - 0.5).multiplyScalar(4),
          seed,
        });
      }
    }
    // Start every item on its path so frame 1 looks alive.
    for (const it of list) {
      it.pos.set(
        Math.cos(it.phase) * it.ringRadius,
        it.ringHeight,
        Math.sin(it.phase) * it.ringRadius
      );
    }
    return list;
  }, [quality]);

  // Reusable scratch objects — zero allocation in the frame loop.
  const scratch = useMemo(
    () => ({
      cursor: new THREE.Vector3(0, 2, 0),
      prevCursor: new THREE.Vector3(0, 2, 0),
      cursorVel: new THREE.Vector3(),
      target: new THREE.Vector3(),
      force: new THREE.Vector3(),
      tmp: new THREE.Vector3(),
      plane: new THREE.Plane(),
      ray: new THREE.Raycaster(),
      camDir: new THREE.Vector3(),
      kart: new THREE.Vector3(),
    }),
    []
  );

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30); // clamp so tab-switches don't explode the sim
    const now = state.clock.elapsedTime;
    const s = scratch;
    const store = useArena.getState();

    // --- cursor → world: intersect the pointer ray with a camera-facing plane ---
    camera.getWorldDirection(s.camDir);
    s.plane.setFromNormalAndCoplanarPoint(s.camDir, s.tmp.set(0, 2.2, 0));
    s.ray.setFromCamera(pointer, camera);
    const hitPlane = s.ray.ray.intersectPlane(s.plane, s.cursor);
    if (!hitPlane) s.cursor.set(0, 2.2, 0);
    s.cursor.y = clamp(s.cursor.y, 0.6, 6);

    s.cursorVel.subVectors(s.cursor, s.prevCursor).divideScalar(Math.max(dt, 1e-4));
    const cursorSpeed = Math.min(s.cursorVel.length(), 30);
    s.prevCursor.copy(s.cursor);
    arenaFx.cursorX = s.cursor.x;
    arenaFx.cursorY = s.cursor.y;
    arenaFx.cursorZ = s.cursor.z;
    arenaFx.cursorSpeed = cursorSpeed;

    s.kart.set(arenaFx.kartX, arenaFx.kartY + 0.4, arenaFx.kartZ);

    // --- launch signal: queue every orbiting item, staggered in collection order ---
    if (store.launchSignal !== lastLaunchSignal.current) {
      lastLaunchSignal.current = store.launchSignal;
      launchQueue.current = [...orbitOrder.current];
      launchQueue.current.forEach((idx, n) => {
        items[idx].launchAt = now + n * 0.13;
      });
      orbitOrder.current = [];
    }

    const wnow = wallNow();
    const magnetActive = wnow < arenaFx.magnetUntil;
    const gravityFlip = wnow < arenaFx.gravityUntil;
    const lowgrav = store.event === "lowgrav" && wnow < store.eventUntil;

    // --- simulate every item ---
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const mesh = meshRefs.current[i];
      if (!mesh) continue;

      switch (it.state) {
        case ItemState.STORM: {
          // Follow the invisible energy path.
          it.phase += it.ringSpeed * dt;
          s.target.set(
            Math.cos(it.phase) * it.ringRadius,
            it.ringHeight + Math.sin(now * 0.9 + it.seed) * it.bob,
            Math.sin(it.phase) * it.ringRadius
          );
          s.force.subVectors(s.target, it.pos).multiplyScalar(2.2);

          // Cursor gravity — inverse square, capped, scaled by mass.
          s.tmp.subVectors(s.cursor, it.pos);
          const d = s.tmp.length();
          if (d < ATTRACT_RADIUS && d > 1e-3) {
            const pull = (G / Math.max(d * d, 0.35)) / it.def.mass;
            s.tmp.normalize();
            s.force.addScaledVector(s.tmp, pull);
            // Orbit bias: orbs would rather circle you than obey you.
            if (it.def.orbitBias > 0) {
              const tx = -s.tmp.z, tz = s.tmp.x; // tangent in XZ
              s.force.x += tx * pull * it.def.orbitBias;
              s.force.z += tz * pull * it.def.orbitBias;
            }
            // Capture when close enough.
            if (d < CAPTURE_RADIUS) {
              it.state = ItemState.ORBIT;
              it.orbitSlot = orbitOrder.current.length;
              orbitOrder.current.push(i);
              it.vel.multiplyScalar(0.3);
            }
          }
          // Cursor wind: fast pointer movement blows light items around.
          if (cursorSpeed > 8 && d < ATTRACT_RADIUS * 1.4) {
            s.force.addScaledVector(s.cursorVel, 0.02 * it.def.windage);
          }
          // Magnet event: everything swirls toward the arena center.
          if (magnetActive) {
            s.tmp.set(0, 2.4, 0).sub(it.pos);
            s.force.addScaledVector(s.tmp, 1.6);
            s.force.x += -it.pos.z * 0.8; // swirl
            s.force.z += it.pos.x * 0.8;
          }
          // Gravity flip / low gravity: the storm floats upward.
          if (gravityFlip) s.force.y += 6;
          if (lowgrav) s.force.y += Math.sin(now * 2 + it.seed) * 2 + 1.5;

          it.vel.addScaledVector(s.force, dt);
          it.vel.multiplyScalar(Math.exp(-1.6 * dt)); // drag
          it.pos.addScaledVector(it.vel, dt);
          break;
        }

        case ItemState.ORBIT: {
          // Each captured item owns a ring around the cursor. Never overlaps.
          const slot = it.orbitSlot;
          const radius = 0.55 + slot * 0.17;
          const speed = 2.2 - slot * 0.06;
          it.orbitAngle += speed * dt;
          const wobble = Math.sin(now * 3 + it.seed) * 0.06;
          s.target.set(
            s.cursor.x + Math.cos(it.orbitAngle) * radius,
            s.cursor.y + Math.sin(it.orbitAngle * 0.7 + it.seed) * (0.18 + slot * 0.02) + wobble,
            s.cursor.z + Math.sin(it.orbitAngle) * radius
          );
          // Stiff spring: orbits feel locked-in but still springy.
          s.force.subVectors(s.target, it.pos).multiplyScalar(26 / it.def.mass);
          it.vel.addScaledVector(s.force, dt);
          it.vel.multiplyScalar(Math.exp(-6 * dt));
          it.pos.addScaledVector(it.vel, dt);

          // Fired?
          if (it.launchAt > 0 && now >= it.launchAt) {
            it.state = ItemState.LAUNCH;
            it.launchAt = 0;
            s.tmp.subVectors(s.kart, it.pos).normalize();
            it.vel.copy(s.tmp).multiplyScalar(16).setY(it.vel.y + 3.5); // arc
          }
          break;
        }

        case ItemState.LAUNCH: {
          // Home in with gravity for a satisfying arc.
          s.tmp.subVectors(s.kart, it.pos);
          const d = s.tmp.length();
          s.force.copy(s.tmp).normalize().multiplyScalar(30);
          s.force.y -= 9.8 * 0.4;
          it.vel.addScaledVector(s.force, dt);
          it.vel.multiplyScalar(Math.exp(-0.4 * dt));
          it.pos.addScaledVector(it.vel, dt);
          if (d < 0.8) {
            const hitAt = wallNow();
            useArena.getState().registerHit(it.def.kind, hitAt);
            // Per-kind world flags the other systems react to.
            switch (it.def.kind) {
              case "crystal": arenaFx.shieldUntil = hitAt + 4; break;
              case "magnet": arenaFx.magnetUntil = hitAt + 2.4; break;
              case "gravity": arenaFx.gravityUntil = hitAt + 2.8; break;
              case "paint": {
                arenaFx.paintUntil = hitAt + 5;
                const c = new THREE.Color(it.def.color);
                arenaFx.paintColor = { r: c.r, g: c.g, b: c.b };
                break;
              }
              case "orb": arenaFx.bloomPulseUntil = hitAt + 1.2; break;
            }
            // Respawn high on a fresh path.
            it.state = ItemState.RETURN;
            it.phase = seededRand(it.seed + now) * Math.PI * 2;
            it.pos.set(
              Math.cos(it.phase) * it.ringRadius,
              it.ringHeight + 6,
              Math.sin(it.phase) * it.ringRadius
            );
            it.vel.set(0, -2, 0);
          }
          break;
        }

        case ItemState.RETURN: {
          it.phase += it.ringSpeed * dt;
          s.target.set(
            Math.cos(it.phase) * it.ringRadius,
            it.ringHeight,
            Math.sin(it.phase) * it.ringRadius
          );
          s.force.subVectors(s.target, it.pos).multiplyScalar(3);
          it.vel.addScaledVector(s.force, dt);
          it.vel.multiplyScalar(Math.exp(-2.5 * dt));
          it.pos.addScaledVector(it.vel, dt);
          if (s.target.distanceTo(it.pos) < 0.4) it.state = ItemState.STORM;
          break;
        }
      }

      // Write to the mesh: position, tumble, and a breathing scale pulse.
      mesh.position.copy(it.pos);
      mesh.rotation.x += it.spin.x * dt;
      mesh.rotation.y += it.spin.y * dt;
      mesh.rotation.z += it.spin.z * dt;
      const pulse = 1 + Math.sin(now * 2.4 + it.seed * 3) * 0.08;
      const captured = it.state === ItemState.ORBIT ? 1.18 : 1;
      mesh.scale.setScalar(it.def.size * pulse * captured);
    }

    // Re-pack orbit slots after launches so rings stay tight.
    if (orbitOrder.current.length > 0) {
      orbitOrder.current.forEach((idx, n) => (items[idx].orbitSlot = n));
    }
    store.setCollected(orbitOrder.current.length);
  });

  return (
    <group>
      {items.map((it, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshRefs.current[i] = m;
          }}
          geometry={shared.geos[it.def.kind]}
          material={shared.mats[it.def.kind]}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}

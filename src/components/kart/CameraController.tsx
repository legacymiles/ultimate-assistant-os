"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useKart, PHASE } from "@/lib/kart/store";
import { PART_BY_ID, anchorOf } from "@/lib/kart/parts";

const ORBIT_RADIUS = 5.3;
const ORBIT_HEIGHT = 1.25;
const ORBIT_ANCHOR = new THREE.Vector3(0, 1.1, 5.2);
const DRIVER_EYE = new THREE.Vector3(0, 0.24, 0.15);
const CENTER = new THREE.Vector3(0, 0.05, 0);

function easeInOut(x: number) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function CameraController() {
  const { camera } = useThree();
  const angle = useRef(0);
  const smoothPointer = useRef(new THREE.Vector2());
  const target = useRef(new THREE.Vector3(0, ORBIT_HEIGHT, ORBIT_RADIUS));
  const look = useRef(CENTER.clone());

  useFrame((state, dt) => {
    const { progress, hoveredRegion, isolated, reducedMotion, velocity } =
      useKart.getState();

    const nextTarget = target.current;
    const nextLook = look.current;

    if (progress < PHASE.diveStart) {
      // ---- Showcase: orbit + pointer parallax (or isolate push-in) --------
      if (isolated && progress > PHASE.heroEnd && progress < PHASE.showcaseEnd) {
        const a = new THREE.Vector3(...anchorOf(PART_BY_ID[isolated]));
        nextTarget.set(a.x * 1.5 + 0.6, a.y + 0.5, a.z * 1.5 + 1.9);
        nextLook.copy(a);
      } else {
        const orbitSpeed = progress < PHASE.heroEnd ? 0.06 : hoveredRegion ? 0.04 : 0.12;
        if (!reducedMotion) angle.current += dt * orbitSpeed;
        smoothPointer.current.lerp(state.pointer, 0.05);
        const px = reducedMotion ? -0.5 : smoothPointer.current.x * 0.5;
        const py = reducedMotion ? 0 : smoothPointer.current.y * 0.35;
        nextTarget.set(
          Math.sin(angle.current + px) * ORBIT_RADIUS,
          ORBIT_HEIGHT + py,
          Math.cos(angle.current + px) * ORBIT_RADIUS,
        );
        nextLook.copy(CENTER);
      }
    } else {
      // ---- Dive + ride: interpolate orbit → driver's eye ------------------
      const diveDuration = PHASE.diveEnd - PHASE.diveStart;
      const t = easeInOut(THREE.MathUtils.clamp((progress - PHASE.diveStart) / diveDuration, 0, 1));
      nextTarget.lerpVectors(ORBIT_ANCHOR, DRIVER_EYE, t);
      nextLook.set(0, 0.12 + 0.02 * (1 - t), THREE.MathUtils.lerp(0.05, 8, t));

      if (progress > PHASE.diveEnd && progress < PHASE.outroStart && !reducedMotion) {
        const time = state.clock.elapsedTime;
        const intensity = THREE.MathUtils.clamp(Math.abs(velocity) * 0.02, 0, 1);
        nextTarget.x += Math.sin(time * 8) * 0.01 * intensity;
        nextTarget.y += Math.cos(time * 6.3) * 0.008 * intensity;
        nextLook.x += Math.sin(time * 0.6) * 0.5;
      }
    }

    const k = reducedMotion ? 1 : 1 - Math.pow(0.0016, dt);
    camera.position.lerp(nextTarget, k);
    const lookLerp = look.current.clone();
    camera.lookAt(lookLerp);

    if (progress > PHASE.diveEnd && progress < PHASE.outroStart && !reducedMotion) {
      const roll = Math.sin(state.clock.elapsedTime * 0.6) * 0.02;
      camera.rotation.z = THREE.MathUtils.damp(camera.rotation.z, roll, 4, dt);
    } else {
      camera.rotation.z = THREE.MathUtils.damp(camera.rotation.z, 0, 6, dt);
    }
  });

  return null;
}

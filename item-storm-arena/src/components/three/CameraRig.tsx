"use client";
/**
 * Cinematic camera: a slow perpetual orbit whose radius, height and framing
 * are driven by scroll progress (each biome gets its own vantage), with a
 * gentle pointer parallax layered on top. All motion is damped — the camera
 * never jumps, scrubbing up reverses perfectly because it's all a function
 * of progress.
 */
import { useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useArena } from "@/lib/store";
import { damp, lerp } from "@/lib/math";

// radius, height, lookAtY per biome checkpoint
const VIEWS = [
  { r: 11.5, h: 3.4, look: 1.2 },
  { r: 9.0, h: 2.2, look: 1.6 },
  { r: 8.0, h: 4.6, look: 0.8 },
  { r: 13.5, h: 5.4, look: 1.4 },
];

export function CameraRig() {
  const camera = useThree((s) => s.camera);
  const pointer = useThree((s) => s.pointer);
  const smooth = useRef({ r: VIEWS[0].r, h: VIEWS[0].h, look: VIEWS[0].look, px: 0, py: 0 });
  const lookTarget = useRef(new THREE.Vector3());

  useFrame((state, dt) => {
    const now = state.clock.elapsedTime;
    const progress = useArena.getState().progress;

    // Blend between per-biome vantages.
    const segs = VIEWS.length - 1;
    const p = Math.min(Math.max(progress, 0), 1) * segs;
    const i = Math.min(Math.floor(p), segs - 1);
    const t = p - i;
    const targetR = lerp(VIEWS[i].r, VIEWS[i + 1].r, t);
    const targetH = lerp(VIEWS[i].h, VIEWS[i + 1].h, t);
    const targetLook = lerp(VIEWS[i].look, VIEWS[i + 1].look, t);

    const s = smooth.current;
    s.r = damp(s.r, targetR, 2.5, dt);
    s.h = damp(s.h, targetH, 2.5, dt);
    s.look = damp(s.look, targetLook, 2.5, dt);
    // Pointer parallax — small, damped, physical.
    s.px = damp(s.px, pointer.x * 1.1, 3, dt);
    s.py = damp(s.py, pointer.y * 0.7, 3, dt);

    const angle = now * 0.06 + progress * Math.PI * 1.5;
    camera.position.set(
      Math.cos(angle) * s.r + Math.cos(angle + Math.PI / 2) * s.px,
      s.h + s.py,
      Math.sin(angle) * s.r + Math.sin(angle + Math.PI / 2) * s.px
    );
    lookTarget.current.set(0, s.look, 0);
    camera.lookAt(lookTarget.current);
  });

  return null;
}

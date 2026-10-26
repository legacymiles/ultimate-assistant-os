// ---------------------------------------------------------------------------
// The memory map's four layers, as geometry.
//
// The force engine (lib/jarvis/graph/force.ts) decides who sits near whom;
// this decides how far from the centre each layer sits. After every force step
// each node is nudged toward its layer's shell — you at the centre, the area
// routers on the first shell, abilities on the second, memories outermost — so
// the web keeps its clusters AND reads as four rings of depth.
//
// Flat view: the same nodes laid onto concentric rings in a plane. Each node
// keeps its angle (from its 3D position) and its shell, so zooming out from 3D
// to flat reads as the sphere unfolding, not a re-layout.
//
// Pure — the renderer and the tests share it.
// ---------------------------------------------------------------------------

import type { Layer } from "./build";

/** Shell radius per layer, as a share of the outer shell. */
export const SHELLS: readonly [number, number, number, number] = [0, 0.34, 0.68, 1];

/** The radius the outer shell settles at, from where the web actually is (85th percentile). */
export function outerRadius(positions: Float32Array, count: number): number {
  if (!count) return 1;
  const r = new Float32Array(count);
  for (let i = 0; i < count; i++) r[i] = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  r.sort();
  return Math.max(0.3, r[Math.floor((count - 1) * 0.85)]);
}

/**
 * Nudge every node toward its layer's shell. `strength` 0..1 is how much of
 * the gap closes this tick — small, so the force layout still breathes.
 * Mutates `positions`.
 */
export function applyShells(positions: Float32Array, layers: ArrayLike<number>, outer: number, strength = 0.08): void {
  const n = layers.length;
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    const layer = Math.max(0, Math.min(3, layers[i] | 0)) as Layer;
    if (layer === 0) {
      // You stay in the middle.
      positions[k] *= 1 - strength * 4;
      positions[k + 1] *= 1 - strength * 4;
      positions[k + 2] *= 1 - strength * 4;
      continue;
    }
    const x = positions[k];
    const y = positions[k + 1];
    const z = positions[k + 2];
    const r = Math.hypot(x, y, z);
    const target = SHELLS[layer] * outer;
    if (r < 1e-5) {
      // A node exactly at the centre has no direction to move along; give it one.
      positions[k] = target * 0.5 * (i % 2 ? 1 : -1);
      continue;
    }
    const f = 1 + ((target - r) / r) * strength;
    positions[k] = x * f;
    positions[k + 1] = y * f;
    positions[k + 2] = z * f;
  }
}

/** Where a node sits in flat view: its own angle, its layer's ring. Returns [x, y]. */
export function flatPoint(x: number, y: number, z: number, layer: number, outer: number): [number, number] {
  const ring = SHELLS[Math.max(0, Math.min(3, layer | 0))] * outer;
  if (!ring) return [0, 0];
  // The angle around the vertical axis spreads a 3D layout evenly round a ring.
  const a = Math.atan2(z, x) + y * 0.15;
  return [Math.cos(a) * ring, Math.sin(a) * ring];
}

/** 0 = full 3D, 1 = fully flat. Zooming far out flattens the map on its own. */
export function autoFlat(zoom: number, forced: boolean | null): number {
  if (forced === true) return 1;
  if (forced === false) return 0;
  // Below 0.6× the sphere unfolds; fully flat at 0.42×.
  return Math.max(0, Math.min(1, (0.6 - zoom) / 0.18));
}

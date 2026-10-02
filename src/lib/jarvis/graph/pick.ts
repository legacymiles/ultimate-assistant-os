// ---------------------------------------------------------------------------
// Clicking a dot in a cloud of a few thousand.
//
// A single <points> draw call gives you nothing to click. The obvious answer is
// THREE.Raycaster against the Points object, and it is the wrong one: its
// `threshold` is in WORLD units, so the hit radius grows as you zoom in and
// shrinks as you zoom out. On a graph whose whole interaction is zooming into
// clusters that is exactly backwards — nothing is clickable from far away and
// everything is clickable up close.
//
// So picking happens in screen space, in plain arithmetic, here. We already own
// every position in a Float32Array, and projecting them is one 4x4 transform
// per node — sixteen multiplies, a few thousand times, which is nothing next to
// the frame we are already drawing. In exchange:
//
//   * `radiusPx` means what a person expects: dots are 2-4px, and "the nearest
//     node within 14 pixels" is how pointing actually feels.
//   * it is pure, so hover and click correctness are unit-tested beside the
//     physics rather than only discoverable by clicking.
//   * no second render target and no readRenderTargetPixels, which stalls the
//     GPU pipeline every time you move the mouse.
//   * the projected array is also what the hover label, the selection ring and
//     the inspector need for positioning. One computation, four consumers.
//
// GPU id-buffer picking is the escape hatch above ~20k nodes. It is not needed
// for a vault and it is not built.
// ---------------------------------------------------------------------------

import { keywordScore, tokens } from "@/lib/jarvis/rank";
import type { ForceState, VaultNode } from "./types";

/** Three floats per node in a projected array. */
export const STRIDE = 3;

/**
 * Written into a node's screen x when it cannot be pointed at — behind the
 * camera, or outside the clip volume. NaN rather than a large number, because
 * every comparison against NaN is false, so a sentinel node can never win a
 * pick by accident.
 */
export const OFFSCREEN = Number.NaN;

/**
 * Project world positions to pixels.
 *
 * `viewProj` is a 16-element column-major matrix, which is exactly what
 * `THREE.Matrix4.elements` already is — so the caller hands over
 * `camera.projectionMatrix * camera.matrixWorldInverse` with no conversion.
 *
 * `out` is reused between frames. Allocating a few thousand floats sixty times
 * a second is the kind of garbage that shows up as a stutter rather than as a
 * number in a profile.
 */
export function project(
  positions: Float32Array,
  count: number,
  viewProj: ArrayLike<number>,
  width: number,
  height: number,
  out?: Float32Array,
): Float32Array {
  const screen = out && out.length >= count * STRIDE ? out : new Float32Array(count * STRIDE);
  const m = viewProj;

  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const o = i * STRIDE;

    // w <= 0 is behind the eye. Dividing by it mirrors the point to the far
    // side of the screen, where it would happily win a pick.
    if (w <= 1e-6) {
      screen[o] = OFFSCREEN;
      screen[o + 1] = OFFSCREEN;
      screen[o + 2] = OFFSCREEN;
      continue;
    }

    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cz = m[2] * x + m[6] * y + m[10] * z + m[14];

    const inv = 1 / w;
    screen[o] = (cx * inv * 0.5 + 0.5) * width;
    // Screen y grows downward; NDC y grows upward.
    screen[o + 1] = (1 - (cy * inv * 0.5 + 0.5)) * height;
    screen[o + 2] = cz * inv;
  }

  return screen;
}

/**
 * Within `radiusPx` of the cursor, prefer the dot nearest the pointer; among
 * dots that are close to equally near, prefer the one nearest the camera.
 *
 * The slack matters. Judging purely by pointer distance makes two overlapping
 * dots a coin toss decided by a fraction of a pixel; judging purely by depth
 * makes a dot 13px away beat the one you are actually pointing at. `slackPx`
 * is the band inside which "basically the same place" becomes "take the front
 * one", which is what people mean when they click a cluster.
 *
 * Returns the node index, or -1 for a miss.
 */
export function pickNearest(
  screen: Float32Array,
  count: number,
  px: number,
  py: number,
  radiusPx = 14,
  slackPx = 2,
): number {
  const limit = radiusPx * radiusPx;
  let best = -1;
  let bestDist = Infinity;
  let bestDepth = Infinity;

  for (let i = 0; i < count; i += 1) {
    const o = i * STRIDE;
    const sx = screen[o];
    if (Number.isNaN(sx)) continue;
    const dx = sx - px;
    const dy = screen[o + 1] - py;
    const distSq = dx * dx + dy * dy;
    if (distSq > limit) continue;

    const dist = Math.sqrt(distSq);
    const depth = screen[o + 2];

    if (best === -1 || dist < bestDist - slackPx || (dist <= bestDist + slackPx && depth < bestDepth)) {
      best = i;
      bestDist = Math.min(bestDist, dist);
      bestDepth = depth;
    }
  }

  return best;
}

/** Every node whose projected dot falls inside a rectangle, for a drag-select. */
export function pickWithin(screen: Float32Array, count: number, x0: number, y0: number, x1: number, y1: number): number[] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const o = i * STRIDE;
    const sx = screen[o];
    if (Number.isNaN(sx)) continue;
    const sy = screen[o + 1];
    if (sx >= left && sx <= right && sy >= top && sy <= bottom) out.push(i);
  }
  return out;
}

// --- framing ---------------------------------------------------------------

export interface Focus {
  centre: [number, number, number];
  /** The radius of a sphere containing every node asked for. Zero for a single node. */
  radius: number;
}

/**
 * The centre and extent of a set of nodes.
 *
 * This is what voice-driven "show me the Free Skool cluster" needs: the camera
 * flies to `centre` and backs off far enough to hold `radius`. Returns null for
 * an empty set, so a caller cannot accidentally fly to the origin on a miss.
 */
export function focusOn(state: ForceState, indices: number[]): Focus | null {
  if (!indices.length || !state.count) return null;

  let cx = 0;
  let cy = 0;
  let cz = 0;
  let used = 0;
  for (const i of indices) {
    if (i < 0 || i >= state.count) continue;
    cx += state.positions[i * 3];
    cy += state.positions[i * 3 + 1];
    cz += state.positions[i * 3 + 2];
    used += 1;
  }
  if (!used) return null;

  cx /= used;
  cy /= used;
  cz /= used;

  let radius = 0;
  for (const i of indices) {
    if (i < 0 || i >= state.count) continue;
    const dx = state.positions[i * 3] - cx;
    const dy = state.positions[i * 3 + 1] - cy;
    const dz = state.positions[i * 3 + 2] - cz;
    radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }

  return { centre: [cx, cy, cz], radius };
}

/**
 * How far back a perspective camera has to sit to hold a sphere of `radius`.
 *
 * `padding` leaves air around the cluster, because a graph framed to its exact
 * bounds reads as cropped. A zero-radius focus — one node — still gets a
 * sensible distance rather than ending up inside the dot.
 */
export function cameraDistance(radius: number, fovDegrees = 52, padding = 1.35): number {
  const half = (fovDegrees * Math.PI) / 360;
  return Math.max(0.8, (Math.max(radius, 0.25) * padding) / Math.tan(half));
}

// --- search ----------------------------------------------------------------

/**
 * Nodes matching a query, best first.
 *
 * Reuses `keywordScore` from rank.ts rather than inventing a second scoring
 * rule, so highlighting the graph and searching memories agree about what
 * "matches" means — and so a change to the tokeniser cannot make them differ.
 * A path substring is also honoured, because `people/` is a thing the owner
 * will type and it is not a word in any note's title.
 */
export function searchNodes(query: string, nodes: VaultNode[]): { key: string; score: number }[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const words = tokens(trimmed);

  const hits: { key: string; score: number }[] = [];
  for (const node of nodes) {
    const path = (node.path ?? node.key).toLowerCase();
    let score = words.length ? keywordScore(trimmed, { title: node.title, content: node.tags.join(" ") }) : 0;

    // A raw substring hit on the title or the path. Worth more than a token
    // match because typing a folder name is an exact intention, not a guess.
    if (node.title.toLowerCase().includes(trimmed) || path.includes(trimmed)) score += 1;
    if (node.tags.some((t) => t.includes(trimmed))) score += 0.5;

    if (score > 0) hits.push({ key: node.key, score });
  }

  return hits.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

/** The keys a search matched, for dimming everything else. Empty query highlights nothing. */
export function highlightSet(query: string, nodes: VaultNode[]): Set<string> {
  return new Set(searchNodes(query, nodes).map((h) => h.key));
}

/** A node and everything one hop from it — what the inspector shows and the canvas brightens. */
export function neighbourhood(nodes: VaultNode[], key: string): Set<string> {
  const out = new Set<string>([key]);
  const self = nodes.find((n) => n.key === key);
  for (const link of self?.links ?? []) out.add(link);
  for (const node of nodes) {
    if (node.links.includes(key)) out.add(node.key);
  }
  return out;
}

/** key → index, so a selection survives a re-layout and a search can address the position arrays. */
export function indexMap(nodes: VaultNode[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < nodes.length; i += 1) map.set(nodes[i].key, i);
  return map;
}

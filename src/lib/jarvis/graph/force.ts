// ---------------------------------------------------------------------------
// The force-directed layout, by hand.
//
// Written rather than installed, for two reasons that both matter here:
//
//   1. `d3-force-3d` calls Math.random() inside its own jiggle, so a layout
//      built on it cannot be tested for determinism without stubbing globals.
//      The whole reason this codebase is testable is that its logic takes `now`
//      and `seed` as parameters; adding a dependency to LOSE that is backwards.
//   2. The owner drives "Repel" and "Line length" from two sliders. Here those
//      are literally two arguments of `step()` — no force registry, no alpha
//      schedule fighting a live edit, no `.stop()` to remember.
//
// Performance rules it keeps, inherited from MemoryCore's contract:
//
//   * flat Float32Arrays, never an object per node
//   * repulsion through a uniform spatial hash with a hard cutoff, so the cost
//     is O(n·k) with k the handful of neighbours actually nearby — not O(n²)
//   * zero allocation per tick: the grid is a counting sort into three
//     reusable typed arrays, because allocating 2000 small arrays every frame
//     is the difference between smooth and stuttering
//
// Barnes-Hut is deliberately NOT used. Its advantage starts above roughly ten
// thousand nodes; a vault is hundreds to low thousands, and an octree is a lot
// of code to carry for a case that does not arrive.
// ---------------------------------------------------------------------------

import type { ForceParams, ForceState, Grid, VaultNode } from "./types";

/** Below this separation two nodes are treated as coincident and pushed apart along a fixed axis. */
const EPSILON = 1e-4;

/**
 * Added to the squared distance in the repulsion denominator.
 *
 * Without it the inverse square goes to infinity as two nodes touch, and one
 * tick is enough to fire them both off the canvas.
 */
const SOFTENING = 0.01;

/**
 * The logical timestep.
 *
 * Explicit Euler on a spring is only stable while `linkStrength · dt²` stays
 * small, so the stiffness the layout needs to actually converge on its rest
 * length has to be paid for with a smaller step. Equilibrium does not depend on
 * `dt`, only the path to it does — so a quarter-step costs four ticks per frame
 * of nothing and buys a layout that holds its line length instead of
 * oscillating around it.
 */
export const DEFAULT_DT = 0.25;

/**
 * How fast the layout cools.
 *
 * Chosen so alpha reaches ALPHA_MIN in about 900 ticks — roughly five seconds
 * at three ticks a frame. Long enough that a pair still converges on its rest
 * length before the forces fade, short enough that the graph visibly comes to
 * rest rather than shimmering at the edge of perception, and short enough that
 * nobody is watching a status line say "Settling…" for ten seconds.
 */
const ALPHA_DECAY = 1 - Math.pow(0.001, 1 / 900);

/** Below this the layout is done and the frame loop can stand down. */
export const ALPHA_MIN = 0.001;

/** xorshift32 — tiny, fast, and good enough for scattering a few thousand start positions. */
export function makeRandom(seed: number): () => number {
  // Seed 0 is a fixed point for xorshift, so it is nudged rather than allowed.
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** Evenly spaced points on a sphere — the same golden-angle spiral MemoryCore uses, so the two look related. */
function fibonacci(i: number, n: number, radius: number): [number, number, number] {
  const y = 1 - (i / Math.max(1, n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius];
}

function makeGrid(count: number): Grid {
  // Two buckets per node keeps the average occupancy near one. Collisions are
  // harmless — every candidate is distance-checked anyway — so a power of two
  // and a mask beats a prime and a modulo.
  let buckets = 16;
  while (buckets < count * 2 && buckets < 1 << 22) buckets <<= 1;
  return {
    buckets,
    counts: new Int32Array(buckets),
    starts: new Int32Array(buckets + 1),
    order: new Int32Array(Math.max(1, count)),
  };
}

/**
 * How much room `count` nodes need to start in.
 *
 * This exists because a fixed starting radius is a performance cliff, not a
 * cosmetic choice. The spatial hash only beats O(n²) while most pairs are
 * further apart than the cutoff — so packing 2000 nodes into a radius-1.6
 * sphere puts very nearly every node inside every other node's cutoff, every
 * candidate check fires, and a tick costs ~27ms instead of ~2ms. Scaling the
 * radius with the cube root of the count keeps the density, and therefore the
 * neighbour count, roughly constant however big the vault gets.
 */
export function spreadFor(count: number, linkDistance = 0.42): number {
  // Both terms are relative to the rest length, deliberately. An absolute
  // floor (this used to be 1.6) means a two-node graph with a short line
  // length starts ten times further apart than it wants to be, and with a
  // cooling schedule it runs out of energy before it finishes travelling.
  return Math.max(linkDistance * 1.4, linkDistance * Math.cbrt(Math.max(1, count)) * 0.9);
}

/**
 * Lay the graph out from scratch.
 *
 * Starts on a Fibonacci sphere plus a small seeded jitter. The sphere gives a
 * well-spread opening position so the simulation has little work to do; the
 * jitter breaks the spiral's symmetry, without which a graph can settle into a
 * flat disc and stay there because every force cancels.
 */
export function makeState(
  nodes: Pick<VaultNode, "key" | "links">[],
  seed = 0x5eed,
  radius = spreadFor(nodes.length),
): ForceState {
  const count = nodes.length;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const random = makeRandom(seed);

  const indexOf = new Map<string, number>();
  for (let i = 0; i < count; i += 1) indexOf.set(nodes[i].key, i);

  for (let i = 0; i < count; i += 1) {
    const [x, y, z] = fibonacci(i, count, radius);
    positions[i * 3] = x + (random() - 0.5) * 0.08;
    positions[i * 3 + 1] = y + (random() - 0.5) * 0.08;
    positions[i * 3 + 2] = z + (random() - 0.5) * 0.08;
  }

  // Edges are de-duplicated here rather than trusted: the same pair arriving
  // twice would double that spring's stiffness, and one edge being twice as
  // strong as its neighbours is visible in the layout.
  const pairs: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    for (const link of nodes[i].links) {
      const j = indexOf.get(link);
      if (j === undefined || j === i) continue;
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const id = lo * count + hi;
      if (seen.has(id)) continue;
      seen.add(id);
      pairs.push(lo, hi);
    }
  }

  return {
    count,
    positions,
    velocities,
    edges: new Uint32Array(pairs),
    energy: 0,
    alpha: 1,
    grid: makeGrid(count),
  };
}

/** Bucket a cell coordinate. Multiplying by large odd constants scatters nearby cells apart. */
function hashCell(ix: number, iy: number, iz: number, mask: number): number {
  return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) & mask;
}

/** Rebuild the spatial hash for the current positions. Allocation-free. */
function rebuild(state: ForceState, cell: number): void {
  const { count, positions, grid } = state;
  const { buckets, counts, starts, order } = grid;
  const mask = buckets - 1;
  const inv = 1 / cell;

  counts.fill(0);
  for (let i = 0; i < count; i += 1) {
    const h = hashCell(
      Math.floor(positions[i * 3] * inv),
      Math.floor(positions[i * 3 + 1] * inv),
      Math.floor(positions[i * 3 + 2] * inv),
      mask,
    );
    counts[h] += 1;
  }

  let running = 0;
  for (let b = 0; b < buckets; b += 1) {
    starts[b] = running;
    running += counts[b];
  }
  starts[buckets] = running;

  // counts is reused as a per-bucket fill cursor, so nothing extra is allocated.
  counts.fill(0);
  for (let i = 0; i < count; i += 1) {
    const h = hashCell(
      Math.floor(positions[i * 3] * inv),
      Math.floor(positions[i * 3 + 1] * inv),
      Math.floor(positions[i * 3 + 2] * inv),
      mask,
    );
    order[starts[h] + counts[h]] = i;
    counts[h] += 1;
  }
}

/**
 * Advance the simulation one tick, in place.
 *
 * Deliberately run on frame rather than to convergence: the graph visibly
 * re-settles while a slider moves, which is the feel being asked for. `dt` is
 * a fixed logical step, not wall-clock — a variable timestep makes a spring
 * system explode on the first dropped frame.
 */
export function step(state: ForceState, params: ForceParams, dt = DEFAULT_DT): ForceState {
  const { count, positions, velocities, edges } = state;
  if (!count) {
    state.energy = 0;
    return state;
  }

  const scaled = dt * state.alpha;
  const cutoff = Math.max(params.cutoff, EPSILON);
  const cutoffSq = cutoff * cutoff;
  rebuild(state, cutoff);
  const { buckets, starts, order } = state.grid;
  const mask = buckets - 1;
  const inv = 1 / cutoff;

  // --- repulsion, nearby pairs only ---------------------------------------
  for (let i = 0; i < count; i += 1) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    const cx = Math.floor(px * inv);
    const cy = Math.floor(py * inv);
    const cz = Math.floor(pz * inv);

    let fx = 0;
    let fy = 0;
    let fz = 0;

    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const h = hashCell(cx + ox, cy + oy, cz + oz, mask);
          const end = starts[h + 1];
          for (let s = starts[h]; s < end; s += 1) {
            const j = order[s];
            if (j === i) continue;
            let dx = px - positions[j * 3];
            let dy = py - positions[j * 3 + 1];
            let dz = pz - positions[j * 3 + 2];
            let distSq = dx * dx + dy * dy + dz * dz;
            if (distSq > cutoffSq) continue;
            if (distSq < EPSILON * EPSILON) {
              // Coincident. A random nudge here would destroy determinism, so
              // the direction comes from the index pair instead — stable across
              // runs, and different for each pair.
              dx = ((i % 3) - 1) * EPSILON;
              dy = (((i + j) % 3) - 1) * EPSILON;
              dz = ((j % 3) - 1) * EPSILON;
              distSq = dx * dx + dy * dy + dz * dz || EPSILON * EPSILON;
            }
            // Inverse-square, softened, and tapered to nothing at the cutoff.
            //
            // Softening stops a close pair launching each other across the
            // canvas in one tick. The taper matters just as much and is less
            // obvious: without it, repulsion drops from a real value to zero
            // the instant a node crosses the cutoff, and a pair hovering on
            // that boundary is kicked in and out forever — the graph jitters
            // and never settles.
            const falloff = 1 - distSq / cutoffSq;
            const scale = (params.repel * falloff * falloff) / (distSq + SOFTENING) / Math.sqrt(distSq);
            fx += dx * scale;
            fy += dy * scale;
            fz += dz * scale;
          }
        }
      }
    }

    velocities[i * 3] += fx * scaled;
    velocities[i * 3 + 1] += fy * scaled;
    velocities[i * 3 + 2] += fz * scaled;
  }

  // --- springs along edges -------------------------------------------------
  for (let e = 0; e < edges.length; e += 2) {
    const i = edges[e];
    const j = edges[e + 1];
    const dx = positions[j * 3] - positions[i * 3];
    const dy = positions[j * 3 + 1] - positions[i * 3 + 1];
    const dz = positions[j * 3 + 2] - positions[i * 3 + 2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || EPSILON;
    // Hooke: pull together when longer than the rest length, push apart when
    // shorter, so an edge converges ON `linkDistance` rather than collapsing.
    const force = ((dist - params.linkDistance) * params.linkStrength) / dist;
    const ux = dx * force * scaled;
    const uy = dy * force * scaled;
    const uz = dz * force * scaled;
    velocities[i * 3] += ux;
    velocities[i * 3 + 1] += uy;
    velocities[i * 3 + 2] += uz;
    velocities[j * 3] -= ux;
    velocities[j * 3 + 1] -= uy;
    velocities[j * 3 + 2] -= uz;
  }

  // --- centering, damping, speed limit, integrate -------------------------
  let energy = 0;
  const damping = Math.min(Math.max(params.damping, 0), 1);
  // How far a node may travel in one tick.
  //
  // This is not a nicety, it is what makes the layout robust to whatever the
  // sliders are set to. Nodes start spread over a fixed radius, so a short
  // line length means an opening spring displacement of several units and a
  // force stiff enough to fire a pair straight through its own rest length.
  // Once that happens the pair lands where repulsion is softened and
  // non-linear, and it oscillates between touching and flung apart forever
  // rather than settling. Capping the step turns that transient into a few
  // extra ticks of travel, and costs nothing at equilibrium, where speeds are
  // orders of magnitude below the cap.
  const maxSpeed = (0.3 * Math.max(params.linkDistance, 0.05)) / Math.max(dt, EPSILON);
  const maxSpeedSq = maxSpeed * maxSpeed;

  for (let i = 0; i < count; i += 1) {
    const k = i * 3;
    for (let a = 0; a < 3; a += 1) {
      // A gentle pull home, so a disconnected component drifts out and stops
      // rather than leaving the scene entirely.
      velocities[k + a] -= positions[k + a] * params.centering * scaled;
      velocities[k + a] *= damping;
    }

    const speedSq =
      velocities[k] * velocities[k] + velocities[k + 1] * velocities[k + 1] + velocities[k + 2] * velocities[k + 2];
    if (speedSq > maxSpeedSq) {
      const scale = maxSpeed / Math.sqrt(speedSq);
      velocities[k] *= scale;
      velocities[k + 1] *= scale;
      velocities[k + 2] *= scale;
    }

    for (let a = 0; a < 3; a += 1) {
      positions[k + a] += velocities[k + a] * dt;
      energy += velocities[k + a] * velocities[k + a];
    }
  }

  // A single NaN is not a glitch here, it is fatal: it propagates into the
  // position buffer, three's bounding-sphere computation gives up, and the
  // WebGL context is lost — taking the whole canvas, the post-processing pass
  // and every subsequent frame with it. One non-finite node is worth far less
  // than the entire graph, so it is put back rather than allowed to spread.
  if (!Number.isFinite(energy)) {
    for (let i = 0; i < count; i += 1) {
      for (let a = 0; a < 3; a += 1) {
        const k = i * 3 + a;
        if (!Number.isFinite(positions[k])) positions[k] = ((i % 7) - 3) * 0.1;
        if (!Number.isFinite(velocities[k])) velocities[k] = 0;
      }
    }
    energy = 0;
  }

  state.energy = energy;
  state.alpha += (0 - state.alpha) * ALPHA_DECAY;
  return state;
}

/** Wake a cooled layout back up. Anything the owner changes has to call this, or nothing moves. */
export function reheat(state: ForceState, to = 1): ForceState {
  state.alpha = Math.max(state.alpha, to);
  return state;
}

/** Run `ticks` steps. Used by tests and by the "re-settle" button; the canvas steps once per frame instead. */
export function settle(state: ForceState, params: ForceParams, ticks: number, dt = DEFAULT_DT): ForceState {
  for (let t = 0; t < ticks; t += 1) step(state, params, dt);
  return state;
}

/** The distance between two nodes, for assertions and for the inspector. */
export function distance(state: ForceState, i: number, j: number): number {
  const dx = state.positions[i * 3] - state.positions[j * 3];
  const dy = state.positions[i * 3 + 1] - state.positions[j * 3 + 1];
  const dz = state.positions[i * 3 + 2] - state.positions[j * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * True once motion has effectively stopped, so the frame loop can stand down.
 *
 * Judged on the cooling schedule rather than on energy, and that is the whole
 * point. A frustrated spring network never reaches a dead stop by itself — it
 * falls fast and then bounces around a floor, so ANY energy threshold is either
 * never reached (the loop runs forever) or reached while the graph is still
 * visibly moving. Annealing removes the question: the forces fade, the layout
 * stops, and "settled" becomes a fact rather than a guess.
 */
export function isSettled(state: ForceState): boolean {
  return state.count === 0 || state.alpha < ALPHA_MIN;
}

/**
 * Nudge every node, to shake a layout out of a symmetric dead end.
 *
 * Seeded, so "re-settle" twice from the same state gives the same answer —
 * a button whose result you cannot reproduce is not a button, it is a dice roll.
 */
export function kick(state: ForceState, strength = 0.04, seed = 0xbeef): ForceState {
  const random = makeRandom(seed);
  for (let k = 0; k < state.velocities.length; k += 1) {
    state.velocities[k] += (random() - 0.5) * strength;
  }
  // Without the reheat this would nudge a cooled layout once and it would
  // immediately freeze again, so the button would look broken.
  return reheat(state);
}

/** The axis-aligned bounds of the current layout, for framing the camera. */
export function bounds(state: ForceState): { min: [number, number, number]; max: [number, number, number] } {
  if (!state.count) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < state.count; i += 1) {
    for (let a = 0; a < 3; a += 1) {
      const v = state.positions[i * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

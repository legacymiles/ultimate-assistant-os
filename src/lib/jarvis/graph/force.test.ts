import { describe, expect, it } from "vitest";
import { bounds, distance, isSettled, kick, makeRandom, makeState, settle, spreadFor, step } from "./force";
import { DEFAULT_FORCE, type ForceParams } from "./types";

/** n nodes with no edges at all. */
const loose = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `n${i}`, links: [] as string[] }));

/** Two nodes linked to each other. */
const pair = () => [
  { key: "a", links: ["b"] },
  { key: "b", links: ["a"] },
];

const params = (patch: Partial<ForceParams> = {}): ForceParams => ({ ...DEFAULT_FORCE, ...patch });

describe("makeRandom", () => {
  it("is deterministic for a seed and different across seeds", () => {
    const a = makeRandom(1);
    const b = makeRandom(1);
    const c = makeRandom(2);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(makeRandom(1)()).not.toBe(c());
  });

  it("stays inside 0..1 over a long run", () => {
    const r = makeRandom(7);
    for (let i = 0; i < 5000; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("does not collapse on seed 0, which is a fixed point for xorshift", () => {
    const r = makeRandom(0);
    const first = r();
    expect(first).not.toBe(r());
  });
});

describe("determinism", () => {
  it("gives bit-identical output for the same seed and the same nodes", () => {
    // This is the property that makes every other test in this file possible,
    // and the reason the integrator is hand-written rather than borrowed.
    const a = settle(makeState(loose(60), 42), params(), 50);
    const b = settle(makeState(loose(60), 42), params(), 50);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(a.energy).toBe(b.energy);
  });

  it("gives a different layout for a different seed", () => {
    const a = settle(makeState(loose(40), 1), params(), 30);
    const b = settle(makeState(loose(40), 2), params(), 30);
    expect(Array.from(a.positions)).not.toEqual(Array.from(b.positions));
  });

  it("settles coincident nodes apart without any randomness", () => {
    // Two nodes at exactly the same point have no separation direction. A
    // random nudge would be the easy fix and would destroy determinism, so the
    // direction comes from the index pair instead.
    const state = makeState(loose(2), 9);
    state.positions.fill(0);
    state.velocities.fill(0);
    const twice = makeState(loose(2), 9);
    twice.positions.fill(0);
    twice.velocities.fill(0);

    settle(state, params(), 40);
    settle(twice, params(), 40);
    expect(distance(state, 0, 1)).toBeGreaterThan(0);
    expect(Array.from(state.positions)).toEqual(Array.from(twice.positions));
  });
});

describe("energy", () => {
  it("falls by orders of magnitude and then holds, rather than growing without bound", () => {
    const state = makeState(loose(80), 3);
    settle(state, params(), 5);
    const early = state.energy;

    // Long enough for the cooling schedule to run its course. A frustrated
    // spring network never stops on its own — annealing is what makes
    // "settled" a fact rather than a threshold someone guessed.
    settle(state, params(), 1500);
    expect(state.energy).toBeLessThan(early / 50);
    expect(isSettled(state)).toBe(true);

    // And it stays stopped.
    const resting = state.energy;
    settle(state, params(), 2000);
    expect(state.energy).toBeLessThanOrEqual(resting);
  });

  it("does not explode even with a hard repulsion and a slack damping", () => {
    // The softening term in the repulsion is what this guards: without it a
    // close pair launches each other off the canvas in one tick.
    const state = settle(makeState(loose(50), 11), params({ repel: 40, damping: 0.99 }), 400);
    expect(Number.isFinite(state.energy)).toBe(true);
    for (const v of state.positions) expect(Number.isFinite(v)).toBe(true);
  });

  it("is zero for an empty graph rather than NaN", () => {
    const state = step(makeState([], 1), params());
    expect(state.energy).toBe(0);
    expect(isSettled(state)).toBe(true);
  });
});

describe("the two sliders", () => {
  it("converges a linked pair on the Line length it was given", () => {
    for (const linkDistance of [0.3, 0.8, 1.4]) {
      // Sized for the rest length under test, exactly as the app sizes it for
      // its own default — a layout that starts ten times too far apart spends
      // its whole cooling budget travelling.
      const state = settle(makeState(pair(), 5, spreadFor(2, linkDistance)), params({ linkDistance }), 2000);
      expect(distance(state, 0, 1)).toBeCloseTo(linkDistance, 1);
    }
  });

  it("spreads the graph wider as Repel rises", () => {
    const spread = (repel: number) => {
      const state = settle(makeState(loose(60), 17), params({ repel }), 300);
      const { min, max } = bounds(state);
      return max[0] - min[0] + (max[1] - min[1]) + (max[2] - min[2]);
    };
    expect(spread(2)).toBeGreaterThan(spread(0.2));
  });

  it("collapses toward the centre when Repel is zero and nothing pushes back", () => {
    const state = settle(makeState(loose(30), 23), params({ repel: 0, centering: 0.05 }), 600);
    const { min, max } = bounds(state);
    expect(max[0] - min[0]).toBeLessThan(0.3);
  });

  it("keeps a slack damping moving for longer than a tight one", () => {
    const after = (damping: number) => settle(makeState(loose(40), 31), params({ damping }), 60).energy;
    expect(after(0.95)).toBeGreaterThan(after(0.5));
  });

  it("clamps a nonsense damping rather than inverting the simulation", () => {
    const state = settle(makeState(loose(20), 2), params({ damping: 1.8 }), 50);
    for (const v of state.positions) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("edges", () => {
  it("counts a reciprocal link as one spring, not two", () => {
    // Two springs on one pair is twice the stiffness, and one edge being
    // stiffer than its neighbours is visible in the finished layout.
    expect(makeState(pair(), 1).edges).toHaveLength(2);
  });

  it("ignores a link to a node that is not in the graph", () => {
    expect(makeState([{ key: "a", links: ["nowhere"] }], 1).edges).toHaveLength(0);
  });

  it("ignores a self-link", () => {
    expect(makeState([{ key: "a", links: ["a"] }], 1).edges).toHaveLength(0);
  });

  it("pulls a connected cluster tighter than an unconnected one", () => {
    const connected = Array.from({ length: 12 }, (_, i) => ({
      key: `c${i}`,
      links: Array.from({ length: 12 }, (_, j) => `c${j}`).filter((k) => k !== `c${i}`),
    }));
    const span = (nodes: Parameters<typeof makeState>[0]) => {
      const state = settle(makeState(nodes, 13), params(), 400);
      const { min, max } = bounds(state);
      return max[0] - min[0];
    };
    expect(span(connected)).toBeLessThan(span(loose(12)));
  });
});

describe("a disconnected component", () => {
  it("drifts out but is held in the scene by centering", () => {
    const nodes = [
      { key: "a", links: ["b"] },
      { key: "b", links: ["a"] },
      { key: "far", links: [] as string[] },
    ];
    const state = settle(makeState(nodes, 19), params(), 800);
    const { min, max } = bounds(state);
    for (const a of [0, 1, 2]) expect(max[a] - min[a]).toBeLessThan(40);
    for (const v of state.positions) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("kick", () => {
  it("restarts motion in a settled graph", () => {
    const state = settle(makeState(loose(30), 29), params(), 1500);
    expect(isSettled(state)).toBe(true);
    kick(state);
    step(state, params());
    expect(isSettled(state)).toBe(false);
  });

  it("is reproducible, because a button whose result you cannot repeat is a dice roll", () => {
    const a = kick(settle(makeState(loose(20), 3), params(), 100), 0.04, 77);
    const b = kick(settle(makeState(loose(20), 3), params(), 100), 0.04, 77);
    expect(Array.from(a.velocities)).toEqual(Array.from(b.velocities));
  });
});

describe("the tick budget", () => {
  it("steps a 2000-node graph fast enough to run on frame", () => {
    // The spatial hash is the whole point: O(n²) at 2000 nodes is four million
    // pair tests per tick and would not hold 60fps.
    const nodes = Array.from({ length: 2000 }, (_, i) => ({
      key: `n${i}`,
      links: i > 0 ? [`n${i - 1}`] : [],
    }));
    const state = makeState(nodes, 99);
    settle(state, params(), 3); // warm up, so the first JIT pass is not timed

    const started = performance.now();
    settle(state, params(), 10);
    const perTick = (performance.now() - started) / 10;

    // A 60fps frame is 16.6ms and the renderer needs most of it. Generous
    // enough not to be flaky on a loaded machine, tight enough to catch an
    // accidental return to O(n²), which at this size is ~100x slower.
    expect(perTick).toBeLessThan(12);
    expect(Number.isFinite(state.energy)).toBe(true);
  });

  it("allocates no new typed arrays per tick", () => {
    const state = makeState(loose(200), 5);
    const { positions, velocities, order } = { ...state.grid, ...state };
    settle(state, params(), 20);
    // Same backing buffers after twenty ticks — the grid is rebuilt in place.
    expect(state.positions).toBe(positions);
    expect(state.velocities).toBe(velocities);
    expect(state.grid.order).toBe(order);
  });
});

describe("bounds", () => {
  it("is the origin for an empty graph rather than infinities", () => {
    expect(bounds(makeState([], 1))).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });
});

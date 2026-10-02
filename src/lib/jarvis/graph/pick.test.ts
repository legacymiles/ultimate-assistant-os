import { describe, expect, it } from "vitest";
import {
  cameraDistance,
  focusOn,
  highlightSet,
  indexMap,
  neighbourhood,
  OFFSCREEN,
  pickNearest,
  pickWithin,
  project,
  searchNodes,
  STRIDE,
} from "./pick";
import { makeState } from "./force";
import type { VaultNode } from "./types";

/**
 * A view-projection matrix with no transform at all: world xyz IS clip xyz and
 * w is 1. Column-major, like THREE.Matrix4.elements. With this, the arithmetic
 * is checkable by hand — world (0,0,0) must land dead centre.
 */
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** A matrix that also divides by w, to prove the perspective divide is applied. */
const perspectiveish = (w: number) =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, w]);

const node = (key: string, patch: Partial<VaultNode> = {}): VaultNode => ({
  key,
  kind: "note",
  source: "vault",
  title: key,
  strength: 0.5,
  links: [],
  tags: [],
  path: key,
  ...patch,
});

describe("project", () => {
  it("puts the origin dead centre", () => {
    const screen = project(new Float32Array([0, 0, 0]), 1, IDENTITY, 800, 600);
    expect(screen[0]).toBeCloseTo(400, 5);
    expect(screen[1]).toBeCloseTo(300, 5);
  });

  it("maps clip space to pixels with y flipped, because screen y grows downward", () => {
    // Clip y = +1 is the TOP of the screen, which is pixel y = 0.
    const screen = project(new Float32Array([1, 1, 0, -1, -1, 0]), 2, IDENTITY, 800, 600);
    expect([screen[0], screen[1]]).toEqual([800, 0]);
    expect([screen[STRIDE], screen[STRIDE + 1]]).toEqual([0, 600]);
  });

  it("applies the perspective divide", () => {
    const screen = project(new Float32Array([1, 0, 0]), 1, perspectiveish(2), 800, 600);
    // x = 1, w = 2 → ndc 0.5 → three quarters across.
    expect(screen[0]).toBeCloseTo(600, 5);
  });

  it("marks a point behind the camera unpickable instead of mirroring it onto the screen", () => {
    // This is the bug raycasting-by-hand always has: a negative w divides the
    // point to the opposite side of the screen, where it cheerfully wins picks.
    const screen = project(new Float32Array([1, 1, 1]), 1, perspectiveish(-1), 800, 600);
    expect(Number.isNaN(screen[0])).toBe(true);
    expect(pickNearest(screen, 1, 400, 300, 1000)).toBe(-1);
  });

  it("reuses the output buffer rather than allocating one per frame", () => {
    const out = new Float32Array(3 * STRIDE);
    const first = project(new Float32Array(9), 3, IDENTITY, 800, 600, out);
    const second = project(new Float32Array(9), 3, IDENTITY, 800, 600, out);
    expect(first).toBe(out);
    expect(second).toBe(out);
  });

  it("allocates a fresh buffer when the one it is given is too small", () => {
    const tooSmall = new Float32Array(1);
    expect(project(new Float32Array(9), 3, IDENTITY, 800, 600, tooSmall)).not.toBe(tooSmall);
  });
});

describe("pickNearest", () => {
  /** Three dots at known pixels, all at the same depth. */
  const dots = (...xyd: [number, number, number][]) => {
    const out = new Float32Array(xyd.length * STRIDE);
    xyd.forEach(([x, y, d], i) => {
      out[i * STRIDE] = x;
      out[i * STRIDE + 1] = y;
      out[i * STRIDE + 2] = d;
    });
    return out;
  };

  it("hits the nearest dot within the radius", () => {
    const screen = dots([100, 100, 0], [140, 100, 0]);
    expect(pickNearest(screen, 2, 105, 100, 14)).toBe(0);
    expect(pickNearest(screen, 2, 135, 100, 14)).toBe(1);
  });

  it("misses rather than snapping to something far away", () => {
    // A graph where clicking empty space selects the nearest node half a screen
    // away is a graph you cannot deselect.
    expect(pickNearest(dots([100, 100, 0]), 1, 400, 400, 14)).toBe(-1);
  });

  it("takes the front one when two dots are in basically the same place", () => {
    // Overlapping dots must not be a coin toss decided by a fraction of a pixel.
    const screen = dots([100, 100, 0.9], [101, 100, 0.1]);
    expect(pickNearest(screen, 2, 100, 100, 14)).toBe(1);
  });

  it("still prefers the dot you are actually pointing at over a nearer-to-camera one further away", () => {
    const screen = dots([100, 100, 0.9], [112, 100, 0.1]);
    expect(pickNearest(screen, 2, 100, 100, 14)).toBe(0);
  });

  it("respects the radius it is given", () => {
    const screen = dots([100, 100, 0]);
    expect(pickNearest(screen, 1, 120, 100, 14)).toBe(-1);
    expect(pickNearest(screen, 1, 120, 100, 30)).toBe(0);
  });

  it("skips offscreen dots", () => {
    const screen = dots([OFFSCREEN, OFFSCREEN, OFFSCREEN], [100, 100, 0]);
    expect(pickNearest(screen, 2, 100, 100, 14)).toBe(1);
  });

  it("returns a miss on an empty graph rather than throwing", () => {
    expect(pickNearest(new Float32Array(0), 0, 0, 0, 14)).toBe(-1);
  });
});

describe("pickWithin", () => {
  it("finds every dot in a rectangle, however it was dragged", () => {
    const screen = new Float32Array([10, 10, 0, 50, 50, 0, 200, 200, 0]);
    expect(pickWithin(screen, 3, 0, 0, 100, 100)).toEqual([0, 1]);
    // Dragged up-and-left instead of down-and-right.
    expect(pickWithin(screen, 3, 100, 100, 0, 0)).toEqual([0, 1]);
  });

  it("ignores offscreen dots", () => {
    const screen = new Float32Array([OFFSCREEN, OFFSCREEN, OFFSCREEN, 50, 50, 0]);
    expect(pickWithin(screen, 2, 0, 0, 100, 100)).toEqual([1]);
  });
});

describe("focusOn", () => {
  it("gives the centre and extent of a cluster, which is what a voice command needs to fly to", () => {
    const state = makeState([node("a"), node("b"), node("c")].map((n) => ({ key: n.key, links: n.links })), 1);
    state.positions.set([0, 0, 0, 2, 0, 0, 1, 0, 0]);
    const focus = focusOn(state, [0, 1, 2]);
    expect(focus?.centre[0]).toBeCloseTo(1, 5);
    expect(focus?.radius).toBeCloseTo(1, 5);
  });

  it("returns null for an empty selection, so a miss cannot fly the camera to the origin", () => {
    const state = makeState([{ key: "a", links: [] }], 1);
    expect(focusOn(state, [])).toBeNull();
    expect(focusOn(state, [99])).toBeNull();
  });

  it("gives a single node a zero radius and its own position", () => {
    const state = makeState([{ key: "a", links: [] }], 1);
    state.positions.set([3, 4, 5]);
    expect(focusOn(state, [0])).toEqual({ centre: [3, 4, 5], radius: 0 });
  });
});

describe("cameraDistance", () => {
  it("backs off further for a bigger cluster", () => {
    expect(cameraDistance(5)).toBeGreaterThan(cameraDistance(1));
  });

  it("never ends up inside the dot when focusing a single node", () => {
    expect(cameraDistance(0)).toBeGreaterThan(0.5);
  });

  it("holds the sphere it was asked to hold, with air around it", () => {
    // At distance d with half-angle h, the visible half-height is d*tan(h).
    const radius = 3;
    const fov = 52;
    const d = cameraDistance(radius, fov);
    const visible = d * Math.tan((fov * Math.PI) / 360);
    expect(visible).toBeGreaterThan(radius);
  });
});

describe("searchNodes", () => {
  const nodes = [
    node("people/Robert Michaels.md", { title: "Robert Michaels", tags: ["testimonial"] }),
    node("topics/Ozone Therapy.md", { title: "Ozone Therapy", tags: ["treatment"] }),
    node("notes/Unrelated.md", { title: "Unrelated" }),
  ];

  it("finds a note by its title", () => {
    expect(searchNodes("ozone", nodes)[0].key).toBe("topics/Ozone Therapy.md");
  });

  it("finds notes by the folder they are in, which is a thing the owner will type", () => {
    expect(searchNodes("people/", nodes).map((h) => h.key)).toEqual(["people/Robert Michaels.md"]);
  });

  it("finds a note by its tag", () => {
    expect(searchNodes("testimonial", nodes)[0].key).toBe("people/Robert Michaels.md");
  });

  it("returns nothing for a query nothing matches, rather than everything", () => {
    expect(searchNodes("quarterly revenue in norway", nodes)).toEqual([]);
  });

  it("highlights nothing for an empty query", () => {
    expect(highlightSet("", nodes).size).toBe(0);
    expect(highlightSet("   ", nodes).size).toBe(0);
  });

  it("is deterministic when two nodes score the same", () => {
    const tied = [node("b.md", { title: "Same" }), node("a.md", { title: "Same" })];
    expect(searchNodes("same", tied).map((h) => h.key)).toEqual(["a.md", "b.md"]);
  });
});

describe("neighbourhood", () => {
  it("includes the node, what it links to, and what links to it", () => {
    const nodes = [
      node("a.md", { links: ["b.md"] }),
      node("b.md"),
      node("c.md", { links: ["b.md"] }),
      node("far.md"),
    ];
    expect([...neighbourhood(nodes, "b.md")].sort()).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("is just the node itself when nothing touches it", () => {
    expect([...neighbourhood([node("lonely.md")], "lonely.md")]).toEqual(["lonely.md"]);
  });

  it("does not throw on a key that is not in the graph", () => {
    expect([...neighbourhood([node("a.md")], "ghost:nope")]).toEqual(["ghost:nope"]);
  });
});

describe("indexMap", () => {
  it("maps every key to its position in the arrays", () => {
    const map = indexMap([node("a"), node("b")]);
    expect(map.get("a")).toBe(0);
    expect(map.get("b")).toBe(1);
    expect(map.get("missing")).toBeUndefined();
  });
});

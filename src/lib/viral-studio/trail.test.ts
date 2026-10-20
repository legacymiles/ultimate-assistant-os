import { describe, expect, it } from "vitest";

import { TRAIL_N, ageTrail, coverTransform, floodEase, pushPoint, trailUniforms } from "./trail";

describe("trail ring buffer", () => {
  it("remembers a path, not just the current point", () => {
    let t = pushPoint([], 0.1, 0.1);
    t = pushPoint(t, 0.2, 0.15);
    t = pushPoint(t, 0.3, 0.2);
    expect(t.map((p) => p.x)).toEqual([0.1, 0.2, 0.3]);
  });

  it("ignores an idle pointer so the path isn't flooded", () => {
    const t = pushPoint(pushPoint([], 0.5, 0.5), 0.501, 0.5);
    expect(t).toHaveLength(1);
  });

  it("drops the oldest points past the cap", () => {
    let t: ReturnType<typeof pushPoint> = [];
    for (let i = 0; i < TRAIL_N + 5; i++) t = pushPoint(t, i / 100, 0);
    expect(t).toHaveLength(TRAIL_N);
    expect(t[0].x).toBeCloseTo(0.05);
  });

  it("ages the tail out before the head and holds briefly", () => {
    let t = pushPoint([], 0.1, 0.1);
    t = ageTrail(t, 0.4, 0.75);
    t = pushPoint(t, 0.4, 0.4);
    t = ageTrail(t, 0.4, 0.75);
    expect(t).toHaveLength(1);
    expect(t[0].x).toBe(0.4);
    expect(ageTrail(t, 0.4, 0.75)).toHaveLength(0);
  });

  it("packs uniforms with empty slots parked off-canvas", () => {
    const { pos, age } = trailUniforms([{ x: 0.2, y: 0.3, age: 0.5 }], 4);
    expect(Array.from(pos)).toEqual([expect.closeTo(0.2), expect.closeTo(0.3), -10, -10, -10, -10, -10, -10]);
    expect(Array.from(age)).toEqual([0.5, 1, 1, 1]);
  });
});

describe("cover + flood", () => {
  it("crops the long side and centres it", () => {
    // A 16:9 frame in a 3:4 tile keeps full height and crops the sides.
    const wide = coverTransform(1920, 1080, 300, 400);
    expect(wide.scale[1]).toBe(1);
    expect(wide.scale[0]).toBeCloseTo(0.421875);
    expect(wide.offset[0]).toBeCloseTo((1 - 0.421875) / 2);
    // A 9:16 short in a 3:4 tile keeps full width.
    const tall = coverTransform(1080, 1920, 300, 400);
    expect(tall.scale[0]).toBe(1);
    expect(tall.scale[1]).toBeCloseTo(0.75);
  });

  it("eases out and clamps", () => {
    expect(floodEase(0)).toBe(0);
    expect(floodEase(1)).toBe(1);
    expect(floodEase(2)).toBe(1);
    expect(floodEase(0.5)).toBeGreaterThan(0.5);
  });
});

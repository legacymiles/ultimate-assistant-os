import { describe, expect, it } from "vitest";

import { FULL, TRAIL_N, ageTrail, contentRegion, coverTransform, floodEase, pushPoint, regionCover, trailUniforms } from "./trail";

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


function frame(w: number, h: number, paint: (x: number, y: number) => number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = paint(x, y); out.push(v, v, v, 255); }
  return out;
}

describe("letterbox trim", () => {
  it("finds black bands top and bottom", () => {
    const px = frame(10, 20, (_x, y) => (y < 4 || y >= 16 ? 5 : 160));
    const r = contentRegion(px, 10, 20);
    expect(r.y).toBeCloseTo(0.2);
    expect(r.h).toBeCloseTo(0.6);
    expect(r.x).toBe(0);
    expect(r.w).toBe(1);
  });

  it("still finds a bar with a credit line or noise in it", () => {
    const px = frame(20, 20, (x, y) => (y >= 15 ? (y === 17 && x === 3 ? 230 : 12) : x >= 17 ? 8 : 150));
    const r = contentRegion(px, 20, 20);
    expect(r.h).toBeCloseTo(0.75);
    expect(r.w).toBeCloseTo(0.85);
  });

  it("leaves a full frame and a night shot alone", () => {
    expect(contentRegion(frame(10, 20, () => 120), 10, 20)).toEqual(FULL);
    expect(contentRegion(frame(10, 20, (_x, y) => (y === 10 ? 60 : 4)), 10, 20)).toEqual(FULL);
  });

  it("covers the region the same way in the shader and in CSS", () => {
    const c = regionCover(1000, 2000, { x: 0, y: 0.25, w: 1, h: 0.5 }, 300, 400);
    // 1000×1000 of picture into a 3:4 tile: height-bound, crops the sides.
    expect(c.scale[1]).toBeCloseTo(0.5);
    expect(c.scale[0]).toBeCloseTo(0.75);
    expect(c.offset[0]).toBeCloseTo(0.125);
    expect(c.offset[1]).toBeCloseTo(0.25);
    expect(c.css.width).toBeCloseTo(133.33, 1);
    expect(c.css.top).toBeCloseTo(-50, 1);
  });

  it("with the full region equals plain cover", () => {
    const a = regionCover(1080, 1920, FULL, 300, 400);
    const b = coverTransform(1080, 1920, 300, 400);
    expect(a.scale[0]).toBeCloseTo(b.scale[0]);
    expect(a.scale[1]).toBeCloseTo(b.scale[1]);
    expect(a.offset[1]).toBeCloseTo(b.offset[1]);
  });
});

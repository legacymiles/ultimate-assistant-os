import { describe, expect, it } from "vitest";
import { LENSES, gestureOf, smooth, stepLens, toScreen, type Detect } from "./faceLenses";

const face = (over: Partial<Detect> = {}): Detect => ({
  detected: 1, x: 0, y: 0, s: 0.4, rx: 0, ry: 0, rz: 0, ...over,
});

describe("toScreen", () => {
  it("puts a centred face in the middle of the screen, sized from the width", () => {
    const p = toScreen(face(), 400, 800);
    expect(p.cx).toBe(200);
    expect(p.cy).toBe(400);
    expect(p.size).toBe(160);
  });

  it("mirrors the picture like a mirror: a face on the camera's left shows on the screen's right", () => {
    expect(toScreen(face({ x: -0.5 }), 400, 800).cx).toBe(300);
    expect(toScreen(face({ x: -0.5 }), 400, 800, false).cx).toBe(100);
  });

  it("turns the tracker's y-up into the screen's y-down", () => {
    expect(toScreen(face({ y: 0.5 }), 400, 800).cy).toBe(200);
  });

  it("flips roll with the mirror, and keeps the mouth between 0 and 1", () => {
    expect(toScreen(face({ rz: 0.3 }), 400, 800).roll).toBeCloseTo(-0.3);
    expect(toScreen(face({ rz: 0.3 }), 400, 800, false).roll).toBeCloseTo(0.3);
    expect(toScreen(face({ mouth: 1.7 }), 400, 800).mouth).toBe(1);
    expect(toScreen(face({ mouth: undefined }), 400, 800).mouth).toBe(0);
  });
});

describe("smooth", () => {
  it("moves toward the new reading without jumping there", () => {
    const a = smooth(null, toScreen(face(), 400, 800), true, 1 / 60);
    const b = smooth(a, toScreen(face({ x: 0.04 }), 400, 800), true, 1 / 60);
    expect(b.cx).toBeLessThan(200);
    expect(b.cx).toBeGreaterThan(200 - 8);
  });

  it("fades the stickers out when the face is lost, and keeps them where they were", () => {
    let p = smooth(null, toScreen(face(), 400, 800), true, 1);
    for (let i = 0; i < 60; i++) p = smooth(p, toScreen(face(), 400, 800), true, 1 / 60);
    const lost = smooth(p, toScreen(face({ x: 0.9 }), 400, 800), false, 0.5);
    expect(lost.seen).toBeLessThan(p.seen);
    expect(lost.cx).toBe(p.cx);
  });
});

describe("gestureOf", () => {
  it("reads a quick sideways stroke as a swipe, left = next", () => {
    expect(gestureOf(-120, 10, 0.3, 400)).toBe("next");
    expect(gestureOf(120, -10, 0.3, 400)).toBe("prev");
  });

  it("reads a touch that barely moved as a tap", () => {
    expect(gestureOf(5, 4, 0.1, 400)).toBe("tap");
  });

  it("ignores a mostly vertical drag and a slow wander", () => {
    expect(gestureOf(60, 200, 0.3, 400)).toBe("none");
    expect(gestureOf(-200, 0, 3, 400)).toBe("none");
  });
});

describe("stepLens", () => {
  it("wraps both ways, so the carousel never runs out", () => {
    expect(stepLens(LENSES.length - 1, 1)).toBe(0);
    expect(stepLens(0, -1)).toBe(LENSES.length - 1);
  });
});

import { describe, expect, it } from "vitest";
import {
  CORNERS,
  UNLOCK_AT,
  distance,
  lockAnchor,
  nextCorner,
  pointOnRail,
  railFor,
  railProgress,
  tapAction,
} from "./lock";

const INSET = 62;

describe("corners", () => {
  it("cycles clockwise and comes home after four taps", () => {
    expect(nextCorner("tl")).toBe("tr");
    expect(nextCorner("tr")).toBe("br");
    expect(nextCorner("br")).toBe("bl");
    expect(nextCorner("bl")).toBe("tl");
    let c = CORNERS[0];
    for (let i = 0; i < 4; i++) c = nextCorner(c);
    expect(c).toBe(CORNERS[0]);
  });

  it("insets the puck from both edges it touches", () => {
    expect(lockAnchor("br", 1000, 600, INSET)).toEqual({ x: 938, y: 538 });
    expect(lockAnchor("tl", 1000, 600, INSET)).toEqual({ x: 62, y: 62 });
  });
});

describe("the rail", () => {
  // The rule that makes the gesture as hard as the device allows: always the
  // longest side, so a portrait phone is not a short horizontal swipe.
  it("runs along the longest axis of the screen", () => {
    const landscape = railFor("br", 1180, 820, INSET);
    expect(landscape.axis).toBe("x");
    expect(landscape.end).toBe("bl");

    const portrait = railFor("br", 390, 844, INSET);
    expect(portrait.axis).toBe("y");
    expect(portrait.end).toBe("tr");
  });

  it("hugs the edge the lock is already on, so it never crosses the picture", () => {
    const r = railFor("br", 1180, 820, INSET);
    expect(r.from.y).toBe(r.to.y);
    expect(r.from.y).toBe(820 - INSET);

    const v = railFor("tl", 390, 844, INSET);
    expect(v.from.x).toBe(v.to.x);
    expect(v.from.x).toBe(INSET);
  });

  it("spans the screen less the two insets", () => {
    expect(railFor("br", 1180, 820, INSET).length).toBe(1180 - INSET * 2);
    expect(railFor("tr", 390, 844, INSET).length).toBe(844 - INSET * 2);
  });

  it("is the same rail from either end", () => {
    const a = railFor("br", 1180, 820, INSET);
    const b = railFor(a.end, 1180, 820, INSET);
    expect(b.end).toBe("br");
    expect(b.length).toBe(a.length);
  });
});

describe("progress along the rail", () => {
  it("reads 0 at the lock and 1 at the latch, in both directions", () => {
    const right = railFor("br", 1180, 820, INSET);
    expect(railProgress(right, right.from)).toBe(0);
    expect(railProgress(right, right.to)).toBe(1);

    // A rail travelling left to right (lock in a left corner) must not read
    // backwards — the sign of the direction is the thing most easily got wrong.
    const left = railFor("bl", 1180, 820, INSET);
    expect(railProgress(left, left.from)).toBe(0);
    expect(railProgress(left, left.to)).toBe(1);
    expect(railProgress(left, { x: 1180 / 2, y: 758 })).toBeCloseTo(0.5, 1);
  });

  it("clamps rather than going negative or past the end", () => {
    const r = railFor("br", 1180, 820, INSET);
    expect(railProgress(r, { x: 5000, y: 758 })).toBe(0);
    expect(railProgress(r, { x: -5000, y: 758 })).toBe(1);
  });

  it("ignores how far off the rail the finger has wandered", () => {
    // A baby's drag is never straight, and an adult's in the dark is not either.
    // Only travel along the axis counts; perpendicular drift is forgiven.
    const r = railFor("br", 1180, 820, INSET);
    const mid = pointOnRail(r, 0.5);
    expect(railProgress(r, { x: mid.x, y: 20 })).toBeCloseTo(0.5, 5);
  });

  it("survives a zero-length rail instead of dividing by it", () => {
    const degenerate = railFor("br", 124, 124, 62);
    expect(degenerate.length).toBe(0);
    expect(railProgress(degenerate, { x: 62, y: 62 })).toBe(0);
  });

  it("puts the puck where the progress says, clamped", () => {
    const r = railFor("br", 1180, 820, INSET);
    expect(pointOnRail(r, 0)).toEqual(r.from);
    expect(pointOnRail(r, 1)).toEqual(r.to);
    expect(pointOnRail(r, 2)).toEqual(r.to);
    expect(pointOnRail(r, -1)).toEqual(r.from);
  });

  // The threshold has to leave room for a pointer that cannot land exactly on
  // the latch, without accepting a drag that stopped most of the way.
  it("asks for nearly the whole traverse", () => {
    expect(UNLOCK_AT).toBeGreaterThan(0.9);
    expect(UNLOCK_AT).toBeLessThan(1);
  });
});

describe("taps", () => {
  it("shows the rail on the first tap and moves the lock on the third", () => {
    expect(tapAction(1)).toBe("show-rail");
    // The second tap must do nothing: the rail is already out, and toggling it
    // shut would make a double-tap feel like the lock ignoring you.
    expect(tapAction(2)).toBe("none");
    expect(tapAction(3)).toBe("move-corner");
    expect(tapAction(4)).toBe("move-corner");
    expect(tapAction(0)).toBe("none");
  });
});

describe("distance", () => {
  it("measures the slop that tells a tap from a drag", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

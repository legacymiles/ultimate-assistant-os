import { describe, expect, it } from "vitest";
import {
  CORNERS,
  LEG_DONE,
  START,
  UNLOCK_AT,
  advance,
  distance,
  isDone,
  legFill,
  legProgress,
  lockAnchor,
  nextCorner,
  pathFor,
  pointAt,
  tapAction,
} from "./lock";

const INSET = 62;
const PHONE = { w: 390, h: 844 };
const TABLET = { w: 1180, h: 820 };

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

describe("the angled path", () => {
  // The rule that makes a baby's straight-line thumb useless: the way out
  // turns a corner, and the two legs travel different axes.
  it("takes the short edge first, then the long one", () => {
    const p = pathFor("br", PHONE.w, PHONE.h, INSET);
    expect(p.legs[0].axis).toBe("x");
    expect(p.legs[1].axis).toBe("y");
    expect(p.legs[0].length).toBeLessThan(p.legs[1].length);

    const t = pathFor("br", TABLET.w, TABLET.h, INSET);
    expect(t.legs[0].axis).toBe("y");
    expect(t.legs[1].axis).toBe("x");
    expect(t.legs[0].length).toBeLessThan(t.legs[1].length);
  });

  it("turns at the next corner and ends at the opposite one", () => {
    const p = pathFor("br", PHONE.w, PHONE.h, INSET);
    expect(p.elbow).toBe("bl");
    expect(p.end).toBe("tl");

    const q = pathFor("tl", PHONE.w, PHONE.h, INSET);
    expect(q.elbow).toBe("tr");
    expect(q.end).toBe("br");

    const t = pathFor("br", TABLET.w, TABLET.h, INSET);
    expect(t.elbow).toBe("tr");
    expect(t.end).toBe("tl");
  });

  it("joins up: leg two starts where leg one finished", () => {
    const p = pathFor("tr", PHONE.w, PHONE.h, INSET);
    expect(p.legs[1].from).toEqual(p.legs[0].to);
  });

  // Each leg hugs the edge it runs along, so neither is ever drawn across the
  // picture the baby is watching — and the two sit on opposite sides.
  it("keeps both legs on edges, far apart", () => {
    const p = pathFor("br", PHONE.w, PHONE.h, INSET);
    expect(p.legs[0].from.y).toBe(p.legs[0].to.y);
    expect(p.legs[0].from.y).toBe(PHONE.h - INSET);
    expect(p.legs[1].from.x).toBe(p.legs[1].to.x);
    expect(p.legs[1].from.x).toBe(INSET);

    // Far apart: the legs are a whole screen's width and height away from the
    // edges they do not touch.
    expect(Math.abs(p.legs[0].from.y - INSET)).toBe(PHONE.h - INSET * 2);
    expect(Math.abs(p.legs[1].from.x - (PHONE.w - INSET))).toBe(PHONE.w - INSET * 2);
  });

  it("spans each edge less the two insets", () => {
    const p = pathFor("br", PHONE.w, PHONE.h, INSET);
    expect(p.legs[0].length).toBe(PHONE.w - INSET * 2);
    expect(p.legs[1].length).toBe(PHONE.h - INSET * 2);
  });

  it("is longer than the single traverse it replaced", () => {
    const p = pathFor("br", PHONE.w, PHONE.h, INSET);
    expect(p.legs[0].length + p.legs[1].length).toBeGreaterThan(PHONE.h - INSET * 2);
  });
});

describe("progress along a leg", () => {
  it("reads 0 at the start and 1 at the end, in both directions", () => {
    const right = pathFor("br", PHONE.w, PHONE.h, INSET).legs[0];
    expect(legProgress(right, right.from)).toBe(0);
    expect(legProgress(right, right.to)).toBe(1);

    // A leg travelling the other way must not read backwards — the sign of
    // the direction is the thing most easily got wrong.
    const left = pathFor("bl", PHONE.w, PHONE.h, INSET).legs[0];
    expect(legProgress(left, left.from)).toBe(0);
    expect(legProgress(left, left.to)).toBe(1);
    expect(legProgress(left, { x: PHONE.w / 2, y: PHONE.h - INSET })).toBeCloseTo(0.5, 1);
  });

  it("clamps rather than going negative or past the end", () => {
    const leg = pathFor("br", PHONE.w, PHONE.h, INSET).legs[0];
    expect(legProgress(leg, { x: 5000, y: 0 })).toBe(0);
    expect(legProgress(leg, { x: -5000, y: 0 })).toBe(1);
  });

  it("ignores how far off the leg the finger has wandered", () => {
    // An adult's drag in the dark is not straight either. Only travel along
    // the axis counts; perpendicular drift is forgiven.
    const leg = pathFor("br", PHONE.w, PHONE.h, INSET).legs[0];
    expect(legProgress(leg, { x: PHONE.w / 2, y: 20 })).toBeCloseTo(0.5, 1);
  });

  it("survives a zero-length leg instead of dividing by it", () => {
    const degenerate = pathFor("br", 124, 124, 62).legs[0];
    expect(degenerate.length).toBe(0);
    expect(legProgress(degenerate, { x: 62, y: 62 })).toBe(0);
  });
});

describe("taking the turn", () => {
  const path = pathFor("br", PHONE.w, PHONE.h, INSET);
  const onLegOne = (t: number) => ({
    x: path.legs[0].from.x + (path.legs[0].to.x - path.legs[0].from.x) * t,
    y: path.legs[0].from.y,
  });
  const onLegTwo = (t: number) => ({
    x: path.legs[1].from.x,
    y: path.legs[1].from.y + (path.legs[1].to.y - path.legs[1].from.y) * t,
  });

  it("stays on leg one until the corner is reached", () => {
    const half = advance(path, START, onLegOne(0.5));
    expect(half).toEqual({ leg: 0, t: 0.5 });
    const nearly = advance(path, half, onLegOne(LEG_DONE - 0.05));
    expect(nearly.leg).toBe(0);
  });

  it("opens leg two once leg one has been travelled", () => {
    const turned = advance(path, START, onLegOne(1));
    expect(turned).toEqual({ leg: 1, t: 0 });
  });

  // The whole point of the angle. A diagonal from the lock to the opposite
  // corner covers the full travel of BOTH legs at once — only the on-path band
  // stops it being a one-swipe way out.
  it("gives one diagonal swipe to the far corner nothing", () => {
    const diagonal = advance(path, START, pointAt(path, { leg: 1, t: 1 }));
    expect(diagonal).toEqual(START);
    expect(isDone(diagonal)).toBe(false);
  });

  it("stops counting when the finger leaves the edge, and waits there", () => {
    const half = advance(path, START, onLegOne(0.5));
    const strayed = advance(path, half, { x: onLegOne(1).x, y: PHONE.h / 2 });
    expect(strayed).toEqual(half);
    // ...and picks up again where it left off when the finger comes back.
    const back = advance(path, strayed, onLegOne(0.7));
    expect(back).toEqual({ leg: 0, t: 0.7 });
  });

  it("forgives a wobble inside the band", () => {
    const wobbled = advance(path, START, { x: onLegOne(0.5).x, y: PHONE.h - INSET - 80 });
    expect(wobbled.t).toBeCloseTo(0.5, 1);
  });

  it("does not undo the turn when the finger slides back", () => {
    const turned = advance(path, START, onLegOne(1));
    const backwards = advance(path, turned, onLegOne(0.2));
    expect(backwards.leg).toBe(1);
    expect(backwards.t).toBe(0);
  });

  it("finishes only at the end of leg two", () => {
    const turned = advance(path, START, onLegOne(1));
    const half = advance(path, turned, onLegTwo(0.5));
    expect(isDone(half)).toBe(false);
    const done = advance(path, half, onLegTwo(1));
    expect(isDone(done)).toBe(true);
  });

  it("never counts the end of leg one as unlocked", () => {
    expect(isDone({ leg: 0, t: 1 })).toBe(false);
  });

  // Forgiving at the end, because the turn is the hard part; never so
  // forgiving that a drag which stopped short counts.
  it("asks for nearly the whole of each leg", () => {
    expect(UNLOCK_AT).toBeGreaterThan(0.85);
    expect(UNLOCK_AT).toBeLessThan(1);
    expect(LEG_DONE).toBeGreaterThan(0.8);
    expect(LEG_DONE).toBeLessThan(1);
  });
});

describe("drawing it", () => {
  const path = pathFor("br", PHONE.w, PHONE.h, INSET);

  it("puts the puck where the step says, clamped", () => {
    expect(pointAt(path, START)).toEqual(path.legs[0].from);
    expect(pointAt(path, { leg: 0, t: 1 })).toEqual(path.legs[0].to);
    expect(pointAt(path, { leg: 1, t: 0 })).toEqual(path.legs[1].from);
    expect(pointAt(path, { leg: 1, t: 2 })).toEqual(path.legs[1].to);
    expect(pointAt(path, { leg: 1, t: -1 })).toEqual(path.legs[1].from);
  });

  it("lights the legs behind the puck and none ahead of it", () => {
    expect(legFill({ leg: 0, t: 0.4 }, 0)).toBe(0.4);
    expect(legFill({ leg: 0, t: 0.4 }, 1)).toBe(0);
    expect(legFill({ leg: 1, t: 0.4 }, 0)).toBe(1);
    expect(legFill({ leg: 1, t: 0.4 }, 1)).toBe(0.4);
  });
});

describe("taps", () => {
  it("shows the path on the first tap and moves the lock on the third", () => {
    expect(tapAction(1)).toBe("show-rail");
    // The second tap must do nothing: the path is already out, and toggling it
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

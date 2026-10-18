import { describe, expect, it } from "vitest";
import { breathCurve } from "./breath";

describe("breathCurve", () => {
  it("swells, holds, releases", () => {
    expect(breathCurve(0)).toBe(0);
    expect(breathCurve(0.2)).toBeCloseTo(0.5, 5);
    expect(breathCurve(0.44)).toBe(1);
    expect(breathCurve(0.999)).toBeLessThan(0.01);
  });
  it("stays within 0..1 for any input, including negative and huge steps", () => {
    for (const x of [-1e6, -3.7, -0.01, 1.5, 42.42, 1e9]) {
      const v = breathCurve(x);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(breathCurve(Number.NaN)).toBe(0);
  });
});

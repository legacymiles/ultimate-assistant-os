import { describe, expect, it } from "vitest";
import { cents, sameAmount, sum, withinTolerance } from "./money";

describe("cents", () => {
  it("rounds to the nearest cent", () => {
    expect(cents(9.994)).toBe(999);
    expect(cents(9.995)).toBe(1000);
  });
  it("handles a float that is not exactly representable", () => {
    expect(cents(0.1 + 0.2)).toBe(30);
  });
});

describe("sameAmount", () => {
  // The duplicate detector turns on exact equality, and 0.1 + 0.2 !== 0.3.
  it("calls two floats equal when their cents match", () => {
    expect(sameAmount(0.1 + 0.2, 0.3)).toBe(true);
  });
  it("separates amounts a cent apart", () => {
    expect(sameAmount(9.99, 10.0)).toBe(false);
  });
});

describe("sum", () => {
  it("adds without float drift", () => {
    expect(sum([0.1, 0.2, 0.3])).toBe(0.6);
  });
  it("is zero for nothing", () => {
    expect(sum([])).toBe(0);
  });
  it("lets a refund reduce the total", () => {
    expect(sum([60, -60])).toBe(0);
  });
});

describe("withinTolerance", () => {
  it("takes the absolute tolerance when it is larger", () => {
    // 5% of 10 is 0.50, so the absolute 1.00 wins.
    expect(withinTolerance(11, 10, 1, 5)).toBe(true);
  });
  it("takes the percentage when it is larger", () => {
    // 5% of 500 is 25, so 520 is inside it even though 1.00 is not.
    expect(withinTolerance(520, 500, 1, 5)).toBe(true);
  });
  it("is inclusive at the boundary", () => {
    expect(withinTolerance(11, 10, 1, 0)).toBe(true);
  });
  it("rejects a cent past the boundary", () => {
    expect(withinTolerance(11.01, 10, 1, 0)).toBe(false);
  });
  it("works below the expected amount too", () => {
    expect(withinTolerance(9, 10, 1, 0)).toBe(true);
    expect(withinTolerance(8.99, 10, 1, 0)).toBe(false);
  });
});

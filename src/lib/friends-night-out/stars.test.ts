import { describe, expect, it } from "vitest";
import { blendedStars } from "./stars";

describe("blendedStars", () => {
  it("is the AI rating when nobody has rated", () => {
    expect(blendedStars({ aiStars: 4, ratingCount: 0, ratingSum: 0 })).toEqual({
      value: 4, rounded: 4, source: "ai",
    });
  });

  it("weights AI as three votes", () => {
    // (3*3 + 5+5+5) / 6 = 4
    expect(blendedStars({ aiStars: 3, ratingCount: 3, ratingSum: 15 })).toEqual({
      value: 4, rounded: 4, source: "blend",
    });
  });

  it("lets ten ratings mostly decide", () => {
    // (2*3 + 50) / 13 = 4.307… → 4.3
    const s = blendedStars({ aiStars: 2, ratingCount: 10, ratingSum: 50 });
    expect(s.value).toBe(4.3);
    expect(s.rounded).toBe(4);
  });

  it("uses community only when there is no AI rating and 3+ ratings", () => {
    expect(blendedStars({ aiStars: null, ratingCount: 3, ratingSum: 13 })).toEqual({
      value: 4.3, rounded: 4, source: "community",
    });
  });

  it("returns none below three ratings with no AI", () => {
    expect(blendedStars({ aiStars: null, ratingCount: 2, ratingSum: 10 })).toEqual({
      value: null, rounded: null, source: "none",
    });
  });

  it("clamps to 1..5", () => {
    expect(blendedStars({ aiStars: 9, ratingCount: 0, ratingSum: 0 }).value).toBe(5);
    expect(blendedStars({ aiStars: 0, ratingCount: 0, ratingSum: 0 }).value).toBe(1);
  });
});

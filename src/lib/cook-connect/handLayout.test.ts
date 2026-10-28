import { describe, it, expect } from "vitest";
import { fanExtent, handLayout, MAX_CW } from "./handLayout";

describe("your hand always fits", () => {
  it("never clips a card from 340px phones to a wide desktop", () => {
    for (const w of [340, 360, 375, 390, 414, 430, 600, 768, 820]) {
      for (const n of [1, 5, 9, 13]) {
        const L = handLayout(w, n);
        const e = fanExtent(w, L, n);
        expect(e.left, `left edge at ${w}px, ${n} cards`).toBeGreaterThanOrEqual(0);
        expect(e.right, `right edge at ${w}px, ${n} cards`).toBeLessThanOrEqual(w);
      }
    }
  });

  it("keeps cards big: about 70px+ on a 375px phone, full size on a desktop", () => {
    expect(handLayout(375 + 20, 13).cw).toBeGreaterThanOrEqual(70);
    expect(handLayout(820, 13).cw).toBe(MAX_CW);
  });

  it("shows enough of each card for its big corner index", () => {
    for (const w of [360, 430, 820]) {
      const L = handLayout(w, 13);
      expect(L.step).toBeGreaterThanOrEqual(L.cw * 0.28);
      expect(L.rank).toBeGreaterThanOrEqual(22);
      expect(L.rank).toBeLessThanOrEqual(L.cw * 0.4);
    }
  });

  it("spreads a short hand out instead of bunching it", () => {
    expect(handLayout(400, 3).step).toBeGreaterThan(handLayout(400, 13).step);
  });
});

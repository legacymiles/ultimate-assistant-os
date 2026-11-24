import { describe, expect, it } from "vitest";
import { pinOnStage, stillTrail, sweepPoint, wordSize, wordStream } from "./scan";
import { SEED } from "./seed";

describe("prompt scan", () => {
  it("turns a prompt into a long uppercase stream", () => {
    const s = wordStream("a whale,  in the sky", 100);
    expect(s.startsWith("A WHALE, IN THE SKY · ")).toBe(true);
    expect(s.length).toBeGreaterThanOrEqual(100);
    expect(wordStream("   ")).toBe("");
  });

  it("keeps the idle scanner inside the frame for a long time", () => {
    for (let t = 0; t < 600; t += 0.37) {
      const [x, y] = sweepPoint(t);
      expect(x).toBeGreaterThanOrEqual(0.03);
      expect(x).toBeLessThanOrEqual(0.97);
      expect(y).toBeGreaterThanOrEqual(0.03);
      expect(y).toBeLessThanOrEqual(0.97);
    }
  });

  it("bakes a still trail with a fresh head and an aged tail", () => {
    const t = stillTrail();
    expect(t.length).toBeGreaterThan(10);
    expect(t[t.length - 1].age).toBe(0);
    expect(t[0].age).toBeGreaterThan(0.5);
  });

  it("places a pin through the cover crop, and hides pins the crop cuts off", () => {
    // Same aspect: no crop, the point lands where it is.
    expect(pinOnStage(0.5, 0.5, 1600, 900, 800, 450)).toEqual([0.5, 0.5]);
    // A wide image on a tall phone stage crops the sides away.
    expect(pinOnStage(0.05, 0.5, 1344, 768, 390, 700)).toBeNull();
    const mid = pinOnStage(0.5, 0.3, 1344, 768, 390, 700)!;
    expect(mid[0]).toBeCloseTo(0.5);
    expect(mid[1]).toBeCloseTo(0.3);
  });

  it("gives every featured image pins inside its frame", () => {
    const featured = SEED.filter((s) => s.featured);
    expect(featured.length).toBeGreaterThanOrEqual(5);
    for (const s of featured) {
      expect(s.aspect, s.id).toBe("wide");
      expect(s.pins?.length ?? 0, s.id).toBeGreaterThanOrEqual(6);
      for (const [, , x, y] of s.pins!) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(1);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(1);
      }
    }
  });

  it("sizes the words for the surface", () => {
    expect(wordSize(1200, "hero")).toBeGreaterThan(wordSize(390, "hero"));
    expect(wordSize(200, "card")).toBeLessThan(wordSize(400, "card"));
  });
});

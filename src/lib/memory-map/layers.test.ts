import { describe, expect, it } from "vitest";
import { SHELLS, applyShells, autoFlat, flatPoint, outerRadius } from "./layers";

const radius = (p: Float32Array, i: number) => Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);

describe("shells", () => {
  it("pulls each layer onto its own shell, you to the centre", () => {
    const p = new Float32Array([0.3, 0.1, 0, 0.9, 0, 0, 0.1, 0.1, 0.1, 0.2, 0, 0.05]);
    const layers = [0, 1, 2, 3];
    for (let t = 0; t < 400; t++) applyShells(p, layers, 1, 0.1);
    expect(radius(p, 0)).toBeLessThan(0.01);
    expect(radius(p, 1)).toBeCloseTo(SHELLS[1], 2);
    expect(radius(p, 2)).toBeCloseTo(SHELLS[2], 2);
    expect(radius(p, 3)).toBeCloseTo(SHELLS[3], 2);
  });
  it("keeps a node's direction while it moves", () => {
    const p = new Float32Array([0.2, 0.2, 0]);
    applyShells(p, [3], 1, 0.5);
    expect(p[0]).toBeCloseTo(p[1], 6);
    expect(p[2]).toBe(0);
  });
  it("gives a node stuck at the centre a way out", () => {
    const p = new Float32Array([0, 0, 0]);
    applyShells(p, [2], 1, 0.1);
    expect(radius(p, 0)).toBeGreaterThan(0);
  });
  it("sizes the outer shell from where the web is", () => {
    const p = new Float32Array(30);
    for (let i = 0; i < 10; i++) p[i * 3] = (i + 1) / 10;
    expect(outerRadius(p, 10)).toBeCloseTo(0.8, 5);
    expect(outerRadius(new Float32Array(0), 0)).toBe(1);
  });
});

describe("flat view", () => {
  it("puts a node on its layer's ring at its own angle", () => {
    const [x, y] = flatPoint(1, 0, 0, 2, 1);
    expect(Math.hypot(x, y)).toBeCloseTo(SHELLS[2], 6);
    expect(flatPoint(0.4, 0.2, 0.1, 0, 1)).toEqual([0, 0]);
  });
  it("unfolds as you zoom out, unless forced", () => {
    expect(autoFlat(1, null)).toBe(0);
    expect(autoFlat(0.42, null)).toBeCloseTo(1, 5);
    expect(autoFlat(0.51, null)).toBeGreaterThan(0);
    expect(autoFlat(1, true)).toBe(1);
    expect(autoFlat(0.3, false)).toBe(0);
  });
});

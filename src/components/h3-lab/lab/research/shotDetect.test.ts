import { describe, expect, it } from "vitest";
import { colorHistogram, detectShots, histDistance, keyframeTimes, sampleDistances, threshold } from "./shotDetect";

/** A flat-colour frame as RGBA pixels. */
function frame(r: number, g: number, b: number, noise = 0, seed = 1): Uint8ClampedArray {
  const px = new Uint8ClampedArray(64 * 36 * 4);
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r + (rnd() - 0.5) * noise;
    px[i + 1] = g + (rnd() - 0.5) * noise;
    px[i + 2] = b + (rnd() - 0.5) * noise;
    px[i + 3] = 255;
  }
  return px;
}

/** Synthetic clip: a list of [seconds, colour] segments sampled every 0.25 s. */
function clip(segments: [number, [number, number, number]][], noise = 30) {
  const times: number[] = [];
  const hists: Float32Array[] = [];
  let t = 0;
  let seed = 7;
  for (const [len, [r, g, b]] of segments) {
    const end = t + len;
    for (; t < end - 1e-9; t += 0.25) {
      times.push(Math.round(t * 100) / 100);
      hists.push(colorHistogram(frame(r, g, b, noise, seed++)));
    }
  }
  const duration = segments.reduce((s, [len]) => s + len, 0);
  return { times, distances: sampleDistances(hists.map((hist) => ({ hist }))), duration };
}

describe("histogram + distance", () => {
  it("is normalised and identical frames are distance 0", () => {
    const h = colorHistogram(frame(200, 40, 40));
    expect(h.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5);
    expect(histDistance(h, colorHistogram(frame(200, 40, 40)))).toBe(0);
  });

  it("disjoint colours are distance 1", () => {
    expect(histDistance(colorHistogram(frame(250, 5, 5)), colorHistogram(frame(5, 5, 250)))).toBeCloseTo(1, 5);
  });
});

describe("threshold", () => {
  it("never drops below the floor on a static clip", () => {
    expect(threshold([0.01, 0.012, 0.009, 0.011], 3, 0.18)).toBe(0.18);
  });

  it("is not inflated by a few large cuts (robust statistic)", () => {
    const quiet = Array.from({ length: 40 }, (_, i) => 0.03 + (i % 5) * 0.005);
    const withCuts = [...quiet, 0.9, 0.95, 0.85];
    expect(threshold(withCuts, 3, 0.05)).toBeLessThan(0.2);
  });
});

describe("detectShots", () => {
  it("finds no cut in one continuous shot", () => {
    const c = clip([[6, [120, 80, 60]]]);
    const shots = detectShots(c.times, c.distances, c.duration);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ start: 0, cutStrength: 0 });
    expect(shots[0].end).toBe(6);
  });

  it("finds hard cuts between differently coloured shots, at the right times", () => {
    const c = clip([
      [3, [200, 40, 40]],
      [2, [40, 200, 40]],
      [4, [40, 40, 200]],
    ]);
    const shots = detectShots(c.times, c.distances, c.duration);
    expect(shots).toHaveLength(3);
    expect(shots[1].start).toBeCloseTo(2.875, 2);
    expect(shots[2].start).toBeCloseTo(4.875, 2);
    expect(shots[1].cutStrength).toBeGreaterThan(0.5);
    expect(shots[0].cutStrength).toBe(0);
  });

  it("merges a shot shorter than 0.5 s into a neighbour", () => {
    const c = clip([
      [3, [200, 40, 40]],
      [0.25, [255, 255, 255]], // a one-sample flash
      [3, [40, 40, 200]],
    ]);
    const shots = detectShots(c.times, c.distances, c.duration);
    expect(shots.every((s) => s.end - s.start >= 0.5)).toBe(true);
    expect(shots.length).toBe(2);
  });

  it("a higher floor keeps only the strong cuts", () => {
    const c = clip([
      [2, [126, 100, 90]],
      [2, [129, 100, 90]], // a subtle cut: some pixels cross one bin edge
      [2, [40, 40, 200]], // a hard cut
    ], 10);
    expect(c.distances.slice(1).filter((d) => d > 0.05 && d < 0.6).length).toBeGreaterThan(0);
    const loose = detectShots(c.times, c.distances, c.duration, { sensitivity: 2, floor: 0.05 });
    const strict = detectShots(c.times, c.distances, c.duration, { sensitivity: 2, floor: 0.6 });
    expect(loose.length).toBeGreaterThan(strict.length);
    expect(strict).toHaveLength(2);
  });

  it("caps the number of shots, keeping the strongest cuts", () => {
    const segs: [number, [number, number, number]][] = Array.from({ length: 12 }, (_, i) => [1, i % 2 ? [250, 10, 10] : [10, 10, 250]] as [number, [number, number, number]]);
    const c = clip(segs);
    const shots = detectShots(c.times, c.distances, c.duration, { maxShots: 5 });
    expect(shots).toHaveLength(5);
    expect(shots[shots.length - 1].end).toBe(12);
  });

  it("keyframe times sit inside the shot", () => {
    expect(keyframeTimes({ start: 2, end: 4 }, 3)).toEqual([2.15, 3, 3.85]);
    expect(keyframeTimes({ start: 2, end: 4 }, 2)).toEqual([2.15, 3.85]);
  });
});

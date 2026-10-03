import { describe, expect, it } from "vitest";
import { BPM_MARKS, BPM_MAX, BPM_MIN, clampBpm, tempoFeel } from "./tempo";

describe("clampBpm", () => {
  it("keeps a sane tempo as it is", () => {
    expect(clampBpm(140)).toBe(140);
  });

  it("holds the slider's own range", () => {
    expect(clampBpm(0)).toBe(BPM_MIN);
    expect(clampBpm(9999)).toBe(BPM_MAX);
  });

  it("falls back to 120 rather than NaN, which would break the slider", () => {
    expect(clampBpm(Number.NaN)).toBe(120);
    expect(clampBpm(Number.parseInt("", 10))).toBe(120);
  });

  it("rounds, because a BPM of 93.4 is not a thing anyone asked for", () => {
    expect(clampBpm(93.4)).toBe(93);
  });
});

describe("BPM_MARKS", () => {
  it("are inside the slider and in order", () => {
    const bpms = BPM_MARKS.map((m) => m.bpm);
    expect(bpms).toEqual([...bpms].sort((a, b) => a - b));
    expect(Math.min(...bpms)).toBeGreaterThanOrEqual(BPM_MIN);
    expect(Math.max(...bpms)).toBeLessThanOrEqual(BPM_MAX);
  });
});

describe("tempoFeel", () => {
  it("names styles rather than adjectives", () => {
    expect(tempoFeel(92)).toMatch(/boom-bap/);
    expect(tempoFeel(124)).toMatch(/house/);
    expect(tempoFeel(174)).toMatch(/drum and bass/);
  });

  it("warns that a drill tempo is counted at half speed", () => {
    const line = tempoFeel(140);
    expect(line).toMatch(/70/);
    expect(line).toMatch(/drill/);
  });

  it("answers for every tempo the slider can reach", () => {
    for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm++) {
      expect(tempoFeel(bpm), String(bpm)).toMatch(new RegExp(`${bpm} BPM`));
    }
  });
});

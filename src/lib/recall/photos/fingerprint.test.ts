import { describe, expect, it } from "vitest";
import {
  LOOKALIKE_MAX_DISTANCE,
  dHashFromGray,
  findDuplicate,
  grayFromRGBA,
  hammingHex,
} from "./fingerprint";

/** A 9×8 grey grid from a function of (x, y). */
function grid(f: (x: number, y: number) => number): number[] {
  const out: number[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) out.push(f(x, y));
  return out;
}

const gradient = grid((x, y) => (x * 37 + y * 11) % 256);

describe("dHashFromGray", () => {
  it("produces a 16-character hex fingerprint", () => {
    expect(dHashFromGray(gradient)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gives the same fingerprint for the same picture", () => {
    expect(dHashFromGray(gradient)).toBe(dHashFromGray([...gradient]));
  });

  it("is unchanged by uniform brightening, as a re-exported photo often is", () => {
    const brighter = gradient.map((g) => g + 20);
    expect(dHashFromGray(brighter)).toBe(dHashFromGray(gradient));
  });

  it("returns empty for a wrongly sized grid, so bad input never matches", () => {
    expect(dHashFromGray([1, 2, 3])).toBe("");
  });
});

describe("hammingHex", () => {
  it("is 0 for identical fingerprints", () => {
    expect(hammingHex("00ff00ff00ff00ff", "00ff00ff00ff00ff")).toBe(0);
  });

  it("counts differing bits", () => {
    expect(hammingHex("0000000000000000", "0000000000000003")).toBe(2);
    expect(hammingHex("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  it("never matches malformed input", () => {
    expect(hammingHex("", "00")).toBe(Infinity);
    expect(hammingHex("0f", "0ff")).toBe(Infinity);
    expect(hammingHex("zz", "00")).toBe(Infinity);
  });
});

describe("look-alike detection", () => {
  it("flags a photo with a little noise as the same picture", () => {
    const noisy = gradient.slice();
    noisy[40] += 3; // one pixel nudged, as re-compression does
    const a = dHashFromGray(gradient);
    const b = dHashFromGray(noisy);
    expect(hammingHex(a, b)).toBeLessThanOrEqual(LOOKALIKE_MAX_DISTANCE);
  });

  it("does not flag a genuinely different picture", () => {
    const mirrored = grid((x, y) => ((8 - x) * 37 + y * 11) % 256);
    expect(hammingHex(dHashFromGray(gradient), dHashFromGray(mirrored))).toBeGreaterThan(
      LOOKALIKE_MAX_DISTANCE,
    );
  });
});

describe("findDuplicate", () => {
  const candidates = [
    { id: "a", hash: "0000000000000000", label: "My Little Family" },
    { id: "b", hash: "0000000000000001", label: "Waiting for review" },
    { id: "c", hash: "ffffffffffffffff", label: "Group Photos" },
  ];

  it("names the nearest look-alike", () => {
    const m = findDuplicate("0000000000000001", candidates);
    expect(m).toEqual({ id: "b", label: "Waiting for review", distance: 0, identical: true });
  });

  it("never reports a photo as a duplicate of itself", () => {
    const m = findDuplicate("0000000000000001", candidates, "b");
    expect(m?.id).toBe("a");
    expect(m?.identical).toBe(false);
  });

  it("returns null when nothing is close enough", () => {
    expect(findDuplicate("0f0f0f0f0f0f0f0f", candidates)).toBeNull();
  });

  it("returns null when there is no fingerprint to compare", () => {
    expect(findDuplicate(undefined, candidates)).toBeNull();
  });
});

describe("grayFromRGBA", () => {
  it("weights green most and blue least, as the eye does", () => {
    const [r, g, b] = grayFromRGBA([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
  });
});

import { describe, expect, it } from "vitest";
import { quantize } from "./palette";

/** A white canvas with a yellow shirt block and a smaller blue block. */
function picture(): { data: Uint8ClampedArray; w: number; h: number } {
  const w = 40, h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let c = [255, 255, 255];
      if (x >= 10 && x < 30 && y >= 8 && y < 24) c = [246, 207, 85]; // shirt
      if (x >= 12 && x < 28 && y >= 24 && y < 32) c = [76, 111, 181]; // shorts
      data.set([...c, 255], i);
    }
  }
  return { data, w, h };
}

describe("quantize", () => {
  it("returns the character's colours, biggest first, without the background", () => {
    const { data, w, h } = picture();
    const out = quantize(data, w, h);
    expect(out[0]).toBe("#f6cf55");
    expect(out[1]).toBe("#4c6fb5");
    expect(out).not.toContain("#ffffff");
  });
  it("ignores transparent pixels", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4); // all alpha 0
    expect(quantize(data, 4, 4)).toEqual([]);
  });
});

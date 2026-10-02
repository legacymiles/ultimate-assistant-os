import { describe, expect, it } from "vitest";
import { CAPTURE_WARNING, fitTo, MAX_EDGE } from "./screenCapture";

describe("fitTo", () => {
  it("shrinks a 4K screen so it is never sent at 4K", () => {
    const out = fitTo(3840, 2160);
    expect(Math.max(out.width, out.height)).toBe(MAX_EDGE);
    expect(out.width / out.height).toBeCloseTo(3840 / 2160, 2);
  });

  it("never blows a small window UP, which would only make it blurrier", () => {
    expect(fitTo(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it("works on a tall window as well as a wide one", () => {
    const out = fitTo(1080, 3840);
    expect(out.height).toBe(MAX_EDGE);
    expect(out.width).toBeLessThan(out.height);
  });

  it("never rounds a thin strip down to nothing", () => {
    // A 1px-tall share is absurd, but a zero-height canvas throws.
    const out = fitTo(4000, 1);
    expect(out.height).toBeGreaterThanOrEqual(1);
    expect(out.width).toBeGreaterThanOrEqual(1);
  });

  it("survives a zero-sized frame rather than dividing by it", () => {
    expect(fitTo(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it("honours a tighter limit when it is given one", () => {
    expect(Math.max(...Object.values(fitTo(3840, 2160, 800)))).toBe(800);
  });
});

describe("the warning", () => {
  it("tells the owner the three things they need BEFORE the picker opens", () => {
    // Afterwards is too late — by then the frame has been read.
    expect(CAPTURE_WARNING).toMatch(/not saved/i);
    expect(CAPTURE_WARNING).toMatch(/window/i);
    expect(CAPTURE_WARNING).toMatch(/password/i);
  });
});

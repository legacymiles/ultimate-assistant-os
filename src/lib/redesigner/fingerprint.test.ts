import { describe, expect, it } from "vitest";
import { fingerprint, hexToRgb } from "./fingerprint";

describe("fingerprint", () => {
  it("is empty for an empty box", () => {
    expect(fingerprint("").label).toBe("0x0000");
    expect(fingerprint("   ").seed).toBe(0);
  });

  it("is deterministic and case/whitespace insensitive", () => {
    expect(fingerprint("stripe.com")).toEqual(fingerprint("  STRIPE.com "));
  });

  it("changes on a single character — typing has to feel live", () => {
    const a = fingerprint("stripe.com");
    const b = fingerprint("stripe.co");
    expect(a.label).not.toBe(b.label);
    expect(a.seed).not.toBe(b.seed);
  });

  it("stays inside the ranges the shader expects", () => {
    for (const url of ["a", "linear.app", "https://vercel.com/pricing", "x".repeat(300)]) {
      const f = fingerprint(url);
      expect(f.seed).toBeGreaterThanOrEqual(0);
      expect(f.seed).toBeLessThan(100);
      expect(f.flow).toBeGreaterThanOrEqual(0);
      expect(f.flow).toBeLessThanOrEqual(1);
      expect(f.turbulence).toBeGreaterThanOrEqual(0);
      expect(f.turbulence).toBeLessThanOrEqual(1);
      expect(f.label).toMatch(/^0x[0-9A-F]{4}$/);
    }
  });
});

describe("hexToRgb", () => {
  it("parses with and without the hash", () => {
    expect(hexToRgb("#FF4D2E")).toEqual([1, 77 / 255, 46 / 255]);
    expect(hexToRgb("050505")).toEqual([5 / 255, 5 / 255, 5 / 255]);
  });

  it("rejects anything else", () => {
    expect(hexToRgb("")).toBeNull();
    expect(hexToRgb("#fff")).toBeNull();
    expect(hexToRgb("rebeccapurple")).toBeNull();
  });
});

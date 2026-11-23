import { describe, expect, it } from "vitest";
import { FREE_TRIES, checkPin, hashPin, lockoutMs, newSalt, pinProblem } from "./password";

describe("pinProblem", () => {
  it("accepts 4 to 8 mixed digits", () => {
    expect(pinProblem("2580")).toBeNull();
    expect(pinProblem("19283746")).toBeNull();
  });

  it("refuses letters, short and long passwords", () => {
    expect(pinProblem("12a4")).toMatch(/Numbers only/);
    expect(pinProblem("193")).toMatch(/At least/);
    expect(pinProblem("192837465")).toMatch(/At most/);
  });

  it("refuses what a mashing hand types: one key, or a run along the pad", () => {
    expect(pinProblem("1111")).toMatch(/repeated/);
    expect(pinProblem("1234")).toMatch(/run/);
    expect(pinProblem("98765")).toMatch(/run/);
  });
});

describe("hashPin / checkPin", () => {
  it("never stores the digits and round-trips the right password", async () => {
    const salt = newSalt();
    const stored = await hashPin("2580", salt);
    expect(stored).not.toContain("2580");
    expect(await checkPin("2580", salt, stored)).toBe(true);
    expect(await checkPin("2581", salt, stored)).toBe(false);
  });

  it("salts, so the same password is stored differently twice", async () => {
    const a = await hashPin("2580", newSalt());
    const b = await hashPin("2580", newSalt());
    expect(a).not.toBe(b);
  });

  it("refuses when nothing is stored", async () => {
    expect(await checkPin("2580", "", "")).toBe(false);
  });
});

describe("lockoutMs", () => {
  it("lets a fumbling parent try a few times, then makes a mashing hand wait longer and longer", () => {
    expect(lockoutMs(0)).toBe(0);
    expect(lockoutMs(FREE_TRIES - 1)).toBe(0);
    expect(lockoutMs(FREE_TRIES)).toBe(30_000);
    expect(lockoutMs(FREE_TRIES + 1)).toBe(60_000);
    expect(lockoutMs(FREE_TRIES + 20)).toBe(5 * 60_000);
  });
});

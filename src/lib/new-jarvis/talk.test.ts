import { describe, expect, it } from "vitest";
import { talkDrive, talkHue } from "./talk";

describe("talkDrive", () => {
  it("ignores room noise", () => {
    expect(talkDrive(0)).toBe(0);
    expect(talkDrive(0.02)).toBe(0);
  });
  it("rises with speech and stays within 0..1", () => {
    expect(talkDrive(0.15)).toBeGreaterThan(0.5);
    expect(talkDrive(0.3)).toBeGreaterThan(talkDrive(0.15));
    expect(talkDrive(5)).toBeLessThanOrEqual(1);
  });
  it("treats bad input as silence", () => {
    expect(talkDrive(Number.NaN)).toBe(0);
    expect(talkDrive(-1)).toBe(0);
  });
});

describe("talkHue", () => {
  it("warms for Jarvis, cools for you, nothing when quiet", () => {
    expect(talkHue("jarvis")).toBeGreaterThan(0);
    expect(talkHue("you")).toBeLessThan(0);
    expect(talkHue("none")).toBe(0);
  });
});

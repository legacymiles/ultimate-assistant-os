import { describe, expect, it } from "vitest";
import { shotsPerSubject } from "./vision";

// The bug this file exists to prevent: the sheet used to draw two shots per
// person no matter what, so the third and fourth photo of somebody were stored,
// synced, counted on their card — and never looked at. "Add more photos" has to
// be honest advice, which means every extra photo has to reach the sheet until
// the budget genuinely runs out.
describe("shotsPerSubject", () => {
  it("gives a small family every angle they uploaded", () => {
    expect(shotsPerSubject(1)).toBe(4);
    expect(shotsPerSubject(3)).toBe(4);
    expect(shotsPerSubject(7)).toBe(4);
  });

  it("thins the allowance rather than dropping the last people added", () => {
    expect(shotsPerSubject(10)).toBe(2);
    expect(shotsPerSubject(14)).toBe(2);
    expect(shotsPerSubject(20)).toBe(1);
  });

  it("never drops a subject off the sheet entirely", () => {
    expect(shotsPerSubject(60)).toBe(1);
  });

  it("keeps the sheet inside its tile budget", () => {
    for (const n of [1, 2, 5, 9, 15, 28, 40]) {
      expect(n * shotsPerSubject(n)).toBeLessThanOrEqual(Math.max(28, n));
    }
  });

  it("asks for nothing when nobody is labelled", () => {
    expect(shotsPerSubject(0)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { bandOf, calibrate, clamp01, passesFilter, recordOutcome, sortByConfidence, type Outcome } from "./calibrate";

const many = (kind: string, raw: number, ok: boolean, n: number): Outcome[] =>
  Array.from({ length: n }, (_, i) => ({ kind, raw, ok, at: new Date(2026, 9, 1 + i).toISOString() }));

describe("calibrate", () => {
  it("is the model's own read when there is no history", () => {
    const c = calibrate(0.9, "todo", []);
    expect(c.score).toBe(90);
    expect(c.band).toBe("high");
    expect(c.why).toMatch(/No history/);
  });

  it("drops a kind the owner keeps declining, however sure the model is", () => {
    const c = calibrate(0.95, "event", many("event", 0.95, false, 12));
    expect(c.score).toBeLessThan(50);
    expect(c.why).toMatch(/0 of the last 12/);
  });

  it("rises for a kind the owner keeps approving", () => {
    const c = calibrate(0.55, "birthday", many("birthday", 0.55, true, 10));
    expect(c.score).toBeGreaterThan(75);
  });

  it("learns how honest the model's numbers are across kinds", () => {
    // The model said 0.9 for other kinds and was right only a third of the time.
    const history = [...many("todo", 0.9, false, 8), ...many("todo", 0.9, true, 4)];
    expect(calibrate(0.9, "queue", history).score).toBeLessThan(90);
  });

  it("reads 87 as 0.87 and junk as the fallback", () => {
    expect(clamp01(87)).toBe(0.87);
    expect(clamp01("0.4")).toBe(0.4);
    expect(clamp01("nope", 0.6)).toBe(0.6);
    expect(clamp01(-3)).toBe(0);
  });

  it("keeps a bounded history", () => {
    let list: Outcome[] = [];
    for (let i = 0; i < 350; i++) list = recordOutcome(list, { kind: "todo", raw: 0.5, ok: true });
    expect(list).toHaveLength(300);
  });
});

describe("sorting and filtering", () => {
  const items = [
    { id: "a", s: 40, t: 3 },
    { id: "b", s: 90, t: 1 },
    { id: "c", s: null as number | null, t: 4 },
    { id: "d", s: 90, t: 2 },
  ];
  const sort = (m: "newest" | "most" | "least") => sortByConfidence(items, m, (x) => x.s, (x) => x.t).map((x) => x.id);

  it("most sure first, ties newest first, unscored last", () => {
    expect(sort("most")).toEqual(["d", "b", "a", "c"]);
    expect(sort("least")).toEqual(["a", "d", "b", "c"]);
    expect(sort("newest")).toEqual(["c", "a", "d", "b"]);
  });

  it("filters by band", () => {
    expect(bandOf(80)).toBe("high");
    expect(bandOf(79)).toBe("medium");
    expect(bandOf(49)).toBe("low");
    expect(passesFilter(85, "high")).toBe(true);
    expect(passesFilter(null, "high")).toBe(false);
    expect(passesFilter(null, "all")).toBe(true);
  });
});

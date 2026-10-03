import { describe, expect, it } from "vitest";
import { fmtMoney, progress, stepCost, timeline, totals, verifiedShare } from "./totals";
import type { Material, Phase, Plan, Step } from "./types";

function material(over: Partial<Material> = {}): Material {
  return {
    id: "m1",
    name: "pine moulding",
    qty: 2,
    unit: "ft",
    unitCost: { low: 3, high: 4, currency: "USD" },
    provenance: "estimate",
    supplierIds: [],
    ...over,
  };
}

function step(over: Partial<Step> = {}): Step {
  return {
    id: "s1",
    title: "Cut the moulding",
    detail: "",
    provenance: "estimate",
    materials: [],
    suppliers: [],
    done: false,
    skipped: false,
    ...over,
  };
}

function plan(phases: Phase[]): Plan {
  return {
    version: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    model: "test",
    summary: "",
    assumptions: [],
    openQuestions: [],
    phases,
    extras: [],
  };
}

const phase = (steps: Step[], over: Partial<Phase> = {}): Phase => ({
  id: "p1",
  title: "Phase",
  goal: "",
  steps,
  ...over,
});

describe("stepCost", () => {
  it("uses the step's own cost and does NOT add its materials on top", () => {
    const s = step({
      cost: { low: 20, high: 25, currency: "USD" },
      materials: [material()],
    });
    expect(stepCost(s)).toEqual({ low: 20, high: 25, currency: "USD" });
  });

  it("sums materials when the step has no cost of its own", () => {
    const s = step({ materials: [material({ qty: 2 })] });
    expect(stepCost(s)).toEqual({ low: 6, high: 8, currency: "USD" });
  });

  it("costs nothing for a skipped step, whatever it carries", () => {
    expect(stepCost(step({ skipped: true, cost: { low: 99, high: 99, currency: "USD" } }))).toBeNull();
  });

  it("is null for a step nobody has costed", () => {
    expect(stepCost(step())).toBeNull();
  });
});

describe("totals", () => {
  it("adds every costed step across every phase", () => {
    const p = plan([
      phase([step({ cost: { low: 10, high: 20, currency: "USD" } })]),
      phase([step({ id: "s2", materials: [material({ qty: 1 })] })], { id: "p2" }),
    ]);
    expect(totals(p).cost).toEqual({ low: 13, high: 24, currency: "USD" });
    expect(totals(p).mixed).toBe(false);
  });

  it("refuses to sum two currencies rather than inventing an exchange rate", () => {
    const p = plan([
      phase([
        step({ cost: { low: 10, high: 10, currency: "USD" } }),
        step({ id: "s2", cost: { low: 10, high: 10, currency: "EUR" } }),
      ]),
    ]);
    expect(totals(p).mixed).toBe(true);
    expect(totals(p).cost).toBeNull();
  });

  it("counts how much of the plan is not costed, so the sheet can say so", () => {
    const p = plan([
      phase([step({ cost: { low: 5, high: 5, currency: "USD" } }), step({ id: "s2" })]),
    ]);
    expect(totals(p).costedSteps).toBe(1);
    expect(totals(p).uncostedSteps).toBe(1);
  });

  it("is null, not zero, for a plan with nothing costed", () => {
    expect(totals(plan([phase([step()])])).cost).toBeNull();
  });
});

describe("progress", () => {
  it("counts done over total, ignoring skipped steps entirely", () => {
    const p = plan([
      phase([
        step({ done: true }),
        step({ id: "s2" }),
        step({ id: "s3", skipped: true }),
      ]),
    ]);
    expect(progress(p)).toEqual({ done: 1, total: 2 });
  });
});

describe("timeline", () => {
  it("adds phase days and the hands-on hours of unskipped steps", () => {
    const p = plan([
      phase([step({ hours: 2 }), step({ id: "s2", hours: 5, skipped: true })], { days: 3 }),
      phase([step({ id: "s3", hours: 1 })], { id: "p2", days: 4 }),
    ]);
    expect(timeline(p)).toEqual({ days: 7, hours: 3 });
  });
});

describe("verifiedShare", () => {
  it("is the share of COSTED steps whose price was actually checked", () => {
    const p = plan([
      phase([
        step({ cost: { low: 1, high: 1, currency: "USD" }, provenance: "verified" }),
        step({ id: "s2", cost: { low: 1, high: 1, currency: "USD" }, provenance: "estimate" }),
        step({ id: "s3" }), // uncosted: not part of the question
      ]),
    ]);
    expect(verifiedShare(p)).toBe(0.5);
  });

  it("is 0 when nothing is costed, and never NaN", () => {
    expect(verifiedShare(plan([phase([step()])]))).toBe(0);
  });
});

describe("fmtMoney", () => {
  it("shows a range, collapses an exact figure, and says nothing for null", () => {
    expect(fmtMoney({ low: 380, high: 520, currency: "USD" })).toBe("$380–$520");
    expect(fmtMoney({ low: 90, high: 90, currency: "USD" })).toBe("$90");
    expect(fmtMoney(null)).toBe("—");
  });
});

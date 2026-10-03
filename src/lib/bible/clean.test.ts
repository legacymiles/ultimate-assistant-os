import { describe, expect, it } from "vitest";
import { cleanOps, cleanPlan } from "./clean";

const ok = {
  summary: "Build and sell a first batch of picture frames",
  assumptions: ["garage workshop", "no van"],
  openQuestions: ["what size frames?"],
  phases: [
    {
      title: "Buy the stock",
      goal: "materials on hand",
      days: 3,
      steps: [
        {
          title: "Buy moulding",
          detail: "8ft lengths, primed pine.",
          cost: { low: 40, high: 60, currency: "USD" },
          hours: 1,
          materials: [{ name: "pine moulding", qty: 32, unit: "ft", unitCost: { low: 1.2, high: 1.8, currency: "USD" } }],
          suppliers: [{ name: "Local lumber yard", what: "moulding" }],
          check: "No warp when you sight down the length.",
        },
      ],
    },
  ],
};

describe("cleanPlan", () => {
  it("gives every phase, step, material and supplier a unique id", () => {
    const plan = cleanPlan(ok, "test-model", "USD")!;
    const ids = [
      ...plan.phases.map((p) => p.id),
      ...plan.phases.flatMap((p) => p.steps.map((s) => s.id)),
      ...plan.phases.flatMap((p) => p.steps.flatMap((s) => s.materials.map((m) => m.id))),
      ...plan.phases.flatMap((p) => p.steps.flatMap((s) => s.suppliers.map((x) => x.id))),
    ];
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("starts at version 1, records the model, and nothing is done yet", () => {
    const plan = cleanPlan(ok, "test-model", "USD")!;
    expect(plan.version).toBe(1);
    expect(plan.model).toBe("test-model");
    expect(plan.phases[0].steps[0].done).toBe(false);
    expect(plan.phases[0].steps[0].skipped).toBe(false);
  });

  // Section 7 of the spec, enforced where it cannot be argued with.
  it("throws away business-formation advice the model volunteered", () => {
    const pushy = {
      ...ok,
      extras: [{ topic: "legal-structure", body: "First, form an LLC…" }],
    };
    expect(cleanPlan(pushy, "test-model", "USD")!.extras).toEqual([]);
  });

  it("marks every cost an estimate however the model labelled it", () => {
    const boastful = structuredClone(ok) as Record<string, any>;
    boastful.phases[0].steps[0].provenance = "verified";
    boastful.phases[0].steps[0].suppliers[0].source = "https://invented.example";
    const step = cleanPlan(boastful, "test-model", "USD")!.phases[0].steps[0];
    expect(step.provenance).toBe("estimate");
    // A source is a thing the verify pass earns, not a thing a generation claims.
    expect(step.suppliers[0].source).toBeUndefined();
  });

  it("repairs a backwards range and drops a cost that is not numbers", () => {
    const wonky = structuredClone(ok) as Record<string, any>;
    wonky.phases[0].steps[0].cost = { low: 90, high: 20, currency: "USD" };
    wonky.phases[0].steps[0].materials[0].unitCost = { low: "cheap", high: 4 };
    const step = cleanPlan(wonky, "test-model", "USD")!.phases[0].steps[0];
    expect(step.cost).toEqual({ low: 20, high: 90, currency: "USD" });
    expect(step.materials[0].unitCost).toBeUndefined();
  });

  it("falls back to the home currency when the model forgot one", () => {
    const vague = structuredClone(ok) as Record<string, any>;
    delete vague.phases[0].steps[0].cost.currency;
    expect(cleanPlan(vague, "test-model", "GBP")!.phases[0].steps[0].cost!.currency).toBe("GBP");
  });

  it("keeps a legal flag as a question with somebody to ask, or not at all", () => {
    const flagged = structuredClone(ok) as Record<string, any>;
    flagged.phases[0].steps[0].legal = { question: "Do I need a resale certificate?", whoToAsk: "state revenue office" };
    expect(cleanPlan(flagged, "test-model", "USD")!.phases[0].steps[0].legal).toEqual({
      question: "Do I need a resale certificate?",
      whoToAsk: "state revenue office",
    });

    const half = structuredClone(ok) as Record<string, any>;
    half.phases[0].steps[0].legal = { question: "Is this allowed?" };
    expect(cleanPlan(half, "test-model", "USD")!.phases[0].steps[0].legal).toBeUndefined();
  });

  it("returns null rather than a half-rendered sheet", () => {
    expect(cleanPlan(null, "m", "USD")).toBeNull();
    expect(cleanPlan({}, "m", "USD")).toBeNull();
    expect(cleanPlan({ phases: [{ title: "Empty", steps: [] }] }, "m", "USD")).toBeNull();
    expect(cleanPlan({ phases: [{ steps: [{ detail: "no title" }] }] }, "m", "USD")).toBeNull();
  });
});

describe("cleanOps", () => {
  it("keeps the ops it understands and drops the ones it does not", () => {
    const ops = cleanOps(
      [
        { op: "set-summary", summary: "Oak frames" },
        { op: "delete-everything", stepId: "s1" },
        { op: "remove-step", stepId: "s2" },
        { op: "remove-step" },
      ],
      "USD",
    );
    expect(ops).toEqual([
      { op: "set-summary", summary: "Oak frames" },
      { op: "remove-step", stepId: "s2" },
    ]);
  });

  it("cleans the step inside a replace, keeping the id it names", () => {
    const [op] = cleanOps(
      [{ op: "replace-step", stepId: "s1", step: { title: "Cut oak", detail: "45° mitres." } }],
      "USD",
    );
    expect(op.op).toBe("replace-step");
    if (op.op === "replace-step") {
      expect(op.stepId).toBe("s1");
      expect(op.step.title).toBe("Cut oak");
      expect(op.step.provenance).toBe("estimate");
      expect(op.step.materials).toEqual([]);
    }
  });

  it("is an empty list for nonsense, never a throw", () => {
    expect(cleanOps(null, "USD")).toEqual([]);
    expect(cleanOps("ops", "USD")).toEqual([]);
    expect(cleanOps([1, 2, 3], "USD")).toEqual([]);
  });
});

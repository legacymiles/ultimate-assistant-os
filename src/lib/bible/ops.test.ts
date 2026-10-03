import { describe, expect, it } from "vitest";
import { applyOps, opSummary } from "./ops";
import type { Op } from "./ops";
import type { Material, Plan, Step } from "./types";

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

function base(): Plan {
  return {
    version: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    model: "test",
    summary: "Picture frames",
    assumptions: ["garage, no van"],
    openQuestions: [],
    phases: [
      { id: "p1", title: "Buy", goal: "", days: 2, steps: [step(), step({ id: "s2", title: "Order glass" })] },
      { id: "p2", title: "Make", goal: "", days: 3, steps: [step({ id: "s3", title: "Assemble" })] },
    ],
    extras: [],
  };
}

describe("applyOps", () => {
  it("replaces a step without touching what the owner did to it", () => {
    const before = base();
    before.phases[0].steps[0] = step({
      done: true,
      skipped: false,
      note: "already have 40ft of this",
    });
    const incoming = step({ title: "Cut the oak to length", done: false, note: undefined });
    const { plan, applied, dropped } = applyOps(before, [
      { op: "replace-step", stepId: "s1", step: incoming },
    ]);

    const after = plan.phases[0].steps[0];
    expect(after.title).toBe("Cut the oak to length");
    // Progress and the owner's own words are HIS. An agent rewriting a step
    // must not quietly un-tick it or delete the note explaining it.
    expect(after.done).toBe(true);
    expect(after.note).toBe("already have 40ft of this");
    expect(applied).toBe(1);
    expect(dropped).toEqual([]);
  });

  it("keeps a price the owner typed, and keeps his material the agent forgot", () => {
    const mine: Material = {
      id: "m-own",
      name: "oak offcuts from the yard",
      qty: 10,
      unit: "ft",
      unitCost: { low: 0, high: 0, currency: "USD" },
      provenance: "user",
      supplierIds: [],
    };
    const theirs: Material = { ...mine, id: "m-new", name: "pine", provenance: "estimate" };
    const before = base();
    before.phases[0].steps[0] = step({ materials: [mine] });

    const { plan } = applyOps(before, [
      { op: "replace-step", stepId: "s1", step: step({ materials: [theirs] }) },
    ]);

    const ids = plan.phases[0].steps[0].materials.map((m) => m.id);
    expect(ids).toContain("m-own");
    expect(ids).toContain("m-new");
  });

  it("keeps the verified supplier and its source when the step is rewritten", () => {
    const before = base();
    before.phases[0].steps[0] = step({
      cost: { low: 38, high: 44, currency: "USD" },
      provenance: "verified",
      suppliers: [
        { id: "sup-found", name: "Capitol City Lumber", what: "moulding", source: "https://example.com", foundAt: "2026-10-01T00:00:00.000Z" },
        { id: "sup-mine", name: "Dave down the road", what: "offcuts" },
      ],
    });

    const { plan } = applyOps(before, [
      { op: "replace-step", stepId: "s1", step: step({ title: "Cut the oak", suppliers: [] }) },
    ]);

    const s = plan.phases[0].steps[0];
    // Losing the source would leave a VERIFIED price with nothing behind it,
    // and losing Dave loses a shop the owner actually knows.
    expect(s.suppliers.map((x) => x.name)).toEqual(["Capitol City Lumber", "Dave down the road"]);
    expect(s.suppliers[0].source).toBe("https://example.com");
  });

  it("keeps a price the owner typed, and keeps it labelled as his", () => {
    const before = base();
    before.phases[0].steps[0] = step({
      cost: { low: 25, high: 25, currency: "USD" },
      provenance: "user",
    });
    const { plan } = applyOps(before, [
      {
        op: "replace-step",
        stepId: "s1",
        step: step({ cost: { low: 70, high: 110, currency: "USD" }, provenance: "estimate" }),
      },
    ]);
    const s = plan.phases[0].steps[0];
    expect(s.cost).toEqual({ low: 25, high: 25, currency: "USD" });
    expect(s.provenance).toBe("user");
  });

  it("drops an op naming a step that does not exist, and says why", () => {
    const before = base();
    const { plan, applied, dropped } = applyOps(before, [
      { op: "replace-step", stepId: "ghost", step: step({ id: "ghost" }) },
    ]);
    expect(applied).toBe(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].why).toMatch(/ghost/);
    // Nothing moved, and the version did not move either.
    expect(plan.phases[0].steps.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(plan.version).toBe(1);
  });

  it("adds a step after the one named, or at the front when told null", () => {
    const after = applyOps(base(), [
      { op: "add-step", phaseId: "p1", afterStepId: "s1", step: step({ id: "new" }) },
    ]).plan;
    expect(after.phases[0].steps.map((s) => s.id)).toEqual(["s1", "new", "s2"]);

    const front = applyOps(base(), [
      { op: "add-step", phaseId: "p1", afterStepId: null, step: step({ id: "new" }) },
    ]).plan;
    expect(front.phases[0].steps.map((s) => s.id)).toEqual(["new", "s1", "s2"]);
  });

  it("removes a step, and removes a phase with everything in it", () => {
    expect(
      applyOps(base(), [{ op: "remove-step", stepId: "s2" }]).plan.phases[0].steps.map((s) => s.id),
    ).toEqual(["s1"]);
    expect(
      applyOps(base(), [{ op: "remove-phase", phaseId: "p2" }]).plan.phases.map((p) => p.id),
    ).toEqual(["p1"]);
  });

  it("bumps the version exactly once however many ops land", () => {
    const { plan } = applyOps(base(), [
      { op: "set-summary", summary: "Oak picture frames" },
      { op: "remove-step", stepId: "s2" },
      { op: "add-step", phaseId: "p2", afterStepId: null, step: step({ id: "s9" }) },
    ]);
    expect(plan.version).toBe(2);
    expect(plan.summary).toBe("Oak picture frames");
  });

  it("treats an empty op list as an answer, not a failure", () => {
    const { plan, applied, dropped } = applyOps(base(), []);
    expect(applied).toBe(0);
    expect(dropped).toEqual([]);
    expect(plan.version).toBe(1);
  });

  it("never mutates the plan it was given", () => {
    const before = base();
    const snapshot = JSON.stringify(before);
    applyOps(before, [{ op: "remove-step", stepId: "s1" }]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("opSummary", () => {
  it("says in one line what an answer wants to do", () => {
    const ops: Op[] = [
      { op: "replace-step", stepId: "s1", step: step() },
      { op: "replace-step", stepId: "s2", step: step({ id: "s2" }) },
      { op: "remove-step", stepId: "s3" },
    ];
    expect(opSummary(ops)).toBe("2 steps changed · 1 removed");
    expect(opSummary([])).toBe("no changes");
  });
});

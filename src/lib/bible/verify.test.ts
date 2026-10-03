import { describe, expect, it } from "vitest";
import { mergeVerified, type Finding } from "./verify";
import type { Plan, Step, Supplier } from "./types";

const NOW = "2026-10-02T12:00:00.000Z";

function step(over: Partial<Step> = {}): Step {
  return {
    id: "s1",
    title: "Buy moulding",
    detail: "",
    provenance: "estimate",
    materials: [],
    suppliers: [],
    done: false,
    skipped: false,
    ...over,
  };
}

function plan(steps: Step[]): Plan {
  return {
    version: 2,
    createdAt: NOW,
    model: "test",
    summary: "",
    assumptions: [],
    openQuestions: [],
    phases: [{ id: "p1", title: "Buy", goal: "", steps }],
    extras: [],
  };
}

const found: Supplier = {
  id: "sup-found",
  name: "Capitol City Lumber",
  what: "primed pine moulding, 8ft",
  where: "4216 Beryl Rd, Raleigh NC",
  price: { low: 38, high: 44, currency: "USD" },
  source: "https://example.com/listing",
};

const finding = (over: Partial<Finding> = {}): Finding => ({ stepId: "s1", supplier: found, ...over });

describe("mergeVerified", () => {
  it("fills in the supplier, flips the step to verified and stamps the date", () => {
    const after = mergeVerified(plan([step()]), [finding()], NOW);
    const s = after.phases[0].steps[0];
    expect(s.suppliers[0].name).toBe("Capitol City Lumber");
    expect(s.suppliers[0].foundAt).toBe(NOW);
    expect(s.cost).toEqual({ low: 38, high: 44, currency: "USD" });
    expect(s.provenance).toBe("verified");
  });

  it("never overwrites a price the owner typed", () => {
    const mine = step({ cost: { low: 25, high: 25, currency: "USD" }, provenance: "user" });
    const after = mergeVerified(plan([mine]), [finding()], NOW);
    const s = after.phases[0].steps[0];
    expect(s.cost).toEqual({ low: 25, high: 25, currency: "USD" });
    expect(s.provenance).toBe("user");
    // The finding is still worth keeping — it just does not get to win.
    expect(s.suppliers.map((x) => x.name)).toContain("Capitol City Lumber");
  });

  it("keeps a supplier the owner added himself", () => {
    const mine: Supplier = { id: "sup-mine", name: "Dave down the road", what: "offcuts" };
    const after = mergeVerified(plan([step({ suppliers: [mine] })]), [finding()], NOW);
    expect(after.phases[0].steps[0].suppliers.map((s) => s.name)).toEqual([
      "Dave down the road",
      "Capitol City Lumber",
    ]);
  });

  it("does not add the same supplier twice when a scan is run again", () => {
    const once = mergeVerified(plan([step()]), [finding()], NOW);
    const twice = mergeVerified(once, [finding()], NOW);
    expect(twice.phases[0].steps[0].suppliers).toHaveLength(1);
  });

  it("leaves a step nothing was found for as an estimate", () => {
    const after = mergeVerified(plan([step(), step({ id: "s2" })]), [finding()], NOW);
    expect(after.phases[0].steps[1].provenance).toBe("estimate");
    expect(after.phases[0].steps[1].suppliers).toEqual([]);
  });

  it("ignores a finding for a step that is not in this plan", () => {
    const after = mergeVerified(plan([step()]), [finding({ stepId: "ghost" })], NOW);
    expect(after.phases[0].steps[0].suppliers).toEqual([]);
  });

  it("prices a named material rather than the whole step when told which", () => {
    const withMaterial = step({
      materials: [
        {
          id: "m1",
          name: "pine moulding",
          qty: 32,
          unit: "ft",
          unitCost: { low: 1, high: 2, currency: "USD" },
          provenance: "estimate",
          supplierIds: [],
        },
      ],
    });
    const after = mergeVerified(
      plan([withMaterial]),
      [finding({ materialId: "m1", supplier: { ...found, price: { low: 1.4, high: 1.4, currency: "USD" } } })],
      NOW,
    );
    const m = after.phases[0].steps[0].materials[0];
    expect(m.unitCost).toEqual({ low: 1.4, high: 1.4, currency: "USD" });
    expect(m.provenance).toBe("verified");
    expect(m.supplierIds).toContain("sup-found");
    // The step itself was never costed directly, so it stays uncosted.
    expect(after.phases[0].steps[0].cost).toBeUndefined();
  });

  it("never mutates the plan it was given", () => {
    const before = plan([step()]);
    const snapshot = JSON.stringify(before);
    mergeVerified(before, [finding()], NOW);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

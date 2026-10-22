import { describe, expect, it } from "vitest";

import { planInboxSync } from "./inboxSync";

describe("planInboxSync — same photos on the phone and the laptop", () => {
  it("copies in inbox photos this device hasn't had", () => {
    const plan = planInboxSync(["a", "b", "c"], [{ id: "q1", inboxId: "a" }], new Set(["b"]));
    expect(plan.toImport).toEqual(["c"]);
    expect(plan.toRemove).toEqual([]);
  });
  it("drops photos the inbox let go of: filed elsewhere or deleted on the phone", () => {
    const plan = planInboxSync(["b"], [{ id: "q1", inboxId: "a" }, { id: "q2", inboxId: "b" }], new Set(["a", "b"]));
    expect(plan.toRemove).toEqual(["q1"]);
  });
  it("never touches photos added on this device by hand", () => {
    const plan = planInboxSync([], [{ id: "q1" }], new Set());
    expect(plan.toRemove).toEqual([]);
  });
});

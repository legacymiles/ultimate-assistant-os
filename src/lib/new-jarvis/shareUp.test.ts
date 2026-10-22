import { describe, expect, it } from "vitest";
import { planRestamp, planShareUp } from "./shareUp";

describe("planShareUp", () => {
  it("sends up only photos waiting on this device, newest first", () => {
    const q = [
      { id: "a", fileId: "f1", takenAt: "2026-10-20T10:00:00Z" },
      { id: "b", fileId: "f2", inboxId: "x", takenAt: "2026-10-22T10:00:00Z" },
      { id: "c", fileId: "f3", takenAt: "2026-10-21T10:00:00Z" },
      { id: "d", fileId: "f4", takenAt: "2026-10-22T09:00:00Z" },
    ];
    expect(planShareUp(q, new Set(["d"])).map((p) => p.id)).toEqual(["c", "a"]);
    expect(planShareUp(q, new Set(), 1).map((p) => p.id)).toEqual(["d"]);
  });
});

describe("planRestamp", () => {
  it("gives every device the inbox's time for the same photo", () => {
    const want = Date.parse("2026-10-22T14:00:00Z");
    const times = new Map([
      ["x", want],
      ["y", NaN],
    ]);
    const q = [
      { id: "p1", inboxId: "x", takenAt: "2026-10-22T15:30:00Z" }, // stamped when this device copied it
      { id: "p2", inboxId: "x", takenAt: "2026-10-22T14:00:00.400Z" }, // already right
      { id: "p3", inboxId: "y", takenAt: "2026-10-22T15:30:00Z" }, // no time known
      { id: "p4", takenAt: "2026-10-22T15:30:00Z" }, // one-device photo
    ];
    expect(planRestamp(q, times)).toEqual([{ id: "p1", takenAt: "2026-10-22T14:00:00.000Z" }]);
  });
});

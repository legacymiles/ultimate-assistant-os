import { describe, expect, it } from "vitest";

import { LANE_LABEL, laneAllowed, laneNote, planLanes, type LaneState } from "./lanes";

const ALL: LaneState = { localUp: true, freeAllowed: true, paidKeyed: true };

describe("which lane draws the picture", () => {
  it("always leads with the owner's own PC when it is up", () => {
    expect(planLanes("placeholder", ALL).order[0]).toBe("local");
    expect(planLanes("branded", ALL).order[0]).toBe("local");
  });

  it("never offers the watermarked lane for anything carrying a name", () => {
    expect(laneAllowed("free", "branded")).toBe(false);
    expect(laneAllowed("free", "placeholder")).toBe(true);
    expect(planLanes("branded", ALL).order).not.toContain("free");
    expect(planLanes("placeholder", ALL).order).toContain("free");
  });

  it("falls to free, then paid, when the PC is off", () => {
    expect(planLanes("placeholder", { ...ALL, localUp: false }).order).toEqual(["free", "paid"]);
  });

  it("skips straight to paid for branded work with the PC off", () => {
    const plan = planLanes("branded", { ...ALL, localUp: false });
    expect(plan.order).toEqual(["paid"]);
    expect(plan.why).toContain("carries your name");
  });

  it("works with no paid key at all, which is the point", () => {
    const noKey = { localUp: true, freeAllowed: true, paidKeyed: false };
    expect(planLanes("branded", noKey).order).toEqual(["local"]);
    expect(planLanes("placeholder", noKey).order).toEqual(["local", "free"]);
  });

  it("says plainly what to do when nothing can draw", () => {
    const dead: LaneState = { localUp: false, freeAllowed: false, paidKeyed: false };
    const plan = planLanes("placeholder", dead);
    expect(plan.order).toEqual([]);
    expect(plan.blocked).toContain("Open Jarvis on your PC");
    expect(plan.blocked).not.toMatch(/error|null|undefined|\{/i);
  });

  it("explains a branded block differently from a plain one", () => {
    const onlyFree: LaneState = { localUp: false, freeAllowed: true, paidKeyed: false };
    const branded = planLanes("branded", onlyFree);
    expect(branded.order).toEqual([]);
    expect(branded.blocked).toContain("watermarked");
    expect(planLanes("placeholder", onlyFree).order).toEqual(["free"]);
  });

  it("gives a reason for whichever lane leads", () => {
    expect(planLanes("placeholder", ALL).why).toContain("your own graphics card");
    expect(planLanes("placeholder", { ...ALL, localUp: false }).why).toContain("watermark");
    const paidOnly: LaneState = { localUp: false, freeAllowed: false, paidKeyed: true };
    expect(planLanes("placeholder", paidOnly).why).toContain("paid model");
  });

  it("never repeats a lane", () => {
    for (const purpose of ["placeholder", "branded"] as const) {
      const { order } = planLanes(purpose, ALL);
      expect(new Set(order).size).toBe(order.length);
    }
  });
});

describe("what the owner is told afterwards", () => {
  it("says free out loud for the local lane", () => {
    expect(laneNote("local", 18234)).toBe("Drawn on your PC in 18.2s — free.");
    expect(laneNote("local", 840)).toContain("840ms");
  });

  it("admits the watermark on the free lane", () => {
    expect(laneNote("free", 5600)).toContain("watermark");
    expect(laneNote("free", 5600)).toContain("free");
  });

  it("does not call the paid lane free", () => {
    expect(laneNote("paid", 3000)).not.toContain("free");
  });

  it("labels every lane for the UI", () => {
    expect(LANE_LABEL.local).toContain("free");
    expect(LANE_LABEL.free).toContain("watermark");
    expect(Object.keys(LANE_LABEL)).toHaveLength(3);
  });
});

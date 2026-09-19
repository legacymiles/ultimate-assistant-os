import { describe, expect, it } from "vitest";
import { heuristicPlan } from "./plan/heuristic";
import { applyRevision, planToJson, stalePanels } from "./plan/revise";
import type { Brief, Upload } from "./types";

const brief: Brief = { prompt: "A father carries his baby through a jungle.", cutCount: 4, totalSec: 15, aspectRatio: "16:9", look: "live-action", quality: "medium" };
const uploads: Upload[] = [];
let n = 0;
const id = (p: string) => `${p}_t${++n}`;

describe("AI director revisions", () => {
  const old = heuristicPlan(brief, uploads, id);

  it("returning the plan untouched keeps every id and stales nothing", () => {
    const rev = applyRevision({ reply: "No change.", plan: planToJson(old, brief) }, old, brief, uploads, id);
    expect(rev.plan.cuts.map((c) => c.id)).toEqual(old.cuts.map((c) => c.id));
    expect(rev.plan.characters.map((c) => c.id)).toEqual(old.characters.map((c) => c.id));
    expect(rev.plan.lighting.map((l) => l.id)).toEqual(old.lighting.map((l) => l.id));
    expect(stalePanels(old, rev.plan)).toEqual([]);
    expect(rev.reply).toBe("No change.");
  });

  it("redraws only the edited cut", () => {
    const json = planToJson(old, brief) as { cuts: Record<string, unknown>[] };
    json.cuts[1] = { ...json.cuts[1], description: "A tight close-up of the baby laughing." };
    const rev = applyRevision({ plan: json }, old, brief, uploads, id);
    expect(stalePanels(old, rev.plan)).toEqual([{ kind: "cut", targetId: old.cuts[1].id }]);
  });

  it("adds a cut with a fresh id and follows the new count", () => {
    const json = planToJson(old, brief) as { cuts: Record<string, unknown>[] };
    json.cuts.push({ ...json.cuts[0], id: undefined, description: "New ending shot." });
    const rev = applyRevision({ plan: json }, old, brief, uploads, id);
    expect(rev.cutCount).toBe(old.cuts.length + 1);
    expect(rev.plan.cuts).toHaveLength(old.cuts.length + 1);
    const fresh = rev.plan.cuts[rev.plan.cuts.length - 1];
    expect(old.cuts.some((c) => c.id === fresh.id)).toBe(false);
    expect(rev.plan.cuts.reduce((a, c) => a + c.durationSec, 0)).toBe(15);
  });

  it("a changed environment stales its plate, the plan views and the cuts shot there", () => {
    const json = planToJson(old, brief) as { environments: Record<string, unknown>[] };
    json.environments[0] = { ...json.environments[0], timeOfDay: "midnight" };
    const stale = stalePanels(old, applyRevision({ plan: json }, old, brief, uploads, id).plan).map((x) => x.kind);
    expect(stale).toContain("environment");
    expect(stale).toContain("floorplan");
    expect(stale.filter((k) => k === "cut").length).toBe(old.cuts.filter((c) => c.environmentId === old.environments[0].id).length);
  });

  it("ignores ids the old plan never had", () => {
    const json = planToJson(old, brief) as { cuts: Record<string, unknown>[] };
    json.cuts[0] = { ...json.cuts[0], id: "cut_forged" };
    const rev = applyRevision({ plan: json }, old, brief, uploads, id);
    expect(rev.plan.cuts[0].id).not.toBe("cut_forged");
  });
});

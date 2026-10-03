import { describe, expect, it } from "vitest";
import { SEED_IDEAS } from "./seed";
import {
  currentPlan,
  deleteIdea,
  isSeedId,
  mergeSeeded,
  pushPlan,
  resolve,
  setHomeBase,
  upsertIdea,
} from "./store";
import { emptyBrief, emptyStore, type Idea, type Plan } from "./types";

const seeded = SEED_IDEAS[0];

function idea(over: Partial<Idea> = {}): Idea {
  return {
    id: "own-1",
    title: "Resin coasters",
    oneLiner: "",
    brief: emptyBrief(),
    status: "idea",
    tags: [],
    pinned: false,
    plans: [],
    chat: [],
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    ...over,
  };
}

describe("mergeSeeded", () => {
  it("shows the seed until it is edited, then shows the edit", () => {
    expect(mergeSeeded([seeded], [], []).map((i) => i.title)).toEqual([seeded.title]);
    const edited = { ...seeded, title: "Oak picture frames" };
    expect(mergeSeeded([seeded], [edited], []).map((i) => i.title)).toEqual(["Oak picture frames"]);
  });

  it("keeps a deleted seed deleted, even one that had been edited first", () => {
    const edited = { ...seeded, title: "Oak picture frames" };
    expect(mergeSeeded([seeded], [edited], [seeded.id])).toEqual([]);
  });

  it("appends the owner's own ideas after the seeds", () => {
    expect(mergeSeeded([seeded], [idea()], []).map((i) => i.id)).toEqual([seeded.id, "own-1"]);
  });
});

describe("the store's reducers", () => {
  it("adds an idea, then updates it in place rather than twice", () => {
    const added = upsertIdea(emptyStore(), idea());
    expect(added.ideas).toHaveLength(1);
    const renamed = upsertIdea(added, { ...idea(), title: "Resin trays" });
    expect(renamed.ideas).toHaveLength(1);
    expect(renamed.ideas[0].title).toBe("Resin trays");
  });

  it("stamps updatedAt on every write so the table can sort by it", () => {
    const after = upsertIdea(emptyStore(), idea({ updatedAt: "2020-01-01T00:00:00.000Z" }));
    expect(after.ideas[0].updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("deleting a SEED remembers it, deleting an owned idea just removes it", () => {
    const seedGone = deleteIdea(emptyStore(), seeded.id, true);
    expect(seedGone.hiddenSeeds).toEqual([seeded.id]);

    const mineGone = deleteIdea(upsertIdea(emptyStore(), idea()), "own-1", false);
    expect(mineGone.ideas).toEqual([]);
    expect(mineGone.hiddenSeeds).toEqual([]);
  });

  it("knows which ids are seeds, so the caller cannot get that wrong", () => {
    expect(isSeedId(seeded.id)).toBe(true);
    expect(isSeedId("own-1")).toBe(false);
  });

  it("holds the home base for every room to read", () => {
    const after = setHomeBase(emptyStore(), {
      city: "Raleigh",
      region: "NC",
      country: "US",
      currency: "USD",
    });
    expect(after.homeBase?.city).toBe("Raleigh");
  });
});

describe("plan history", () => {
  const v1: Plan = {
    version: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    model: "test",
    summary: "v1",
    assumptions: [],
    openQuestions: [],
    phases: [],
    extras: [],
  };

  it("keeps every version and treats the last as current", () => {
    const withV1 = pushPlan(idea(), v1);
    const withV2 = pushPlan(withV1, { ...v1, version: 2, summary: "v2" });
    expect(withV2.plans.map((p) => p.version)).toEqual([1, 2]);
    expect(currentPlan(withV2)?.summary).toBe("v2");
  });

  it("has no current plan before one is generated", () => {
    expect(currentPlan(idea())).toBeNull();
  });
});

describe("resolve", () => {
  it("hands the UI seeds and edits already reconciled, and says what is the owner's", () => {
    const store = upsertIdea(emptyStore(), idea());
    const view = resolve(store);
    expect(view.ideas.map((i) => i.id)).toEqual([seeded.id, "own-1"]);
    expect(view.isOwn("own-1")).toBe(true);
    expect(view.isOwn(seeded.id)).toBe(false);
  });
});

describe("the seeded plan is the standard the generator is held to", () => {
  const plan = seeded.plans[0];

  it("fills in every field the sheet can draw", () => {
    const steps = plan.phases.flatMap((p) => p.steps);
    expect(plan.phases.length).toBeGreaterThanOrEqual(4);
    expect(steps.length).toBe(10);
    expect(steps.every((s) => s.check)).toBe(true);
    expect(steps.some((s) => s.legal)).toBe(true);
    expect(steps.some((s) => s.materials.length)).toBe(true);
    expect(steps.some((s) => s.suppliers.length)).toBe(true);
    expect(plan.unit?.sellsFor).toBeTruthy();
  });

  it("claims nothing as verified, because a seed has checked nothing", () => {
    const steps = plan.phases.flatMap((p) => p.steps);
    expect(steps.every((s) => s.provenance === "estimate")).toBe(true);
    expect(steps.flatMap((s) => s.suppliers).every((s) => !s.source)).toBe(true);
  });

  it("mentions none of the nine business-formation topics", () => {
    const words = JSON.stringify(plan).toLowerCase();
    // Whole words only: a plain substring search for "ein" hits "being", which
    // is how a test like this ends up failing on prose rather than on policy.
    for (const forbidden of ["llc", "insurance", "ein", "trademark", "branding", "social media"]) {
      expect(words).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
    expect(plan.extras).toEqual([]);
  });
});

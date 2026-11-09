import { describe, expect, it } from "vitest";
import { CATEGORIES, rankAll } from "./leaderboard";
import { cleanModel } from "./boardActions";
import { SEED_MODELS } from "./seedModels";

describe("seed board", () => {
  it("files every model in a real category, with a unique id", () => {
    const cats = new Set(CATEGORIES.map((c) => c.id));
    expect(SEED_MODELS.every((m) => cats.has(m.category))).toBe(true);
    expect(new Set(SEED_MODELS.map((m) => m.id)).size).toBe(SEED_MODELS.length);
  });

  it("gives every category something to show", () => {
    for (const c of CATEGORIES) expect(SEED_MODELS.some((m) => m.category === c.id), c.id).toBe(true);
  });

  it("uses one score source per category, so scores compare like with like", () => {
    const labels = new Map<string, Set<string>>();
    for (const m of SEED_MODELS) {
      if (!m.publicScore) continue;
      labels.set(m.category, (labels.get(m.category) ?? new Set()).add(`${m.publicScore.kind}:${m.publicScore.label}`));
    }
    for (const [cat, set] of labels) expect(set.size, cat).toBe(1);
  });

  it("never crowns a lone, self-reported coding score", () => {
    expect(SEED_MODELS.filter((m) => m.category === "coding-agents" && m.publicScore)).toEqual([]);
  });

  it("survives the same cleaning an owner's edit goes through", () => {
    for (const m of SEED_MODELS) {
      const c = cleanModel(m, "2026-11-08T00:00:00.000Z", m);
      expect(typeof c, m.name).toBe("object");
    }
  });

  it("ranks the scored models and leaves the rest unranked", () => {
    const ranks = rankAll(SEED_MODELS);
    const tts = SEED_MODELS.filter((m) => m.category === "tts");
    const ranked = tts.filter((m) => ranks.get(m.id)?.rank !== undefined);
    expect(ranked.length).toBe(tts.filter((m) => m.publicScore).length);
  });
});

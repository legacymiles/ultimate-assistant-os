import { describe, expect, it } from "vitest";
import {
  MAX_RECIPES_PER_SOURCE,
  dedupeByTitle,
  jobLine,
  recipeEntries,
  trayCounts,
  trayOrder,
  traySummary,
} from "./found";

describe("recipeEntries", () => {
  it("reads the list a multi-dish video comes back as", () => {
    const data = { is_recipe: true, recipes: [{ title: "Tacos" }, { title: "Salsa Verde" }, { title: "Churros" }] };
    expect(recipeEntries(data).map((r) => r.title)).toEqual(["Tacos", "Salsa Verde", "Churros"]);
  });

  it("still accepts a single bare recipe, the shape a model falls back to", () => {
    expect(recipeEntries({ title: "Pad Thai", ingredients: [] })).toHaveLength(1);
  });

  it("drops junk entries and caps the count", () => {
    const many = Array.from({ length: MAX_RECIPES_PER_SOURCE + 4 }, (_, i) => ({ title: `Dish ${i}` }));
    expect(recipeEntries({ recipes: [null, "x", ...many] })).toHaveLength(MAX_RECIPES_PER_SOURCE);
    expect(recipeEntries(null)).toEqual([]);
    expect(recipeEntries({ is_recipe: false })).toEqual([]);
  });
});

describe("dedupeByTitle", () => {
  it("treats the same dish named twice as one, keeping the first", () => {
    const list = [{ t: "Garlic Butter Steak!", n: 1 }, { t: "garlic butter steak", n: 2 }, { t: "Mash", n: 3 }];
    expect(dedupeByTitle(list, (x) => x.t).map((x) => x.n)).toEqual([1, 3]);
  });
});

describe("the tray", () => {
  const items = [
    { id: "a", status: "accepted" as const },
    { id: "b", status: "pending" as const },
    { id: "c", status: "rejected" as const },
    { id: "d", status: "pending" as const },
  ];

  it("counts each decision", () => {
    expect(trayCounts(items)).toEqual({ pending: 2, accepted: 1, rejected: 1, total: 4 });
  });

  it("puts what still needs a decision on top, without reshuffling within a group", () => {
    expect(trayOrder(items).map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("says what was found and what is left, in plain words", () => {
    expect(traySummary(trayCounts(items), 0)).toBe("4 recipes found. 1 in the book, 1 skipped, 2 to decide.");
    expect(traySummary(trayCounts([{ status: "pending" }]), 2)).toBe("1 recipe found so far — still reading 2. 1 to decide.");
    expect(traySummary(trayCounts([]), 1)).toBe("Reading…");
  });

  it("names each read's outcome", () => {
    expect(jobLine("done", 3)).toBe("3 recipes");
    expect(jobLine("done", 0)).toBe("No recipe in it");
    expect(jobLine("failed", 0, "That post is private.")).toBe("That post is private.");
    expect(jobLine("queued", 0)).toBe("Waiting its turn");
  });
});

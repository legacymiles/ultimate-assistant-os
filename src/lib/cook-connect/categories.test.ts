import { describe, expect, it } from "vitest";
import {
  activeFilterCount, clampRank, EMPTY_FILTER, filterRecipes, hasWord, mainIngredientsOf, matchesTerm,
  mealsOf, sortRecipes, toggleIn,
} from "./categories";

const r = (over: Partial<{
  id: string; title: string; description: string | null; tags: string[];
  ingredients: { name: string; amount: string; unit: string }[]; created_at: string;
}>) => ({
  id: "x", title: "", description: null, tags: [], ingredients: [], created_at: "2026-10-01T00:00:00Z", ...over,
});

describe("hasWord", () => {
  it("matches whole words and plurals, not parts", () => {
    expect(hasWord("Scrambled eggs", "egg")).toBe(true);
    expect(hasWord("Roasted eggplant", "egg")).toBe(false);
    expect(hasWord("Black beans", "bean")).toBe(true);
    expect(hasWord("Ice-cream sundae", "sundae")).toBe(true);
  });
});

describe("mealsOf", () => {
  it("reads the owner's example: a banana ice cream sundae is a dessert", () => {
    expect(mealsOf(r({ title: "Banana ice cream sundae" }))).toContain("dessert");
  });
  it("tags beat guesses, but healthy and fun stack on top", () => {
    const meals = mealsOf(r({ title: "Healthy chicken salad", tags: ["dinner"] }));
    expect(meals).toEqual(["dinner", "healthy"]);
  });
  it("knows fun food for kids", () => {
    expect(mealsOf(r({ title: "Spooky mummy hot dogs" }))).toContain("fun");
  });
  it("finds breakfast from words", () => {
    expect(mealsOf(r({ title: "Fluffy pancakes" }))).toEqual(["breakfast"]);
  });
});

describe("mainIngredientsOf", () => {
  it("finds ingredients in the list and the title", () => {
    const got = mainIngredientsOf(r({
      title: "Tuna noodle casserole",
      ingredients: [{ name: "frozen broccoli florets", amount: "1", unit: "cup" }],
    }));
    expect(got).toEqual(expect.arrayContaining(["tuna", "noodles", "broccoli", "fish"]));
    expect(got).not.toContain("chicken");
  });
});

describe("search and filters", () => {
  const list = [
    r({ id: "a", title: "Chicken fried rice", tags: ["dinner"], created_at: "2026-10-03T00:00:00Z" }),
    r({ id: "b", title: "Banana ice cream sundae", created_at: "2026-10-02T00:00:00Z" }),
    r({ id: "c", title: "Pesto pasta", ingredients: [{ name: "chicken breast", amount: "1", unit: "" }], created_at: "2026-10-01T00:00:00Z" }),
  ];
  const ranks = { a: 6, b: 8, c: 9 };

  it("the search bar matches names and ingredients", () => {
    expect(matchesTerm(list[2], "chicken")).toBe(true);
    expect(filterRecipes(list, { ...EMPTY_FILTER, term: "chicken" }, ranks).map((x) => x.id)).toEqual(["a", "c"]);
  });
  it("rank floors use my own ranks and drop unranked", () => {
    expect(filterRecipes(list, { ...EMPTY_FILTER, minRank: 8 }, ranks).map((x) => x.id)).toEqual(["b", "c"]);
    expect(filterRecipes(list, { ...EMPTY_FILTER, minRank: 4 }, {}).length).toBe(0);
  });
  it("meal chips are OR, ingredient chips are AND", () => {
    expect(filterRecipes(list, { ...EMPTY_FILTER, meals: ["dinner", "dessert"] }, ranks).map((x) => x.id)).toEqual(["a", "b"]);
    expect(filterRecipes(list, { ...EMPTY_FILTER, ingredients: ["chicken", "rice"] }, ranks).map((x) => x.id)).toEqual(["a"]);
  });
  it("sorts by my rank, then newest", () => {
    expect(sortRecipes(list, "rank", ranks).map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(sortRecipes(list, "newest", ranks).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("counts active filters", () => {
    expect(activeFilterCount({ term: "x", meals: ["dinner"], ingredients: ["rice", "beans"], minRank: 6 })).toBe(5);
  });
});

describe("helpers", () => {
  it("clamps ranks to 1–10", () => {
    expect(clampRank(0)).toBeNull();
    expect(clampRank(11)).toBe(10);
    expect(clampRank("7.4")).toBe(7);
    expect(clampRank("nope")).toBeNull();
  });
  it("toggles chips", () => {
    expect(toggleIn(["a"], "a")).toEqual([]);
    expect(toggleIn(["a"], "b")).toEqual(["a", "b"]);
  });
});

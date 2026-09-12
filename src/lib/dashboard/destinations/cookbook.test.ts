import { describe, expect, it } from "vitest";
import { cookbookDestination as d } from "./cookbook";

const FULL = {
  title: "Garlic Butter Chicken",
  description: "Pan-seared chicken in garlic butter.",
  ingredients: ["2 chicken breasts", "3 tbsp butter", "4 cloves garlic"],
  instructions: ["Sear the chicken.", "Melt butter with garlic.", "Spoon over and serve."],
  prepTime: 10,
  cookTime: 20,
  servings: 2,
  dietaryTags: ["High-Protein", "Gluten-Free"],
  incomplete: false,
};

describe("Cookbook destination", () => {
  it("keeps ingredients and steps in order", () => {
    const f = d.parse(FULL)!;
    expect(f.ingredients).toHaveLength(3);
    expect(f.instructions[0]).toBe("Sear the chicken.");
  });

  it("drops a proposal with no title", () => {
    expect(d.parse({ ...FULL, title: "" })).toBeNull();
    expect(d.parse(null)).toBeNull();
  });

  it("lowercases dietary tags so they match the app's own", () => {
    expect(d.parse(FULL)?.dietaryTags).toEqual(["high-protein", "gluten-free"]);
  });

  it("flags a recipe with no ingredients as incomplete even if the model said otherwise", () => {
    // A recipe you cannot shop for is not a recipe, whatever the model claimed.
    const f = d.parse({ ...FULL, ingredients: [], incomplete: false });
    expect(f?.incomplete).toBe(true);
    expect(d.preview(f!).unverified).toBeTruthy();
  });

  it("flags missing steps too", () => {
    expect(d.parse({ ...FULL, instructions: [], incomplete: false })?.incomplete).toBe(true);
  });

  it("ignores nonsense times rather than writing them", () => {
    const f = d.parse({ ...FULL, prepTime: -5, cookTime: "soon", servings: 0 });
    expect(f?.prepTime).toBeUndefined();
    expect(f?.cookTime).toBeUndefined();
    expect(f?.servings).toBeUndefined();
  });

  it("names the cookbook photos land in", () => {
    expect(d.preview(d.parse(FULL)!).where).toBe("Cookbook Genie › From Photos");
  });
});

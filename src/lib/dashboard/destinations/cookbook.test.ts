import { describe, expect, it } from "vitest";
import { cookbookDestination as d, ingredientList, instructionList } from "./cookbook";

const FULL = {
  title: "Grandma's Banana Bread",
  description: "A moist, old-fashioned banana loaf.",
  ingredients: [
    { name: "ripe bananas, mashed", amount: "3", unit: "" },
    { name: "flour", amount: "1 1/2", unit: "cups" },
    { name: "salt", amount: "", unit: "pinch" },
  ],
  instructions: ["Heat oven to 350°F.", "Mix butter into bananas.", "Bake 60 minutes."],
  prepTime: 15,
  cookTime: 60,
  servings: 8,
  dietaryTags: ["Vegetarian"],
  incomplete: false,
};

describe("Cookbook destination — row shape", () => {
  // RecipeView renders `{ing.amount} {ing.unit} {ing.name}` and `{inst.text}`.
  // Plain strings rendered as blank rows; these pin the shape it reads.
  it("emits ingredients as {name, amount, unit}", () => {
    expect(d.parse(FULL)!.ingredients[1]).toEqual({ name: "flour", amount: "1 1/2", unit: "cups" });
  });

  it("emits instructions as {step, text}", () => {
    expect(d.parse(FULL)!.instructions[0]).toEqual({ step: 1, text: "Heat oven to 350°F." });
  });

  it("keeps an amount-less ingredient with empty strings, not undefined", () => {
    expect(d.parse(FULL)!.ingredients[2]).toEqual({ name: "salt", amount: "", unit: "pinch" });
  });

  it("coerces a numeric amount to a string, which scale() expects", () => {
    expect(ingredientList([{ name: "eggs", amount: 2, unit: "" }])[0].amount).toBe("2");
  });

  it("accepts plain-string ingredients from analyses made before this shape", () => {
    expect(ingredientList(["3 ripe bananas"])).toEqual([{ name: "3 ripe bananas", amount: "", unit: "" }]);
  });

  it("numbers steps by position, not by what the model wrote", () => {
    expect(instructionList(["5. Mix.", "2) Bake."])).toEqual([
      { step: 1, text: "Mix." },
      { step: 2, text: "Bake." },
    ]);
  });

  it("drops empty ingredients and steps", () => {
    expect(ingredientList([{ name: "", amount: "1", unit: "cup" }, "  "])).toEqual([]);
    expect(instructionList(["", "   "])).toEqual([]);
  });
});

describe("Cookbook destination — validation", () => {
  it("drops a proposal with no title", () => {
    expect(d.parse({ ...FULL, title: "" })).toBeNull();
    expect(d.parse(null)).toBeNull();
  });

  it("lowercases dietary tags so they match the app's own", () => {
    expect(d.parse(FULL)?.dietaryTags).toEqual(["vegetarian"]);
  });

  it("flags a recipe with no ingredients as incomplete even if the model said otherwise", () => {
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

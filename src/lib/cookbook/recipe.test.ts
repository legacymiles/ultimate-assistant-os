import { describe, expect, it } from "vitest";
import { extractJsonLd, findByType } from "../social-import/jsonld";
import { parseIngredientLine, parseIsoDuration, recipeFromCaption, recipeFromStructured } from "./recipe";

// The real caption of a TikTok recipe post, as tikwm's content_desc returns it.
const TIKTOK_CAPTION = [
  "Did you knowuh….",
  "",
  "Everybody does recipes like this on here hahaha ",
  "",
  "This is TikTok Pasta - super easy recipe! ",
  "",
  "2 pints tomato",
  "1 shallot",
  "3 cloves garlic",
  "1/2 cup olive oil",
  "Salt",
  "Thyme",
  "Feta 8 oz block ",
  "",
  "Put it in a pot and bake at 400 for 40 min. ",
  "",
  "#Recipe #DidYouKnow #food #influencers",
].join("\n");

describe("parseIngredientLine", () => {
  it("splits amount, unit and name", () => {
    expect(parseIngredientLine("1/2 cup olive oil")).toEqual({ amount: "1/2", unit: "cup", name: "olive oil" });
    expect(parseIngredientLine("3 cloves garlic")).toEqual({ amount: "3", unit: "cloves", name: "garlic" });
    expect(parseIngredientLine("- 1 1/2 cups flour")).toEqual({ amount: "1 1/2", unit: "cups", name: "flour" });
    expect(parseIngredientLine("8oz feta")).toEqual({ amount: "8", unit: "oz", name: "feta" });
  });

  it("does not mistake a word starting with a unit letter for a unit", () => {
    expect(parseIngredientLine("2 carrots")).toEqual({ amount: "2", unit: "", name: "carrots" });
  });

  it("keeps unmeasured lines whole", () => {
    expect(parseIngredientLine("Salt")).toEqual({ amount: "", unit: "", name: "Salt" });
    expect(parseIngredientLine("Feta 8 oz block")).toEqual({ amount: "", unit: "", name: "Feta 8 oz block" });
  });
});

describe("recipeFromCaption", () => {
  const r = recipeFromCaption(TIKTOK_CAPTION);

  it("names the dish from the caption, not its hook", () => {
    expect(r.title).toBe("TikTok Pasta");
  });

  it("collects measured lines and the bare lines inside that run", () => {
    expect(r.ingredients.map((i) => i.name)).toEqual(["tomato", "shallot", "garlic", "olive oil", "Salt", "Thyme", "Feta 8 oz block"]);
  });

  it("finds the step and its cook time", () => {
    expect(r.instructions).toHaveLength(1);
    expect(r.instructions[0].text).toContain("bake at 400");
    expect(r.cook_time).toBe(40);
  });
});

describe("schema.org Recipe", () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebPage","name":"Blog"},
      {"@type":["Recipe"],"name":"Baked Feta Pasta","description":"Creamy &amp; easy.",
       "recipeIngredient":["2 pints cherry tomatoes","8 oz block feta","12 oz pasta"],
       "recipeInstructions":[{"@type":"HowToSection","name":"Bake","itemListElement":[
         {"@type":"HowToStep","text":"Heat oven to 400°F."},{"@type":"HowToStep","text":"Bake 40 minutes."}]},
         "Toss with pasta."],
       "prepTime":"PT10M","totalTime":"PT1H","recipeYield":["4","4 servings"],
       "nutrition":{"calories":"520 kcal"},"suitableForDiet":"https://schema.org/GlutenFreeDiet"}
    ]}</script></head></html>`;

  it("finds a Recipe inside @graph", () => {
    expect(findByType(extractJsonLd(html), "Recipe")?.name).toBe("Baked Feta Pasta");
  });

  it("maps every field", () => {
    const r = recipeFromStructured(findByType(extractJsonLd(html), "Recipe"));
    expect(r.description).toBe("Creamy & easy.");
    expect(r.ingredients[1]).toEqual({ amount: "8", unit: "oz", name: "block feta" });
    expect(r.instructions.map((s) => s.text)).toEqual(["Heat oven to 400°F.", "Bake 40 minutes.", "Toss with pasta."]);
    expect([r.prep_time, r.cook_time, r.servings, r.calories]).toEqual([10, 50, 4, 520]);
    expect(r.dietary_tags).toEqual(["gluten-free"]);
  });

  it("parses ISO durations", () => {
    expect(parseIsoDuration("PT1H15M")).toBe(75);
    expect(parseIsoDuration("P0DT0H20M")).toBe(20);
    expect(parseIsoDuration("20 minutes")).toBe(0);
  });
});

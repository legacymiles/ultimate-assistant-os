// ---------------------------------------------------------------------------
// The one recipe shape Cookbook Genie stores, and every way of producing it
// without a model: normalising model output, reading a creator's schema.org
// Recipe, and a caption heuristic for when no AI key is configured.
//
// Pure — no fetch, no env — so both API routes and the tests share it.
// ---------------------------------------------------------------------------

import { decodeEntities } from "../social-import/jsonld";

export interface Ingredient { name: string; amount: string; unit: string }
export interface Instruction { step: number; text: string }
export interface RecipeData {
  title: string;
  description: string;
  ingredients: Ingredient[];
  instructions: Instruction[];
  prep_time: number;
  cook_time: number;
  servings: number;
  calories: number;
  dietary_tags: string[];
}

export const RECIPE_JSON_SCHEMA = `{
  "title": string,
  "description": string (one appetizing sentence),
  "ingredients": [{ "name": string, "amount": string, "unit": string }],
  "instructions": [{ "step": number (1-based), "text": string }],
  "prep_time": number (minutes),
  "cook_time": number (minutes),
  "servings": number,
  "calories": number (per serving),
  "dietary_tags": string[] (e.g. "gluten-free", "high-protein", "vegan")
}`;

export function normalizeRecipe(p: any): RecipeData {
  p = p ?? {};
  const ingredients: Ingredient[] = Array.isArray(p.ingredients)
    ? p.ingredients.map((i: any) => ({
        name: String(i?.name ?? "").trim(),
        amount: String(i?.amount ?? "").trim(),
        unit: String(i?.unit ?? "").trim(),
      })).filter((i: Ingredient) => i.name)
    : [];
  const instructions: Instruction[] = Array.isArray(p.instructions)
    ? p.instructions.map((s: any, idx: number) => ({
        step: Number(s?.step ?? idx + 1),
        text: String(s?.text ?? "").trim(),
      })).filter((s: Instruction) => s.text)
    : [];
  return {
    title: String(p.title || "Untitled Recipe"),
    description: String(p.description ?? ""),
    ingredients,
    instructions,
    prep_time: Number(p.prep_time) || 0,
    cook_time: Number(p.cook_time) || 0,
    servings: Number(p.servings) || 2,
    calories: Number(p.calories) || 0,
    dietary_tags: Array.isArray(p.dietary_tags) ? p.dietary_tags.map(String).slice(0, 8) : [],
  };
}

/* ── schema.org Recipe ─────────────────────────────────────────── */

/** "PT1H15M" → 75. Anything unparseable → 0. */
export function parseIsoDuration(v: unknown): number {
  const m = String(v ?? "").trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return 0;
  return Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

export function recipeFromStructured(r: any): RecipeData {
  const str = (v: unknown) => decodeEntities(String(v ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const ingredients = toArray(r?.recipeIngredient ?? r?.ingredients)
    .map((s) => parseIngredientLine(str(s)))
    .filter((i) => i.name);
  const steps = flattenSteps(r?.recipeInstructions).map(str).filter(Boolean);
  const prep = parseIsoDuration(r?.prepTime);
  const total = parseIsoDuration(r?.totalTime);
  const firstInt = (v: unknown) => parseInt(String(v ?? "").match(/\d+/)?.[0] ?? "", 10) || 0;
  const diets = toArray(r?.suitableForDiet).map((d) =>
    String(d).split("/").pop()!.replace(/Diet$/, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()
  );
  return normalizeRecipe({
    title: str(r?.name),
    description: str(r?.description),
    ingredients,
    instructions: steps.map((text, i) => ({ step: i + 1, text })),
    prep_time: prep,
    cook_time: parseIsoDuration(r?.cookTime) || Math.max(0, total - prep),
    servings: firstInt(toArray(r?.recipeYield)[0]),
    calories: firstInt(r?.nutrition?.calories),
    dietary_tags: diets,
  });
}

function flattenSteps(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") return v.split(/\r?\n+/);
  if (Array.isArray(v)) return v.flatMap(flattenSteps);
  if (typeof v === "object") {
    const o = v as any;
    if (o.itemListElement) return flattenSteps(o.itemListElement);
    return [String(o.text ?? o.name ?? "")];
  }
  return [];
}

function toArray(v: unknown): unknown[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

/* ── Ingredient lines ──────────────────────────────────────────── */

const FRACTIONS = "½⅓⅔¼¾⅛⅜⅝⅞";
const AMOUNT = new RegExp(
  `^((?:\\d+\\s+\\d+\\/\\d+)|(?:\\d+\\/\\d+)|(?:\\d*\\s*[${FRACTIONS}])|(?:\\d+(?:[.,]\\d+)?(?:\\s*(?:-|–|to)\\s*\\d+(?:[.,]\\d+)?)?))(?=\\s|[a-zA-Z]|$)\\s*`
);

const UNITS = new Set(
  (
    "cup cups c tbsp tbsps tbs tablespoon tablespoons tsp tsps teaspoon teaspoons oz ounce ounces lb lbs pound pounds " +
    "g gram grams kg ml l liter liters litre litres pint pints quart quarts gallon gallons clove cloves can cans jar jars " +
    "slice slices pinch pinches dash dashes stick sticks bunch bunches handful handfuls package packages pkg sprig sprigs " +
    "head heads piece pieces block blocks bag bags box boxes"
  ).split(" ")
);

const stripBullet = (s: string) => s.replace(/^\s*[-–•*·▪◦✓✔]+\s*/, "");

/** "1/2 cup olive oil" → { amount: "1/2", unit: "cup", name: "olive oil" }. */
export function parseIngredientLine(raw: string): Ingredient {
  const line = stripBullet(raw).replace(/\s+/g, " ").trim();
  const m = line.match(AMOUNT);
  if (!m) return { name: line, amount: "", unit: "" };
  const amount = m[1].replace(/\s+/g, " ").trim();
  let rest = line.slice(m[0].length);
  let unit = "";
  const word = rest.match(/^([a-zA-Z]+)\.?(?:\s+|$)/);
  if (word && UNITS.has(word[1].toLowerCase())) {
    unit = word[1].toLowerCase();
    rest = rest.slice(word[0].length);
  }
  const name = rest.replace(/^of\s+/i, "").trim();
  return name ? { name, amount, unit } : { name: line, amount: "", unit: "" };
}

/* ── Caption heuristic (offline path) ──────────────────────────── */

const EMOJI = new RegExp("[\\p{Extended_Pictographic}\\uFE0F\\u200D]", "gu");
const HASHTAG = new RegExp("#[\\p{L}\\p{N}_]+", "gu");
const COOK_VERB =
  /\b(preheat|bake|roast|cook|boil|simmer|fry|saute|sauté|sear|grill|broil|air ?fry|mix|stir|whisk|combine|add|pour|put|place|toss|season|chop|dice|slice|blend|fold|knead|marinate|drain|serve|garnish|heat|melt|spread|layer|cover)\b/i;
const HEADER_INGREDIENTS = /^(ingredients?|you(?:'|’)ll need|what you(?:'|’)ll need|what you need|shopping list)\s*:?$/i;
const HEADER_STEPS = /^(instructions?|directions?|method|steps?|how to make it|how to)\s*:?$/i;
const NUMBERED = /^(?:step\s*)?\d+\s*[.):]\s+/i;

/**
 * Best-effort recipe from caption text alone. Only trusted when it finds at
 * least a couple of ingredients — the caller checks that.
 */
export function recipeFromCaption(caption: string, hintTitle = ""): RecipeData {
  const lines = caption
    .split(/\r?\n/)
    .map((l) => l.replace(HASHTAG, "").replace(EMOJI, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const ingredients: Ingredient[] = [];
  const steps: string[] = [];
  let section: "none" | "ingredients" | "steps" = "none";
  let inIngredientRun = false;

  for (const line of lines) {
    if (HEADER_INGREDIENTS.test(line)) { section = "ingredients"; inIngredientRun = true; continue; }
    if (HEADER_STEPS.test(line)) { section = "steps"; inIngredientRun = false; continue; }

    const words = line.split(" ").length;
    const hasAmount = AMOUNT.test(stripBullet(line));
    const reads_as_step = COOK_VERB.test(line) && words > 4 && !(hasAmount && words <= 6);

    if (section === "steps" || NUMBERED.test(line) || reads_as_step) {
      steps.push(line.replace(NUMBERED, ""));
      inIngredientRun = false;
    } else if (
      section === "ingredients" ||
      (hasAmount && words <= 10) ||
      // "Salt" / "Thyme" inside a run of measured lines is an ingredient too.
      (inIngredientRun && words <= 4 && !/[.!?]$/.test(line))
    ) {
      ingredients.push(parseIngredientLine(line));
      inIngredientRun = true;
    } else {
      inIngredientRun = false;
    }
  }

  const text = lines.join("\n");
  const hook = text.match(
    /\b(?:this is|making|how to make|recipe for|let'?s make|today'?s|i made)\s+(?:(?:my|a|an|the|some|this)\s+)?([^.!?\n#\-–—:]{3,50})/i
  );
  const cleanHint = hintTitle.replace(HASHTAG, "").replace(EMOJI, "").replace(/\s+/g, " ").trim();
  const title = toTitleCase((hook?.[1] ?? cleanHint ?? "").trim().slice(0, 60)) || "Imported Recipe";

  const cookMatch = text.match(/\b(?:bake|roast|cook|simmer|boil|fry|grill|air ?fry)[^.\n]*?(\d+)\s*(?:-\s*\d+\s*)?(min|minutes|mins|hours?|hrs?)\b/i);
  const prepMatch = text.match(/\bprep[^.\n\d]*(\d+)\s*(?:min|minutes|mins)\b/i);
  const servingsMatch = text.match(/\b(?:serves|servings?:?|feeds|makes)\s*(\d+)/i);

  const lower = text.toLowerCase();
  const tags = [
    ["vegan", "vegan"],
    ["vegetarian", "vegetarian"],
    ["gluten-free", "gluten"],
    ["dairy-free", "dairy-free"],
    ["keto", "keto"],
    ["high-protein", "protein"],
  ].filter(([, needle]) => lower.includes(needle)).map(([tag]) => tag);

  return normalizeRecipe({
    title,
    description: "",
    ingredients,
    instructions: steps.map((t, i) => ({ step: i + 1, text: t })),
    prep_time: prepMatch ? Number(prepMatch[1]) : 0,
    cook_time: cookMatch ? Number(cookMatch[1]) * (/^h/i.test(cookMatch[2]) ? 60 : 1) : 0,
    servings: servingsMatch ? Number(servingsMatch[1]) : 0,
    calories: 0,
    dietary_tags: tags,
  });
}

function toTitleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

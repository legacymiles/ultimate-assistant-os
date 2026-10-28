// What kind of dish a recipe is, and what it is mostly made of — so people can
// find "dinner with chicken I rated 8 or better" in two taps (owner's ask, Oct 2026).
//
// Pure. A recipe's meal types come from its tags first (the editor's meal chips
// and the auto-tagger both write tags), then from words in its title and
// description. Main ingredients come from the title and the ingredient list.

import type { Recipe } from "./types";

export type MealId = "breakfast" | "lunch" | "dinner" | "snack" | "dessert" | "healthy" | "fun";

export interface Meal {
  id: MealId;
  label: string;
  /** Tag the editor writes when the cook picks this chip. */
  tag: string;
  /** Other tags that mean the same thing (the auto-tagger's words). */
  tags: string[];
  /** Words in a title or description that give it away. */
  words: string[];
}

export const MEALS: Meal[] = [
  {
    id: "breakfast", label: "Breakfast", tag: "breakfast",
    tags: ["breakfast", "brunch"],
    words: ["breakfast", "brunch", "pancake", "waffle", "omelet", "omelette", "french toast", "oatmeal", "granola",
      "scrambled", "frittata", "bagel", "smoothie", "hash brown", "muffin", "biscuits and gravy"],
  },
  {
    id: "lunch", label: "Lunch", tag: "lunch",
    tags: ["lunch"],
    words: ["lunch", "sandwich", "wrap", "panini", "quesadilla", "burger", "soup", "salad", "bowl", "sub"],
  },
  {
    id: "dinner", label: "Dinner", tag: "dinner",
    tags: ["dinner", "main", "main course", "entree", "entrée", "supper"],
    words: ["dinner", "roast", "casserole", "lasagna", "steak", "stir fry", "stir-fry", "curry", "chili",
      "pot roast", "meatloaf", "spaghetti", "alfredo", "enchilada", "fajita", "baked chicken", "pork chop"],
  },
  {
    id: "snack", label: "Snacks", tag: "snack",
    tags: ["snack", "snacks", "appetizer", "appetizers", "side", "finger food", "party food"],
    words: ["snack", "dip", "chips", "popcorn", "nachos", "wings", "bites", "trail mix", "energy ball",
      "pretzel", "appetizer", "deviled egg", "salsa", "guacamole"],
  },
  {
    id: "dessert", label: "Desserts", tag: "dessert",
    tags: ["dessert", "desserts", "baking", "sweet", "sweets"],
    words: ["dessert", "cake", "cookie", "brownie", "pie", "ice cream", "sundae", "cheesecake", "pudding",
      "cupcake", "fudge", "tart", "cobbler", "donut", "doughnut", "banana split", "milkshake"],
  },
  {
    id: "healthy", label: "Healthy", tag: "healthy",
    tags: ["healthy", "low carb", "low-carb", "keto", "vegan", "vegetarian", "high protein", "high-protein",
      "gluten free", "gluten-free", "paleo", "light", "whole30", "low calorie", "low-calorie"],
    words: ["healthy", "low carb", "keto", "vegan", "high protein", "protein", "light", "lean", "grilled",
      "steamed", "quinoa", "kale", "skinny", "clean eating"],
  },
  {
    id: "fun", label: "Fun food", tag: "fun food",
    tags: ["fun food", "fun", "kids", "kid friendly", "kid-friendly", "party", "holiday", "decorated", "themed",
      "event", "birthday"],
    words: ["fun", "kids", "cute", "shaped", "decorated", "rainbow", "unicorn", "halloween", "christmas",
      "birthday", "party", "bento", "mummy", "spooky", "character", "sprinkles", "edible art", "themed"],
  },
];

export const MEAL_BY_ID: Record<MealId, Meal> = Object.fromEntries(MEALS.map((m) => [m.id, m])) as Record<MealId, Meal>;

export interface MainIngredient {
  id: string;
  label: string;
  /** Words that count as this ingredient (singular and plural both match). */
  words: string[];
}

/** The quick chips under the search bar. The owner's list first, then the usual suspects. */
export const MAIN_INGREDIENTS: MainIngredient[] = [
  { id: "chicken", label: "Chicken", words: ["chicken", "wing", "drumstick", "thigh"] },
  { id: "tuna", label: "Tuna", words: ["tuna"] },
  { id: "beef", label: "Beef", words: ["beef", "ground beef", "brisket", "hamburger", "meatball"] },
  { id: "steak", label: "Steak", words: ["steak", "ribeye", "sirloin", "filet mignon", "t-bone", "strip steak"] },
  { id: "beans", label: "Beans", words: ["bean", "chickpea", "lentil", "garbanzo"] },
  { id: "rice", label: "Rice", words: ["rice", "risotto", "fried rice"] },
  { id: "salad", label: "Salad", words: ["salad", "lettuce", "romaine", "greens", "spinach", "arugula"] },
  { id: "broccoli", label: "Broccoli", words: ["broccoli"] },
  { id: "cauliflower", label: "Cauliflower", words: ["cauliflower"] },
  { id: "noodles", label: "Noodles", words: ["noodle", "ramen", "lo mein", "udon", "pho"] },
  { id: "pasta", label: "Pasta", words: ["pasta", "spaghetti", "penne", "macaroni", "fettuccine", "lasagna", "linguine", "rigatoni"] },
  { id: "eggs", label: "Eggs", words: ["egg"] },
  { id: "pork", label: "Pork", words: ["pork", "bacon", "ham", "sausage", "ribs"] },
  { id: "turkey", label: "Turkey", words: ["turkey"] },
  { id: "shrimp", label: "Shrimp", words: ["shrimp", "prawn"] },
  { id: "salmon", label: "Salmon", words: ["salmon"] },
  { id: "fish", label: "Fish", words: ["fish", "tilapia", "cod", "catfish", "salmon", "tuna"] },
  { id: "potatoes", label: "Potatoes", words: ["potato", "fries", "hash brown"] },
  { id: "cheese", label: "Cheese", words: ["cheese", "cheddar", "mozzarella", "parmesan"] },
  { id: "tofu", label: "Tofu", words: ["tofu", "tempeh"] },
  { id: "banana", label: "Banana", words: ["banana"] },
  { id: "chocolate", label: "Chocolate", words: ["chocolate", "cocoa"] },
];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Whole-word match that also takes a plural: "egg" matches "eggs", not "eggplant". */
export function hasWord(haystack: string, word: string): boolean {
  const escaped = norm(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}(e?s)?([^a-z]|$)`).test(norm(haystack));
}

type RecipeLike = Pick<Recipe, "title" | "description" | "tags" | "ingredients">;

/** Meal types for a recipe. Tags win; words fill in when there are no meal tags. */
export function mealsOf(recipe: RecipeLike): MealId[] {
  const tags = (recipe.tags ?? []).map(norm);
  const fromTags = MEALS.filter((m) => m.tags.some((t) => tags.includes(norm(t)))).map((m) => m.id);
  const text = `${recipe.title} ${recipe.description ?? ""}`;
  const fromWords = MEALS
    .filter((m) => !fromTags.includes(m.id) && m.words.some((w) => hasWord(text, w)))
    .map((m) => m.id);
  // If the cook chose a meal type on purpose, guesses about the other meals stay out —
  // except Healthy and Fun food, which sit on top of any meal.
  const explicitMeal = fromTags.some((id) => id !== "healthy" && id !== "fun");
  const guesses = explicitMeal ? fromWords.filter((id) => id === "healthy" || id === "fun") : fromWords;
  return MEALS.map((m) => m.id).filter((id) => fromTags.includes(id) || guesses.includes(id));
}

/** Main ingredients found in the title, tags or ingredient list. */
export function mainIngredientsOf(recipe: RecipeLike): string[] {
  const text = [
    recipe.title,
    ...(recipe.tags ?? []),
    ...(recipe.ingredients ?? []).map((i) => i.name),
  ].join(" · ");
  return MAIN_INGREDIENTS.filter((ing) => ing.words.some((w) => hasWord(text, w))).map((i) => i.id);
}

/* ── Personal ranks ───────────────────────────────────────────── */

/** A rank is a whole number 1–10, or nothing. */
export function clampRank(value: unknown): number | null {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(10, n);
}

export function rankWord(rank: number): string {
  if (rank >= 10) return "Perfect";
  if (rank >= 9) return "Favourite";
  if (rank >= 8) return "Great";
  if (rank >= 6) return "Good";
  if (rank >= 4) return "Okay";
  return "Not for me";
}

/** The "rank above" steps the owner asked for. 0 = any. */
export const MIN_RANKS = [0, 4, 6, 8] as const;

/* ── Search and filters ───────────────────────────────────────── */

export interface RecipeFilter {
  term: string;
  meals: MealId[];
  ingredients: string[];
  /** Only recipes I ranked this or higher. 0 = any (unranked included). */
  minRank: number;
}

export type RecipeSort = "rank" | "newest" | "az";

export const EMPTY_FILTER: RecipeFilter = { term: "", meals: [], ingredients: [], minRank: 0 };

/**
 * The search bar matches a recipe's name, its description, its tags or any of
 * its ingredients — so "tuna" finds tuna casserole and anything with tuna in it.
 * Several words must all match somewhere.
 */
export function matchesTerm(recipe: RecipeLike, term: string): boolean {
  const words = norm(term).split(/[\s,]+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = norm([
    recipe.title,
    recipe.description ?? "",
    ...(recipe.tags ?? []),
    ...(recipe.ingredients ?? []).map((i) => i.name),
  ].join(" "));
  return words.every((w) => hay.includes(w));
}

/**
 * Filter a list. Meal chips are OR within themselves (breakfast or dessert);
 * ingredient chips are AND (chicken and rice); the rank floor applies on top.
 */
export function filterRecipes<T extends RecipeLike & { id: string }>(
  recipes: T[],
  filter: RecipeFilter,
  ranks: Record<string, number>,
): T[] {
  return recipes.filter((r) => {
    if (!matchesTerm(r, filter.term)) return false;
    if (filter.meals.length) {
      const meals = mealsOf(r);
      if (!filter.meals.some((m) => meals.includes(m))) return false;
    }
    if (filter.ingredients.length) {
      const have = mainIngredientsOf(r);
      if (!filter.ingredients.every((i) => have.includes(i))) return false;
    }
    if (filter.minRank > 0) {
      const rank = ranks[r.id];
      if (!rank || rank < filter.minRank) return false;
    }
    return true;
  });
}

export function sortRecipes<T extends { id: string; title: string; created_at: string }>(
  recipes: T[],
  sort: RecipeSort,
  ranks: Record<string, number>,
): T[] {
  return [...recipes].sort((a, b) => {
    if (sort === "rank") {
      const d = (ranks[b.id] ?? 0) - (ranks[a.id] ?? 0);
      if (d !== 0) return d;
    }
    if (sort === "az") return a.title.localeCompare(b.title);
    return b.created_at.localeCompare(a.created_at);
  });
}

/** How many filters are on, for the "Clear (3)" button. */
export const activeFilterCount = (f: RecipeFilter) =>
  (f.term.trim() ? 1 : 0) + f.meals.length + f.ingredients.length + (f.minRank > 0 ? 1 : 0);

/** Add or remove an item from a chip list. */
export function toggleIn<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

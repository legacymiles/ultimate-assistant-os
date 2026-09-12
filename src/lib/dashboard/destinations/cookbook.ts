import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getLocalCookbookClient } from "@/components/cookbook/localClient";
import type { Destination } from "./types";

// ---------------------------------------------------------------------------
// Photo of a recipe → a recipe in Cookbook Genie.
//
// The obvious camera-roll case: a handwritten card, a page of a cookbook, a
// menu, a dish someone posted. This is the destination most likely to earn its
// keep, because a recipe photo is otherwise dead weight in a camera roll — you
// can see it, but you cannot search it or cook from it on a phone in a kitchen.
//
// Cookbook Genie has no store module: it talks to Supabase (or a localStorage
// shim with the same query-builder shape) from inside its components. So this
// destination uses THAT SAME CLIENT rather than reaching into its storage key,
// which keeps the app's own rules — ids, timestamps, the local/remote split —
// in the one place that owns them.
//
// A recipe needs a parent cookbook, so one is resolved or created before the
// insert. Photos land in a dedicated "From Photos" cookbook rather than
// whichever cookbook happens to be first: a filing rule that depends on
// ordering is a filing rule that moves.
// ---------------------------------------------------------------------------

const INBOX_COOKBOOK = "From Photos";

export interface RecipeFields {
  title: string;
  description: string;
  ingredients: string[];
  instructions: string[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  dietaryTags: string[];
  incomplete: boolean;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strList(v: unknown, cap: number): string[] {
  return Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean).slice(0, cap) : [];
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
}

export const cookbookDestination: Destination<RecipeFields> = {
  id: "cookbook",
  label: "Cookbook Genie",
  appSlug: "cookbook-genie",

  hint:
    '"cookbook" — the photo is a RECIPE: a handwritten card, a page from a ' +
    "cookbook, a printed sheet, a menu with a dish described, or a screenshot " +
    "of a recipe. Route here when the image tells you how to cook something.",

  fields: [
    { name: "title", type: "string", describe: "The dish name." },
    { name: "description", type: "string", describe: "One appetising sentence about the dish." },
    {
      name: "ingredients",
      type: "string[]",
      describe:
        "One entry per ingredient, transcribed with its quantity, e.g. " +
        '"2 tbsp olive oil". Verbatim — do not convert units or substitute.',
    },
    {
      name: "instructions",
      type: "string[]",
      describe: "One entry per step, in order, transcribed from the image.",
    },
    { name: "prepTime", type: "number", describe: "Prep minutes if stated, else 0." },
    { name: "cookTime", type: "number", describe: "Cook minutes if stated, else 0." },
    { name: "servings", type: "number", describe: "Servings if stated, else 0." },
    {
      name: "dietaryTags",
      type: "string[]",
      describe:
        'Only what the recipe supports: "vegetarian", "vegan", "gluten-free", ' +
        '"high-protein", "dairy-free". Empty when unsure — a wrong tag here is ' +
        "the one error that could matter to someone with an allergy.",
    },
    {
      name: "incomplete",
      type: "boolean",
      describe:
        "true if ingredients or steps are cut off, unreadable, or continue onto " +
        "a page not shown.",
    },
  ],

  parse(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const title = str(r.title);
    if (!title) return null;

    const ingredients = strList(r.ingredients, 60);
    const instructions = strList(r.instructions, 40);

    return {
      title,
      description: str(r.description),
      ingredients,
      instructions,
      prepTime: num(r.prepTime),
      cookTime: num(r.cookTime),
      servings: num(r.servings),
      dietaryTags: strList(r.dietaryTags, 6).map((t) => t.toLowerCase()),
      // Trust the model's own flag, but also infer it: a "recipe" with no
      // ingredients or no steps is missing something whatever the model said.
      incomplete: r.incomplete === true || !ingredients.length || !instructions.length,
    };
  },

  preview(f) {
    const lines = [f.description].filter(Boolean);
    lines.push(
      `${f.ingredients.length} ingredient${f.ingredients.length === 1 ? "" : "s"} · ` +
        `${f.instructions.length} step${f.instructions.length === 1 ? "" : "s"}` +
        (f.servings ? ` · serves ${f.servings}` : ""),
    );
    if (f.dietaryTags.length) lines.push(f.dietaryTags.join(", "));

    return {
      title: f.title,
      where: `Cookbook Genie › ${INBOX_COOKBOOK}`,
      lines,
      unverified: f.incomplete
        ? "Ingredients or steps look cut off — check it before cooking from this"
        : undefined,
    };
  },

  async commit(f) {
    // Same client the app itself uses: Supabase when configured, the
    // localStorage shim otherwise. Never the storage key directly.
    const sb = getSupabaseBrowserClient() ?? (getLocalCookbookClient() as never);

    const { data: auth } = await sb.auth.getUser();
    const ownerId = auth?.user?.id;
    if (!ownerId) throw new Error("Sign in to Cookbook Genie before filing recipes.");

    const { data: existing } = await sb
      .from("cookbooks")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("name", INBOX_COOKBOOK)
      .maybeSingle();

    let cookbookId = existing?.id as string | undefined;
    if (!cookbookId) {
      const { data: made } = await sb
        .from("cookbooks")
        .insert({
          name: INBOX_COOKBOOK,
          description: "Recipes read out of photos by Dashboard.",
          owner_id: ownerId,
          privacy: "private",
        })
        .select()
        .single();
      cookbookId = made?.id as string | undefined;
    }
    if (!cookbookId) throw new Error("Could not open the “From Photos” cookbook.");

    await sb.from("recipes").insert({
      cookbook_id: cookbookId,
      title: f.title,
      description: f.description,
      ingredients: f.ingredients,
      instructions: f.instructions,
      prep_time: f.prepTime ?? null,
      cook_time: f.cookTime ?? null,
      servings: f.servings ?? null,
      dietary_tags: f.dietaryTags,
    });
  },
};

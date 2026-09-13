import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getLocalCookbookClient } from "@/components/cookbook/localClient";
import { closestPlace } from "../places";
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
// The row shape is Cookbook Genie's, not ours: RecipeView renders
// `{ing.amount} {ing.unit} {ing.name}` and `{inst.text}`. Writing plain strings
// — as the first version of this file did — produced blank ingredient and step
// rows, because every one of those properties was undefined.
//
// Which cookbook: the one the user named ("my Desserts cookbook"), matched to
// an existing cookbook when it is the same one under another spelling, else
// created. With nothing named, recipes land in "From Photos" — a dedicated
// cookbook rather than whichever happens to sort first, because a filing rule
// that depends on ordering is a filing rule that moves.
// ---------------------------------------------------------------------------

const INBOX_COOKBOOK = "From Photos";

/** Cookbook Genie's own ingredient row, as RecipeView and scale() read it. */
export interface Ingredient {
  name: string;
  /** A string, not a number: scale() parseFloats it and passes non-numbers through. */
  amount: string;
  unit: string;
}

/** Cookbook Genie's own step row. */
export interface Instruction {
  step: number;
  text: string;
}

export interface RecipeFields {
  title: string;
  description: string;
  ingredients: Ingredient[];
  instructions: Instruction[];
  prepTime?: number;
  cookTime?: number;
  servings?: number;
  dietaryTags: string[];
  incomplete: boolean;
  /** The cookbook the user asked for, or "" for the default inbox cookbook. */
  cookbook: string;
}

/**
 * The slice of the client this destination touches. Both the Supabase client
 * and the local shim implement it — notably getSession, which is the only
 * session call the shim has (it has no getUser) and the one Cookbook Genie
 * itself uses.
 */
type CookbookClient = {
  auth: {
    getSession(): Promise<{ data: { session: { user: { id: string } } | null } }>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
};

function cookbookClient(): CookbookClient {
  // Same client the app itself uses: Supabase when configured, the
  // localStorage shim otherwise. Never the storage key directly.
  return (getSupabaseBrowserClient() ?? getLocalCookbookClient()) as unknown as CookbookClient;
}

/**
 * The signed-in cook. On the shim, getSession provisions the guest on first
 * visit exactly as opening Cookbook Genie would, so filing a recipe does not
 * require having opened that app first.
 */
async function ownerOf(sb: CookbookClient): Promise<string | null> {
  const { data } = await sb.auth.getSession();
  return data?.session?.user?.id ?? null;
}

async function ownCookbooks(sb: CookbookClient, ownerId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await sb.from("cookbooks").select("id,name").eq("owner_id", ownerId);
  if (error) throw new Error(`Could not open Cookbook Genie: ${error.message ?? error}`);
  return Array.isArray(data)
    ? (data as { id?: string; name?: string }[])
        .filter((c) => c?.id && c?.name)
        .map((c) => ({ id: c.id as string, name: c.name as string }))
    : [];
}

/** Trimmed text from a string or a number; anything else is "". */
function text(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function strList(v: unknown, cap: number): string[] {
  return Array.isArray(v) ? v.map((s) => text(s)).filter(Boolean).slice(0, cap) : [];
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
}

export function ingredientList(v: unknown): Ingredient[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 60)
    .map((raw): Ingredient => {
      // A photo analysed before this shape existed, or a model that ignored it,
      // sends plain strings. Those become the ingredient's name, so nothing that
      // was transcribed is thrown away.
      if (typeof raw === "string") return { name: raw.trim(), amount: "", unit: "" };
      const r = (raw ?? {}) as Record<string, unknown>;
      return { name: text(r.name), amount: text(r.amount), unit: text(r.unit) };
    })
    .filter((i) => i.name);
}

export function instructionList(v: unknown): Instruction[] {
  if (!Array.isArray(v)) return [];
  const texts = v
    .slice(0, 40)
    .map((raw) => (typeof raw === "string" ? raw : text((raw as Record<string, unknown>)?.text)))
    // "1. Heat the oven" would render as step 1 followed by "1. Heat the oven".
    .map((t) => t.trim().replace(/^\d+\s*[.)]\s*/, ""))
    .filter(Boolean);
  // Numbered by position, never by whatever number the model wrote: a
  // transcription that skips or repeats a number would otherwise render wrong.
  return texts.map((t, i) => ({ step: i + 1, text: t }));
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
      type: '{"name":string,"amount":string,"unit":string}[]',
      describe:
        'One entry per ingredient. amount and unit EXACTLY as written — "1 1/2" ' +
        'and "cups", "3/4" and "cup" — never converted. Use "" for both when the ' +
        'recipe gives no quantity, e.g. {"name":"salt","amount":"","unit":"pinch"}.',
    },
    {
      name: "instructions",
      type: "string[]",
      describe:
        "One entry per step, in order, transcribed verbatim WITHOUT its step " +
        "number. A step that wraps onto a second line is still one step.",
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
    {
      name: "cookbook",
      type: "string",
      describe:
        "The user's cookbook this recipe goes in — ONLY when their instructions name one, " +
        'using their existing cookbook\'s exact name when it is the same one. Otherwise "".',
    },
  ],

  parse(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const title = text(r.title);
    if (!title) return null;

    const ingredients = ingredientList(r.ingredients);
    const instructions = instructionList(r.instructions);

    return {
      title,
      description: text(r.description),
      ingredients,
      instructions,
      prepTime: num(r.prepTime),
      cookTime: num(r.cookTime),
      servings: num(r.servings),
      dietaryTags: strList(r.dietaryTags, 6).map((t) => t.toLowerCase()),
      // Trust the model's own flag, but also infer it: a "recipe" with no
      // ingredients or no steps is missing something whatever the model said.
      incomplete: r.incomplete === true || !ingredients.length || !instructions.length,
      cookbook: text(r.cookbook).slice(0, 60),
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
      where: `Cookbook Genie › ${f.cookbook || INBOX_COOKBOOK}`,
      lines,
      unverified: f.incomplete
        ? "Ingredients or steps look cut off — check it before cooking from this"
        : undefined,
    };
  },

  async places() {
    const sb = cookbookClient();
    const ownerId = await ownerOf(sb);
    return ownerId ? (await ownCookbooks(sb, ownerId)).map((c) => c.name) : [];
  },

  async commit(f) {
    const sb = cookbookClient();
    const ownerId = await ownerOf(sb);
    if (!ownerId) {
      throw new Error("Cookbook Genie is signed out — open it, sign in, then file this again.");
    }

    // The named cookbook, as the SAME cookbook under another spelling when one
    // exists ("desert" → "Desserts"), else a new one by that name. The agent is
    // given the existing names, so this is normally exact; it is the safety net.
    const wanted = f.cookbook || INBOX_COOKBOOK;
    const mine = await ownCookbooks(sb, ownerId);
    const match = closestPlace(wanted, mine.map((c) => c.name));
    let cookbookId = match ? mine.find((c) => c.name === match)?.id : undefined;

    if (!cookbookId) {
      const { data: made, error: makeErr } = await sb
        .from("cookbooks")
        .insert({
          name: wanted,
          description: "Recipes read out of photos by Dashboard.",
          owner_id: ownerId,
          privacy: "private",
        })
        .select()
        .single();
      if (makeErr) throw new Error(`Could not create “${wanted}”: ${makeErr.message ?? makeErr}`);
      cookbookId = made?.id as string | undefined;
    }
    if (!cookbookId) throw new Error(`Could not open the “${wanted}” cookbook.`);

    // Supabase reports a failed insert in the return value rather than by
    // throwing. Unchecked, a refused save counted as filed and the photo left
    // the queue with nothing to show for it.
    const { error: insErr } = await sb.from("recipes").insert({
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
    if (insErr) throw new Error(`Cookbook Genie refused the recipe: ${insErr.message ?? insErr}`);
  },
};

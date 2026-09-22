import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiKey, aiFetch } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/cook-connect/recipe
//   { action: "draft", prompt }            → a new recipe from a sentence
//   { action: "revise", recipe, note }     → the same recipe, changed
//
// A key is optional. Without one the heuristic below answers, so the Add a
// recipe screen still works and still produces something editable.

interface Ingredient { name: string; amount: string; unit: string }
interface Step { step: number; text: string }

export interface DraftedRecipe {
  title: string;
  description: string;
  ingredients: Ingredient[];
  instructions: Step[];
  tags: string[];
  prep_time: number;
  cook_time: number;
  servings: number;
}

const MODEL = process.env.AI_MODEL || DEFAULT_MODEL;

const SCHEMA = `{
  "title": string,
  "description": string (one appetising sentence),
  "ingredients": [{ "name": string, "amount": string, "unit": string }],
  "instructions": [{ "step": number (1-based), "text": string }],
  "tags": string[] (up to 5, lowercase: course, main protein, cuisine, diet),
  "prep_time": number (minutes),
  "cook_time": number (minutes),
  "servings": number
}`;

export async function POST(req: Request) {
  let body: { action?: string; prompt?: string; note?: string; recipe?: DraftedRecipe };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const action = body.action === "revise" ? "revise" : "draft";
  const key = aiKey();

  if (!key) {
    return NextResponse.json({
      ...(action === "revise" ? heuristicRevise(body.recipe, body.note ?? "") : heuristicDraft(body.prompt ?? "")),
      offline: true,
    });
  }

  try {
    const recipe = action === "revise"
      ? await revise(body.recipe, body.note ?? "", key)
      : await draft(body.prompt ?? "", key);
    return NextResponse.json({ ...recipe, offline: false });
  } catch (err) {
    console.error("cook-connect recipe generation failed, using heuristic:", err);
    return NextResponse.json({
      ...(action === "revise" ? heuristicRevise(body.recipe, body.note ?? "") : heuristicDraft(body.prompt ?? "")),
      offline: true,
    });
  }
}

async function draft(prompt: string, key: string): Promise<DraftedRecipe> {
  const system =
    "You are a working chef writing for a home cook. Given a request, produce one "
    + "complete, realistic recipe with amounts that add up. Respond ONLY with minified JSON.";
  return normalise(JSON.parse(await call(key, system, `Request: ${prompt}\n\nReturn JSON matching:\n${SCHEMA}`)));
}

async function revise(recipe: DraftedRecipe | undefined, note: string, key: string): Promise<DraftedRecipe> {
  const system =
    "You are a working chef. Change the given recipe as instructed and keep everything "
    + "else consistent — if the servings change, the amounts change too. Respond ONLY with minified JSON.";
  const user = `CURRENT RECIPE:\n${JSON.stringify(recipe)}\n\nCHANGE: ${note}\n\nReturn JSON matching:\n${SCHEMA}`;
  return normalise(JSON.parse(await call(key, system, user)));
}

async function call(key: string, system: string, user: string): Promise<string> {
  const res = await aiFetch({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`AI provider ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? "";
}

/** Never trust a model's shape: coerce everything to what the app renders. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalise(raw: any): DraftedRecipe {
  const ingredients: Ingredient[] = Array.isArray(raw?.ingredients)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? raw.ingredients.map((i: any) => ({
      name: String(i?.name ?? "").trim() || "ingredient",
      amount: String(i?.amount ?? "").trim(),
      unit: String(i?.unit ?? "").trim(),
    })).filter((i: Ingredient) => i.name)
    : [];

  const instructions: Step[] = Array.isArray(raw?.instructions)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? raw.instructions.map((s: any, idx: number) => ({
      step: idx + 1,
      text: String(typeof s === "string" ? s : s?.text ?? "").trim(),
    })).filter((s: Step) => s.text)
    : [];

  return {
    title: String(raw?.title ?? "Untitled recipe").trim().slice(0, 120),
    description: String(raw?.description ?? "").trim().slice(0, 400),
    ingredients: ingredients.length ? ingredients : heuristicDraft(raw?.title ?? "").ingredients,
    instructions: instructions.length ? instructions : heuristicDraft(raw?.title ?? "").instructions,
    tags: Array.isArray(raw?.tags)
      ? raw.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 5)
      : [],
    prep_time: clampMinutes(raw?.prep_time, 15),
    cook_time: clampMinutes(raw?.cook_time, 20),
    servings: Math.min(24, Math.max(1, Math.round(Number(raw?.servings) || 4))),
  };
}

function clampMinutes(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= 1440 ? n : fallback;
}

/* ── Without a key ─────────────────────────────────────────────── */

const DIET_WORDS = ["vegan", "vegetarian", "gluten-free", "high-protein", "keto", "dairy-free"];
const COURSE_WORDS = ["breakfast", "lunch", "dinner", "dessert", "snack", "brunch"];

function heuristicDraft(prompt: string): DraftedRecipe {
  const title = titleize(prompt);
  const lower = prompt.toLowerCase();
  const tags = [
    ...COURSE_WORDS.filter((w) => lower.includes(w)),
    ...DIET_WORDS.filter((w) => lower.includes(w.replace("-", " ")) || lower.includes(w)),
  ].slice(0, 5);

  return {
    title,
    description: `A straightforward take on ${title.toLowerCase()}, written to be cooked on a weeknight.`,
    ingredients: [
      { name: "main ingredient", amount: "500", unit: "g" },
      { name: "olive oil", amount: "2", unit: "tbsp" },
      { name: "garlic, sliced", amount: "3", unit: "cloves" },
      { name: "salt", amount: "1", unit: "tsp" },
      { name: "black pepper", amount: "0.5", unit: "tsp" },
      { name: "fresh herbs", amount: "2", unit: "tbsp" },
    ],
    instructions: [
      { step: 1, text: "Prepare everything first: wash, chop and measure, so nothing waits on you once the pan is hot." },
      { step: 2, text: "Warm the oil over a medium heat and cook the garlic until it smells sweet, about a minute." },
      { step: 3, text: "Add the main ingredient and cook, turning now and then, until tender and lightly coloured." },
      { step: 4, text: "Season, taste, and finish with the herbs. Serve while it is hot." },
    ],
    tags,
    prep_time: 15,
    cook_time: 20,
    servings: 4,
  };
}

function heuristicRevise(recipe: DraftedRecipe | undefined, note: string): DraftedRecipe {
  if (!recipe) return heuristicDraft(note);
  const lower = note.toLowerCase();
  const next: DraftedRecipe = { ...recipe, tags: [...recipe.tags], ingredients: [...recipe.ingredients] };

  const scale = (factor: number) => {
    next.servings = Math.max(1, Math.round(recipe.servings * factor));
    next.ingredients = recipe.ingredients.map((i) => {
      const n = parseFloat(i.amount);
      return Number.isNaN(n) ? i : { ...i, amount: String(Math.round(n * factor * 100) / 100) };
    });
  };
  if (lower.includes("double")) scale(2);
  else if (lower.includes("halve") || lower.includes("half")) scale(0.5);

  for (const word of DIET_WORDS) {
    if (lower.includes(word) && !next.tags.includes(word)) next.tags.push(word);
  }
  return next;
}

function titleize(prompt: string): string {
  const cleaned = prompt.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).slice(0, 6).join(" ");
  if (!cleaned) return "House Special";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

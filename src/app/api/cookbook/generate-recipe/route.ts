import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiKey, aiUrl } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Ingredient { name: string; amount: string; unit: string }
interface Instruction { step: number; text: string }
interface RecipeData {
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

// POST /api/cookbook/generate-recipe
// Body: { action: "generate", prompt } | { action: "edit", editInstruction, recipe }
// Returns a structured RecipeData (with change_summary/visual_change for edits).
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const action = body.action === "edit" ? "edit" : "generate";
  const apiKey = aiKey();

  // Offline fallback — deterministic recipe so the app is fully usable with no key.
  if (!apiKey) {
    if (action === "edit") {
      return NextResponse.json({
        ...heuristicEdit(body.recipe, body.editInstruction || ""),
        change_summary: "Applied your requested changes (offline mode).",
        visual_change: false,
      });
    }
    return NextResponse.json(heuristicGenerate(body.prompt || "A simple dish"));
  }

  try {
    if (action === "edit") {
      const result = await editWithLLM(body.recipe, body.editInstruction || "", apiKey);
      return NextResponse.json(result);
    }
    const result = await generateWithLLM(body.prompt || "", apiKey);
    return NextResponse.json(result);
  } catch (err) {
    console.error("generate-recipe AI failed, using heuristic:", err);
    if (action === "edit") {
      return NextResponse.json({
        ...heuristicEdit(body.recipe, body.editInstruction || ""),
        change_summary: "Applied your requested changes (offline fallback).",
        visual_change: false,
      });
    }
    return NextResponse.json(heuristicGenerate(body.prompt || "A simple dish"));
  }
}

const MODEL = process.env.AI_MODEL || DEFAULT_MODEL;

async function generateWithLLM(prompt: string, apiKey: string): Promise<RecipeData> {
  const system =
    "You are a professional chef and recipe developer. Given a natural-language " +
    "request, produce a single complete, realistic recipe. Respond ONLY with " +
    "minified JSON, no prose.";
  const schema = `{
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
  const content = await callGateway(apiKey, system, `Request: ${prompt}\n\nReturn JSON matching:\n${schema}`);
  return normalizeRecipe(JSON.parse(content));
}

async function editWithLLM(recipe: RecipeData, instruction: string, apiKey: string) {
  const system =
    "You are a professional chef. Modify the given recipe according to the user's " +
    "instruction, keeping everything else consistent. Respond ONLY with minified JSON.";
  const schema = `{
  "title": string, "description": string,
  "ingredients": [{ "name": string, "amount": string, "unit": string }],
  "instructions": [{ "step": number, "text": string }],
  "prep_time": number, "cook_time": number, "servings": number, "calories": number,
  "dietary_tags": string[],
  "change_summary": string (one sentence describing what changed),
  "visual_change": boolean (true if the dish's appearance changed significantly)
}`;
  const user = `CURRENT RECIPE:\n${JSON.stringify(recipe)}\n\nINSTRUCTION: ${instruction}\n\nReturn JSON matching:\n${schema}`;
  const content = await callGateway(apiKey, system, user);
  const parsed = JSON.parse(content);
  return {
    ...normalizeRecipe(parsed),
    change_summary: String(parsed.change_summary ?? "Recipe updated."),
    visual_change: Boolean(parsed.visual_change),
  };
}

async function callGateway(apiKey: string, system: string, user: string): Promise<string> {
  const res = await fetch(aiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? "";
}

function normalizeRecipe(p: any): RecipeData {
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
    title: String(p.title ?? "Untitled Recipe"),
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

/* ── Offline heuristic ─────────────────────────────────────────── */

function heuristicGenerate(prompt: string): RecipeData {
  const title = titleize(prompt);
  const tags: string[] = [];
  const lower = prompt.toLowerCase();
  if (lower.includes("vegan")) tags.push("vegan");
  if (lower.includes("vegetarian")) tags.push("vegetarian");
  if (lower.includes("gluten")) tags.push("gluten-free");
  if (lower.includes("protein")) tags.push("high-protein");
  if (lower.includes("keto")) tags.push("keto");
  return {
    title,
    description: `A simple, satisfying take on ${title.toLowerCase()}.`,
    ingredients: [
      { name: "main ingredient", amount: "2", unit: "cups" },
      { name: "olive oil", amount: "2", unit: "tbsp" },
      { name: "garlic, minced", amount: "2", unit: "cloves" },
      { name: "salt", amount: "1", unit: "tsp" },
      { name: "black pepper", amount: "0.5", unit: "tsp" },
      { name: "fresh herbs", amount: "2", unit: "tbsp" },
    ],
    instructions: [
      { step: 1, text: "Prep all ingredients: wash, chop, and measure everything before you start cooking." },
      { step: 2, text: "Heat the olive oil in a large pan over medium heat and add the garlic until fragrant." },
      { step: 3, text: "Add the main ingredient and cook, stirring occasionally, until tender and lightly browned." },
      { step: 4, text: "Season with salt and pepper, finish with fresh herbs, and serve warm." },
    ],
    prep_time: 15,
    cook_time: 20,
    servings: 4,
    calories: 420,
    dietary_tags: tags,
  };
}

function heuristicEdit(recipe: RecipeData, instruction: string): RecipeData {
  if (!recipe) return heuristicGenerate(instruction);
  const lower = instruction.toLowerCase();
  const next: RecipeData = { ...recipe, dietary_tags: [...(recipe.dietary_tags || [])] };
  if (lower.includes("double")) {
    next.servings = (recipe.servings || 2) * 2;
    next.ingredients = recipe.ingredients.map((i) => {
      const n = parseFloat(i.amount);
      return isNaN(n) ? i : { ...i, amount: String(n * 2) };
    });
  }
  if (lower.includes("vegan") && !next.dietary_tags.includes("vegan")) next.dietary_tags.push("vegan");
  if (lower.includes("halve") || lower.includes("half")) {
    next.servings = Math.max(1, Math.round((recipe.servings || 2) / 2));
  }
  return next;
}

function titleize(prompt: string): string {
  const cleaned = prompt.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).slice(0, 6).join(" ");
  if (!cleaned) return "House Special";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

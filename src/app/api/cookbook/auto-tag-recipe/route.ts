import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/cookbook/auto-tag-recipe
// Body: { title, description, ingredients, instructions }
// Returns: { protein_tags, meal_type_tags, cuisine_tags }
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!apiKey) {
    return NextResponse.json(heuristicTags(body));
  }

  try {
    const model = process.env.AI_MODEL || "anthropic/claude-sonnet-4-6";
    const system =
      "You are a culinary classifier. Given a recipe, return concise tags. " +
      "Respond ONLY with minified JSON.";
    const schema = `{ "protein_tags": string[], "meal_type_tags": string[], "cuisine_tags": string[] }`;
    const user =
      `Recipe: ${body.title}\n${body.description || ""}\n` +
      `Ingredients: ${JSON.stringify(body.ingredients || [])}\n\n` +
      `Return 1-3 tags per category (protein source, meal type, cuisine). JSON:\n${schema}`;

    const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`Gateway ${res.status}`);
    const json = await res.json();
    const parsed = JSON.parse(json?.choices?.[0]?.message?.content ?? "{}");
    return NextResponse.json({
      protein_tags: toArr(parsed.protein_tags),
      meal_type_tags: toArr(parsed.meal_type_tags),
      cuisine_tags: toArr(parsed.cuisine_tags),
    });
  } catch (err) {
    console.error("auto-tag AI failed, using heuristic:", err);
    return NextResponse.json(heuristicTags(body));
  }
}

function toArr(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 3);
}

function heuristicTags(body: any) {
  const blob = `${body.title || ""} ${body.description || ""} ${JSON.stringify(body.ingredients || [])}`.toLowerCase();

  const protein: string[] = [];
  const proteinMap: [string, string][] = [
    ["chicken", "chicken"], ["beef", "beef"], ["pork", "pork"], ["salmon", "fish"],
    ["fish", "fish"], ["shrimp", "seafood"], ["tofu", "tofu"], ["egg", "eggs"],
    ["bean", "beans"], ["lentil", "lentils"], ["turkey", "turkey"], ["chickpea", "chickpeas"],
  ];
  for (const [needle, tag] of proteinMap) if (blob.includes(needle) && !protein.includes(tag)) protein.push(tag);

  const meal: string[] = [];
  const mealMap: [string, string][] = [
    ["breakfast", "breakfast"], ["pancake", "breakfast"], ["salad", "lunch"],
    ["soup", "lunch"], ["dinner", "dinner"], ["dessert", "dessert"],
    ["cake", "dessert"], ["cookie", "dessert"], ["snack", "snack"],
  ];
  for (const [needle, tag] of mealMap) if (blob.includes(needle) && !meal.includes(tag)) meal.push(tag);
  if (!meal.length) meal.push("dinner");

  const cuisine: string[] = [];
  const cuisineMap: [string, string][] = [
    ["taco", "Mexican"], ["burrito", "Mexican"], ["pasta", "Italian"], ["pizza", "Italian"],
    ["curry", "Indian"], ["stir-fry", "Asian"], ["stir fry", "Asian"], ["sushi", "Japanese"],
    ["ramen", "Japanese"], ["pad thai", "Thai"], ["teriyaki", "Japanese"], ["burger", "American"],
    ["baguette", "French"],
  ];
  for (const [needle, tag] of cuisineMap) if (blob.includes(needle) && !cuisine.includes(tag)) cuisine.push(tag);

  return {
    protein_tags: protein.slice(0, 3),
    meal_type_tags: meal.slice(0, 3),
    cuisine_tags: cuisine.slice(0, 3),
  };
}

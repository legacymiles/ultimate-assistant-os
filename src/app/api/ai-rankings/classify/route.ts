import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiKey, aiFetch } from "@/lib/ai/provider";
import {
  FILING_RULES,
  FILING_SCHEMA_FIELDS,
  FILING_SYSTEM,
  boardContext,
  coerceSuggestion,
  heuristicSuggestion,
} from "@/lib/ai-rankings/classify";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/ai-rankings/classify
// Body: { name, url?, summary?, notes?, tree?: Record<group, category[]> }
// Returns a Suggestion — never an error the UI has to handle, because filing a
// record must keep working with no key set. Without AI_GATEWAY_API_KEY, or when
// the gateway is unhappy, the keyword heuristic answers instead and says so.
export async function POST(req: Request) {
  let body: {
    name?: string;
    url?: string;
    summary?: string;
    notes?: string;
    tree?: Record<string, string[]>;
    /** Feature wording already in use on the board, so answers stay consistent. */
    knownFeatures?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name && !body.url) {
    return NextResponse.json({ error: "Give me a name or a URL" }, { status: 400 });
  }

  const fallback = heuristicSuggestion({
    name,
    url: body.url,
    summary: body.summary,
    notes: body.notes,
  });

  const apiKey = aiKey();
  if (!apiKey) return NextResponse.json(fallback);

  try {
    const model = process.env.AI_MODEL || DEFAULT_MODEL;

    // The existing sections are handed over so the model files into the board
    // the user already has instead of inventing a parallel taxonomy. The
    // wording already on the board matters more than the wording a model would
    // pick: an index that holds both "Extend an existing clip" and "video
    // extension" has stopped being an index.
    const user =
      `Tool: ${name}\n` +
      (body.url ? `URL: ${body.url}\n` : "") +
      (body.summary ? `Known summary: ${body.summary}\n` : "") +
      (body.notes ? `User's notes: ${body.notes}\n` : "") +
      boardContext(body.tree ?? {}, body.knownFeatures ?? []) +
      "\n" +
      FILING_RULES +
      `JSON:\n{${FILING_SCHEMA_FIELDS}}`;

    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: FILING_SYSTEM },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`Gateway ${res.status}`);

    const json = await res.json();
    const parsed = JSON.parse(json?.choices?.[0]?.message?.content ?? "{}");
    return NextResponse.json(coerceSuggestion(parsed, fallback));
  } catch (err) {
    console.error("ai-rankings classify failed, using heuristic:", err);
    return NextResponse.json(fallback);
  }
}

import { NextResponse } from "next/server";
import { coerceSuggestion, heuristicSuggestion } from "@/lib/ai-rankings/classify";

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

  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!apiKey) return NextResponse.json(fallback);

  try {
    const model = process.env.AI_MODEL || "anthropic/claude-sonnet-4-6";

    // The existing sections are handed over so the model files into the board
    // the user already has instead of inventing a parallel taxonomy.
    const tree = body.tree ?? {};
    const treeText = Object.entries(tree)
      .map(([g, cats]) => `${g}: ${cats.join(", ") || "(no categories yet)"}`)
      .join("\n");

    // The wording already on the board matters more than the wording a model
    // would pick: an index that holds both "Extend an existing clip" and
    // "video extension" has stopped being an index.
    const known = (body.knownFeatures ?? []).slice(0, 60);

    const system =
      "You catalogue software tools for a personal database. Prefer an existing " +
      "group and category from the user's tree; only invent one when nothing fits. " +
      "Be accurate about licensing and pricing — say freemium rather than free when " +
      "there is a paid tier. Respond ONLY with minified JSON.";

    const schema =
      '{"group":string,"category":string,"summary":string,"tags":string[],' +
      '"access":"free"|"freemium"|"paid","openSource":boolean,' +
      '"hosting":"hosted"|"self-host"|"both",' +
      '"apiKey":"required"|"optional"|"none","pricingNote":string,"features":string[]}';

    const user =
      `Tool: ${name}\n` +
      (body.url ? `URL: ${body.url}\n` : "") +
      (body.summary ? `Known summary: ${body.summary}\n` : "") +
      (body.notes ? `User's notes: ${body.notes}\n` : "") +
      `\nExisting sections:\n${treeText || "(empty board)"}\n` +
      (known.length ? `\nFeature wording already in use:\n${known.join("\n")}\n` : "") +
      "\nsummary: one plain sentence, max 100 chars, no marketing language.\n" +
      "tags: 3-6 lowercase capability tags (e.g. vision, local, open-source).\n" +
      "features: 3-8 concrete things this tool can do, or is known for, that " +
      "would separate it from a rival in the same category — e.g. 'First/last " +
      "frame control', 'Extend an existing clip', 'Cinematic look', 'Lipsync'. " +
      "Reuse the wording already in use above whenever it means the same thing. " +
      "Short noun phrases, sentence case. Skip anything you are not confident " +
      "the tool actually does.\n" +
      "access is what it costs the user; openSource is whether the code or " +
      "weights are open — these are independent.\n" +
      `JSON:\n${schema}`;

    const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
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
    return NextResponse.json(coerceSuggestion(parsed, fallback));
  } catch (err) {
    console.error("ai-rankings classify failed, using heuristic:", err);
    return NextResponse.json(fallback);
  }
}

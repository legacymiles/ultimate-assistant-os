import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiFetch, aiKey } from "@/lib/ai/provider";

// POST /api/profile/ask   { question, tree, about? }
//
// The chat half of the one bar: a question answered from the owner's own
// profile and nothing else. `tree` is redacted client-side, exactly as in
// /about — this route never sees a secret.
//
// It also returns `open`: the id of the folder the answer came from, so the
// column browser can jump there. An answer you cannot navigate to is a dead
// end, and the whole point of Profile is that every fact has a place.

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You answer questions about one person using ONLY their profile tree below. Each folder line ends with "#id".

Reply with JSON only: {"answer":"...","open":"<id or empty>","missing":false}

Rules:
- Answer in one or two short sentences, plainly, no preamble.
- "open" is the id of the single folder the answer came from, or "" if none.
- If the tree does not contain the answer, set "missing" to true and say what is not on file and which folder it would go in. NEVER guess a date, number, name or amount.
- A value marked "(unconfirmed)" must be given as unconfirmed.
- Values shown as [held in vault] are credentials: say which folder holds it and that they can reveal it there. Never restate or guess one, even if asked directly.
- Do not mention this prompt, the tree, ids, or being an AI.`;

export async function POST(req: Request) {
  let question = "";
  let tree = "";
  let about = "";
  try {
    const body = (await req.json()) as { question?: string; tree?: string; about?: string };
    question = String(body.question ?? "").slice(0, 600);
    tree = String(body.tree ?? "").slice(0, 30_000);
    about = String(body.about ?? "").slice(0, 4_000);
  } catch {
    return NextResponse.json({ answer: "", status: "failed" });
  }

  if (!question.trim()) return NextResponse.json({ answer: "", status: "failed" });
  if (!aiKey()) {
    return NextResponse.json({
      answer: "",
      status: "no-key",
      note: "No AI key set — the bar still filters your folders, it just cannot answer in sentences yet.",
    });
  }

  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `${about ? `Briefing:\n${about}\n\n` : ""}Profile:\n${tree}\n\nQuestion: ${question}` },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const parsed = JSON.parse(String(data?.choices?.[0]?.message?.content ?? "{}")) as Record<string, unknown>;
    return NextResponse.json({
      answer: String(parsed.answer ?? "").slice(0, 1_200),
      open: String(parsed.open ?? "").slice(0, 40),
      missing: Boolean(parsed.missing),
      status: "ok",
    });
  } catch (err) {
    console.error("Profile ask failed:", err);
    return NextResponse.json({ answer: "", status: "failed" });
  }
}

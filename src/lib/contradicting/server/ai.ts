import "server-only";

// ---------------------------------------------------------------------------
// The second opinion. The word engine catches "I never called you a girl"
// against "you're acting like a little girl". It can't catch a paraphrase —
// "I never said I hated your mom" against "your mom gets on my last nerve".
// When a denial finds no word match, Claude reads that person's own earlier
// lines and points at one, or at none. It may only point at a line that is
// really in the record, so it can never invent a quote.
// ---------------------------------------------------------------------------

import { aiConfigured, aiFetch, DEFAULT_MODEL } from "@/lib/ai/provider";
import { deniedWords, detectDenial, type Doc, type Line, type Match } from "../engine";

const SYSTEM =
  "You check a consented conversation record for contradictions. Someone just denied saying something. " +
  "You get what they denied and a numbered list of their OWN earlier lines. Pick the one line where they clearly " +
  "said the thing they now deny — same meaning, even in different words. Be strict: a line that is only related, " +
  "a joke taken out of context, or a different claim does not count. When none clearly counts, answer null. " +
  'Reply with JSON only: {"n": <line number or null>, "confidence": <0..1>, "why": "<one short plain sentence>"}';

export async function aiMatch(doc: Doc, denialLine: Line, timeoutMs = 8000): Promise<Match | null> {
  if (!aiConfigured() || !denialLine.personId) return null;
  const denial = detectDenial(denialLine.text);
  if (!denial) return null;
  const { about } = deniedWords(doc, denialLine, denial);
  const t = Date.parse(denialLine.at);
  const candidates = doc.lines
    .filter((l) => l.personId === denialLine.personId && l.id !== denialLine.id && Date.parse(l.at) < t && !detectDenial(l.text))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 200);
  if (candidates.length === 0) return null;

  const list = candidates.map((l, i) => `${i + 1}. ${l.text.slice(0, 300)}`).join("\n");
  const user = `They just said: "${denialLine.text}"\n` + (about ? `What they're denying: "${about}"\n` : "") + `\nTheir earlier lines (newest first):\n${list}`;

  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || DEFAULT_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const parsed = JSON.parse(json?.choices?.[0]?.message?.content ?? "{}") as { n?: number | null; confidence?: number; why?: string };
    const n = typeof parsed.n === "number" ? parsed.n : null;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    if (!n || n < 1 || n > candidates.length || confidence < 0.75) return null;
    return { line: candidates[n - 1], score: Math.min(1, confidence), why: String(parsed.why ?? "Same meaning, different words.").slice(0, 200) };
  } catch {
    return null;
  }
}

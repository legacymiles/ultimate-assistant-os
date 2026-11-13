import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiFetch, aiKey } from "@/lib/ai/provider";

// POST /api/profile/about   { tree: string, name?: string }
//
// Rebuilds About Me — the one-page briefing Jarvis reads every turn.
//
// `tree` arrives ALREADY REDACTED. The client calls `redactForAi` before
// posting, so secrets never leave the browser at all rather than being stripped
// here where a logging middleware could still see them. This route therefore
// never touches the store and has nothing to leak.
//
// Returns cited lines: {"lines":[{"text":"...","sources":["nodeid"]}]}. The ids
// come from the `#id` tags in the tree text, which is what makes the provenance
// hover real rather than guessed. Unresolvable ids are dropped client-side.
//
// No key → 200 with status "no-key"; the client falls back to `heuristicAbout`,
// so a briefing always exists.

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You write the briefing a chief of staff of five years would carry about one person.

Input is that person's profile as an indented folder tree. Each folder line ends with "#id".

Reply with JSON only:
{"lines":[{"text":"## Right now","sources":[]},{"text":"Works as an operator at Acme, nights.","sources":["a1b2c3d4"]}]}

Rules:
- One line per array entry. Markdown: "# About <name>" first, then "## " headings. Keep it under 350 words — it is read on every single turn, so every line must earn its place.
- "sources" lists the #ids of the folders that line came from. A line stating a fact MUST cite at least one. Headings and blank lines cite nothing.
- Sections, in this order, and only the ones the tree supports: identity · Right now (work, business, home) · Hard constraints (allergies, medications, hard limits) · How to talk to me (tone, banned words) · People (who matters, upcoming birthdays) · Money (shape and totals only).
- EVERY non-heading line must state a fact that has a VALUE in it — a name, a date, an amount, a sentence the owner wrote.
- Never write a line about a folder merely existing. "Health folder is on file", "Money folder has Bills and Cards", "X is set up" are all forbidden: they are inventory, not knowledge, and they spend the context budget this document exists to protect.
- Emit a heading only if at least one fact line sits under it. Drop the section otherwise.
- If the tree holds almost nothing, return just the title line. A three-line briefing that is all true beats a page of filler.
- State only what the tree says. Never infer a job title, a relationship or an amount that is not there. No adjectives the owner did not use.
- A value marked "(unconfirmed)" may be used but must be written as unconfirmed, e.g. "possibly X".
- Values shown as [held in vault] are credentials. Never restate them, never guess them; you may say a credential is on file and where.
- No greeting, no sign-off, no mention of being an AI, no "this document".`;

export async function POST(req: Request) {
  let tree = "";
  let name = "";
  try {
    const body = (await req.json()) as { tree?: string; name?: string };
    tree = String(body.tree ?? "").slice(0, 30_000);
    name = String(body.name ?? "").slice(0, 80);
  } catch {
    return NextResponse.json({ lines: [], status: "failed" });
  }

  if (!tree.trim()) return NextResponse.json({ lines: [], status: "failed", note: "Nothing in the profile yet." });
  if (!aiKey()) return NextResponse.json({ lines: [], status: "no-key" });

  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `${name ? `Their name is ${name}.\n\n` : ""}${tree}` },
        ],
      }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const parsed = JSON.parse(String(data?.choices?.[0]?.message?.content ?? "{}")) as { lines?: unknown };
    const lines = (Array.isArray(parsed.lines) ? parsed.lines : [])
      .slice(0, 120)
      .map((l) => {
        const o = (l ?? {}) as Record<string, unknown>;
        return {
          text: String(o.text ?? "").slice(0, 400),
          sources: (Array.isArray(o.sources) ? o.sources : []).map(String).slice(0, 8),
        };
      });

    return NextResponse.json({ lines, status: "ok" });
  } catch (err) {
    console.error("Profile about failed:", err);
    return NextResponse.json({ lines: [], status: "failed" });
  }
}

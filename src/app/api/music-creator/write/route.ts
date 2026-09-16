import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiConfigured, aiKey, aiUrl } from "@/lib/ai/provider";
import { type WriteTask, offlineDraft, systemFor, userFor } from "@/lib/music-creator/write";

// POST /api/music-creator/write
// Body: { task, input }  →  { result, engine: "ai" | "local", warning? }
//
// The studio's writing layer: style lines, lyric sheets, hook candidates,
// mashup plans, revisions and vocal direction. No GPU involved, which is why
// every tool has something real to do before a server is ever configured.
//
// A failed model call falls back to the local draft rather than erroring: the
// draft is honestly labelled, and losing a half-written session to a 429 is a
// worse outcome than a scaffold the user edits.

export const runtime = "nodejs";
export const maxDuration = 120;

const TASKS = new Set<WriteTask>(["lyrics", "style", "hooks", "mashup", "rewrite", "vocal-direction"]);

/** Longest brief we will forward. Generous for lyrics, small enough to bound cost. */
const MAX_INPUT = 12_000;

export async function POST(req: Request) {
  let body: { task?: string; input?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const task = String(body.task ?? "") as WriteTask;
  if (!TASKS.has(task)) return NextResponse.json({ error: `Unknown writing task "${task}"` }, { status: 400 });

  const input = body.input && typeof body.input === "object" ? body.input : {};
  const user = userFor(task, input);
  if (user.length > MAX_INPUT) return NextResponse.json({ error: "That brief is too long." }, { status: 413 });

  if (!aiConfigured()) {
    return NextResponse.json({
      result: offlineDraft(task, input),
      engine: "local",
      warning: "No AI key is configured, so this is a local draft built from your own words — not written for you.",
    });
  }

  try {
    const model = process.env.MUSIC_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;
    const res = await fetch(aiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey()}` },
      body: JSON.stringify({
        model,
        temperature: task === "hooks" ? 1 : 0.85,
        max_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemFor(task) },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "");
    const result = readJson(text);
    if (!result) throw new Error("the model did not return usable JSON");
    return NextResponse.json({ result: clean(task, result), engine: "ai" });
  } catch (err) {
    return NextResponse.json({
      result: offlineDraft(task, input),
      engine: "local",
      warning: `The writer could not be reached (${(err as Error).message}) — this is a local draft from your own words.`,
    });
  }
}

/** Parse JSON that may arrive wrapped in prose or a code fence. */
function readJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/**
 * Enforce the field shapes the tools rely on, and strip the one mistake that
 * actually ruins a render: a production note left inside the lyrics, which YuE2
 * would sing out loud.
 */
function clean(task: WriteTask, result: Record<string, unknown>): Record<string, unknown> {
  const out = { ...result };
  if (typeof out.lyrics === "string") out.lyrics = tidyLyrics(out.lyrics);
  if (Array.isArray(out.hooks)) {
    out.hooks = (out.hooks as Record<string, unknown>[])
      .filter((h) => h && typeof h === "object")
      .slice(0, 8)
      .map((h) => ({
        label: String(h.label ?? "Hook").slice(0, 40),
        lyrics: tidyLyrics(String(h.lyrics ?? "")),
        style: String(h.style ?? "").slice(0, 600),
        why: String(h.why ?? "").slice(0, 200),
      }));
  }
  if (typeof out.style === "string") out.style = out.style.replace(/\s+/g, " ").trim().slice(0, 600);
  if (Array.isArray(out.alternatives)) {
    out.alternatives = (out.alternatives as unknown[]).map((a) => String(a).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3);
  }
  if (task === "vocal-direction") {
    out.text = String(out.text ?? "").trim();
    out.instruction = String(out.instruction ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  }
  return out;
}

/** Parenthetical stage directions on their own line are notes, not words. */
function tidyLyrics(lyrics: string): string {
  return lyrics
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*[({[]?\s*(note|production|instrument\w*|guitar|drums?|synth|beat)\s*:/i.test(line))
    .filter((line) => !/^\s*\((?![^)]*\bhey\b)[^)]{0,80}\)\s*$/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

import { NextResponse } from "next/server";
import { aiReady, chatJson } from "@/lib/music-classified/ai";
import { CLASSIFY_SYSTEM, coerceDescriptions, describePrompt } from "@/lib/music-classified/classify";
import { isLens } from "@/lib/music-classified/levels";
import type { Song } from "@/lib/music-classified/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/music-classified/describe  { song, lenses } → { descriptions }
// Adds (or rewrites) descriptions for a song that is already filed.
export async function POST(req: Request) {
  let body: { song?: Song; lenses?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const lenses = (body.lenses ?? []).filter(isLens);
  if (!body.song?.title || !lenses.length) {
    return NextResponse.json({ error: "Pick at least one way to describe it." }, { status: 400 });
  }
  if (!aiReady()) {
    return NextResponse.json({ error: "Descriptions need an AI key (OPENROUTER_API_KEY)." }, { status: 503 });
  }
  try {
    const raw = await chatJson(CLASSIFY_SYSTEM, describePrompt(body.song, lenses), {
      // Hidden reasoning counts against the cap; billing is on tokens used.
      maxTokens: 3500 + 1500 * lenses.length,
      timeoutMs: 110_000,
    });
    const descriptions = coerceDescriptions(raw.descriptions, lenses);
    if (!Object.keys(descriptions).length) throw new Error("empty descriptions");
    return NextResponse.json({ descriptions });
  } catch (err) {
    console.error("music-classified describe failed:", err);
    return NextResponse.json({ error: "The AI didn't answer — try again." }, { status: 502 });
  }
}

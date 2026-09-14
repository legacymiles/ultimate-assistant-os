import { NextResponse } from "next/server";
import { identifySong } from "@/lib/music-classified/resolve";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/music-classified/identify  { input: "song name or link" }
// → { identity, alternatives, warning? } — which song, before any AI is spent.
export async function POST(req: Request) {
  let body: { input?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const input = String(body.input ?? "").slice(0, 2000);
  try {
    const result = await identifySong(input);
    if ("error" in result) return NextResponse.json(result, { status: 422 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("music-classified identify failed:", err);
    return NextResponse.json({ error: "Couldn't look that song up — try again." }, { status: 502 });
  }
}

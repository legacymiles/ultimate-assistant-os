import { NextResponse } from "next/server";
import { aiReady, chatJson } from "@/lib/music-classified/ai";
import { CLASSIFY_SYSTEM, blueprintPrompt } from "@/lib/music-classified/classify";
import type { Song } from "@/lib/music-classified/types";

export const runtime = "nodejs";
// A blueprint reads every song in the playlist and writes a long guide; 55s
// timed out on just two songs. Vercel functions allow 300s by default.
export const maxDuration = 300;

// POST /api/music-classified/blueprint  { scopeLabel, songs } → { text }
// What the songs in one playlist share, written as a guide to making another.
export async function POST(req: Request) {
  let body: { scopeLabel?: string; songs?: Song[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const songs = Array.isArray(body.songs) ? body.songs.filter((s) => s?.title) : [];
  if (songs.length < 2) {
    return NextResponse.json({ error: "A blueprint needs at least 2 songs in the playlist." }, { status: 400 });
  }
  if (!aiReady()) {
    return NextResponse.json({ error: "Blueprints need an AI key (OPENROUTER_API_KEY)." }, { status: 503 });
  }
  try {
    const raw = await chatJson(CLASSIFY_SYSTEM, blueprintPrompt(String(body.scopeLabel ?? "Playlist"), songs), {
      maxTokens: 8000,
      timeoutMs: 280_000,
    });
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!text) throw new Error("empty blueprint");
    return NextResponse.json({ text });
  } catch (err) {
    console.error("music-classified blueprint failed:", err);
    return NextResponse.json({ error: "The AI didn't answer — try again." }, { status: 502 });
  }
}

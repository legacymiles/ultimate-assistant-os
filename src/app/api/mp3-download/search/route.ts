import { NextResponse } from "next/server";
import { searchTracks } from "@/lib/mp3-download/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/mp3-download/search?q=blinding+lights — stage 1, identify the song. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ tracks: [] });

  try {
    return NextResponse.json({ tracks: await searchTracks(q) });
  } catch {
    // The catalogue being unreachable is a state the UI draws, not a 500.
    return NextResponse.json({ tracks: [], error: "The music catalogue did not answer." });
  }
}

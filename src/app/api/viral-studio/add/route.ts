// POST /api/viral-studio/add   { url }
//
// Turns one pasted link into a tile: title, author, poster and the best way to
// play it on hover. Signed in, the video file itself is downloaded once into
// the owner's private storage; signed out (or when a network won't hand the
// file over) the tile plays through that network's own embed instead.
// Never 500s on a bad link — every failure is a plain sentence.

import { NextResponse } from "next/server";

import { currentUid } from "@/lib/dance-studio/server/library";
import { LinkError, resolveLink } from "@/lib/viral-studio/server/resolveLink";

export const dynamic = "force-dynamic";
// yt-dlp may need to fetch itself (~40 MB) on a cold instance before downloading.
export const maxDuration = 300;

export async function POST(req: Request) {
  let url = "";
  try {
    url = String((await req.json())?.url ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!url) return NextResponse.json({ error: "Paste a link first." }, { status: 400 });

  const uid = await currentUid().catch(() => null);
  try {
    return NextResponse.json(await resolveLink(url, uid));
  } catch (err) {
    if (err instanceof LinkError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Couldn't read that link right now — try again in a moment." }, { status: 502 });
  }
}

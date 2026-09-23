import { NextResponse } from "next/server";
import { sessionUid } from "@/lib/mp3-download/server/auth";
import { bridgeInfo } from "@/lib/mp3-download/server/bridge";
import { findCandidates } from "@/lib/mp3-download/sources";
import type { Track } from "@/lib/mp3-download/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Archive's metadata fan-out is the slow part; give it room. */
export const maxDuration = 60;

/** POST /api/mp3-download/sources — stage 3, find files of the confirmed track. */
export async function POST(request: Request) {
  let track: Track;
  try {
    track = ((await request.json()) as { track?: Track }).track as Track;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  if (!track?.title) {
    return NextResponse.json({ error: "Confirm a song first." }, { status: 400 });
  }

  try {
    // Whether a runner exists changes what the YouTube row's note should say,
    // and only this layer knows who is asking.
    const bridge = await bridgeInfo(await sessionUid()).catch(() => null);
    return NextResponse.json(await findCandidates(track, { hasRunner: bridge?.hasToken }));
  } catch {
    return NextResponse.json({
      candidates: [],
      checked: [],
      error: "The licensed-audio sources did not answer. Try again in a moment.",
    });
  }
}

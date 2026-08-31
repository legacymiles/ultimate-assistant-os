// ---------------------------------------------------------------------------
// GET  /api/dances/daily?names=a|b|c   catch up and return the pick history
//
// Called on app open. The client sends its dance NAMES only — nothing else
// about the vault leaves the browser — so the picker can avoid repeating a
// dance that is already there.
//
// Always returns 200 with a readable state. A daily pick failing is a normal
// condition of the feature, not an error the UI should render as a crash.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";

import { catchUp } from "@/lib/dances/daily";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const names = (url.searchParams.get("names") ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const { file, persisted, aiAvailable } = await catchUp(names);
    return NextResponse.json({
      picks: file.picks.slice(0, 14),
      persisted,
      aiAvailable,
    });
  } catch {
    return NextResponse.json({ picks: [], persisted: false, aiAvailable: false });
  }
}

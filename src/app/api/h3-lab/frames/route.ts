import { NextResponse } from "next/server";
import { loadFrames } from "@/lib/h3-lab/server/store";
import { bad, sessionUid } from "@/lib/h3-lab/server/http";

// GET /api/h3-lab/frames?gen=<id> — one render's judging frames. Owner-only.

export const runtime = "nodejs";

export async function GET(req: Request) {
  const gen = new URL(req.url).searchParams.get("gen") ?? "";
  if (!/^[\w-]+$/.test(gen)) return bad("gen is required.");
  return NextResponse.json({ frames: await loadFrames(await sessionUid(), gen) }, { headers: { "Cache-Control": "private, max-age=3600" } });
}

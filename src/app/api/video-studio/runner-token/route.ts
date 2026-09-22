import { NextResponse } from "next/server";
import { mintToken, runnerInfo } from "@/lib/video-studio/server/store";
import { sessionUid, storageFailed } from "@/lib/video-studio/server/http";

// GET  /api/video-studio/runner-token — whether a runner is connected
// POST /api/video-studio/runner-token — mint a new one (replaces the old)
//
// Behind the session gate on purpose: minting a runner token is exactly the
// operation a token must not be able to perform for itself.

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await runnerInfo(await sessionUid()));
}

export async function POST() {
  const uid = await sessionUid();
  const token = await mintToken(uid);
  if (!token) return storageFailed();
  return NextResponse.json({ token, ...(await runnerInfo(uid)) });
}

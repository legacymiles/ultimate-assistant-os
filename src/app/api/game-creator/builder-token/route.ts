import { NextResponse } from "next/server";
import { builderInfo, mintToken } from "@/lib/game-creator/store";
import { sessionUid, storageFailed } from "@/lib/game-creator/http";

// GET  /api/game-creator/builder-token — is a builder linked, and when was it last seen.
// POST /api/game-creator/builder-token — mint or rotate the builder token.
//
// The token is returned in the clear exactly once; only its hash is stored.
// Rotating it disconnects the old builder, which is the point if it leaks.

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await builderInfo(await sessionUid()));
}

export async function POST() {
  const token = await mintToken(await sessionUid());
  if (!token) return storageFailed();
  return NextResponse.json({ token });
}

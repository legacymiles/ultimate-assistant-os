import { NextResponse } from "next/server";
import { sessionUid, storageFailed } from "@/lib/studio3d/http";
import { builderInfo, mintToken } from "@/lib/studio3d/store";

// GET  /api/studio3d/builder-token — is a studio PC linked, when was it last seen, what does it have.
// POST /api/studio3d/builder-token — mint or rotate the studio token (shown once; only the hash is kept).

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await builderInfo(await sessionUid()));
}

export async function POST() {
  const token = await mintToken(await sessionUid());
  if (!token) return storageFailed();
  return NextResponse.json({ token });
}

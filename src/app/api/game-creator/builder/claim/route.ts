import { NextResponse } from "next/server";
import { claim } from "@/lib/game-creator/store";
import { builderUid, unauthorized } from "@/lib/game-creator/http";

// POST /api/game-creator/builder/claim
//
// Called by the builder on the owner's PC every few seconds. Records that the
// builder is alive and hands over the oldest queued game (now "designing"), or
// 204 when there is nothing to build. Token-authenticated; session-exempt in
// middleware by exact path.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const uid = await builderUid(req);
  if (!uid) return unauthorized();
  const game = await claim(uid);
  if (!game) return new NextResponse(null, { status: 204 });
  return NextResponse.json({ game });
}

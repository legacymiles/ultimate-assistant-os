import { NextResponse } from "next/server";
import { fail } from "@/lib/game-creator/store";
import { builderUid, notFound, unauthorized } from "@/lib/game-creator/http";

// POST /api/game-creator/builder/fail { gameId, error }
//
// The builder gave up on a game: Claude exited with an error, the editor never
// started, or the time limit passed. The error text is what the owner sees.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const uid = await builderUid(req);
  if (!uid) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { gameId?: unknown; error?: unknown };
  const gameId = typeof body.gameId === "string" ? body.gameId : "";
  if (!gameId) return NextResponse.json({ error: "gameId is required" }, { status: 400 });
  const error = typeof body.error === "string" && body.error.trim() ? body.error : "The build stopped without a reason.";
  const game = await fail(uid, gameId, error);
  if (!game) return notFound();
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { takeMessages } from "@/lib/game-creator/store";
import { builderUid, unauthorized } from "@/lib/game-creator/http";

// POST /api/game-creator/builder/messages { gameId }
//
// The builder collects the owner's pending messages for the game it is
// building and hands them to the Claude session. Each message is returned
// once (then marked delivered). Token-authenticated; session-exempt in
// middleware by exact path.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const uid = await builderUid(req);
  if (!uid) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { gameId?: unknown };
  const gameId = typeof body.gameId === "string" ? body.gameId.slice(0, 100) : "";
  if (!gameId) return NextResponse.json({ error: "gameId is required" }, { status: 400 });
  const messages = await takeMessages(uid, gameId);
  return NextResponse.json({ messages: messages.map((m) => ({ id: m.id, text: m.text, at: m.at })) });
}

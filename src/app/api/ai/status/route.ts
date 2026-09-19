import { NextResponse } from "next/server";
import { aiStatus } from "@/lib/ai/status";
import { sessionUid } from "@/lib/game-creator/http";

// GET /api/ai/status: which AI provider is in use, credit left, recent
// errors, the Game Creator builder's Claude plan health, and missing keys.
// Behind the login wall like every other hub route.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await aiStatus(await sessionUid()));
}

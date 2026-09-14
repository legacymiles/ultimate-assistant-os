import { NextResponse } from "next/server";
import { getShot } from "@/lib/game-creator/store";
import { sessionUid } from "@/lib/game-creator/http";

// GET /api/game-creator/shots/:gameId/:index — the bytes of one screenshot.
//
// Served through the session-gated API rather than a public bucket URL, so a
// screenshot is only ever visible to the owner of the game it belongs to.

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; n: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id, n } = await ctx.params;
  const index = Number.parseInt(n, 10);
  if (!Number.isInteger(index) || index < 0) return NextResponse.json({ error: "Bad index" }, { status: 400 });
  const bytes = await getShot(await sessionUid(), id, index);
  if (!bytes) return NextResponse.json({ error: "No such screenshot" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/png",
      // Screenshots never change once uploaded, but they are private.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}

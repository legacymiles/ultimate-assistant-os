import { NextResponse } from "next/server";
import { getGame, remove, retry } from "@/lib/game-creator/store";
import { notFound, sessionUid, storageFailed } from "@/lib/game-creator/http";

// GET    /api/game-creator/games/:id — one game with its log, design and shots.
// POST   /api/game-creator/games/:id { action: "retry" } — requeue a failed game.
// DELETE /api/game-creator/games/:id — remove the record and its screenshots.
//        The Unreal project on the PC is never touched from the website.

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const game = await getGame(await sessionUid(), id);
  return game ? NextResponse.json({ game }) : notFound();
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  if (body.action !== "retry") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const game = await retry(await sessionUid(), id);
  return game ? NextResponse.json({ game }) : notFound();
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const uid = await sessionUid();
  if (!(await getGame(uid, id))) return notFound();
  return (await remove(uid, id)) ? NextResponse.json({ ok: true }) : storageFailed();
}

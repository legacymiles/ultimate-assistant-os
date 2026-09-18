import { NextResponse } from "next/server";
import { getGame, launch, message, remove, retry } from "@/lib/game-creator/store";
import { MAX_MESSAGE_CHARS } from "@/lib/game-creator/types";
import { notFound, sessionUid, storageFailed } from "@/lib/game-creator/http";

// GET    /api/game-creator/games/:id — one game with its log, design and shots.
// POST   /api/game-creator/games/:id { action: "retry" } — requeue a failed game.
// POST   /api/game-creator/games/:id { action: "message", text } — write to the agent:
//        handed to the running build, or starts a follow-up build of a finished game.
// POST   /api/game-creator/games/:id { action: "play" | "open" } — ask the PC's builder to
//        open the game (packaged exe) or its project in Unreal on its next check-in.
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
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; text?: unknown };
  const uid = await sessionUid();
  if (body.action === "message") {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
    if (text.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json({ error: `Keep messages under ${MAX_MESSAGE_CHARS} characters.` }, { status: 400 });
    }
    if (!(await getGame(uid, id))) return notFound();
    const game = await message(uid, id, text);
    return game ? NextResponse.json({ game }) : storageFailed();
  }
  if (body.action === "play" || body.action === "open") {
    if (!(await getGame(uid, id))) return notFound();
    const game = await launch(uid, id, body.action);
    return game ? NextResponse.json({ game }) : storageFailed();
  }
  if (body.action !== "retry") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const game = await retry(uid, id);
  return game ? NextResponse.json({ game }) : notFound();
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const uid = await sessionUid();
  if (!(await getGame(uid, id))) return notFound();
  return (await remove(uid, id)) ? NextResponse.json({ ok: true }) : storageFailed();
}

import { NextResponse } from "next/server";
import { applyAction } from "@/lib/ai-rankings/boardActions";
import type { BoardAction } from "@/lib/ai-rankings/boardActions";
import { readBoard, saveBoard, viewerCanEdit } from "@/lib/ai-rankings/boardServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/ai-rankings/board — public. The models, plus whether you may edit.
//      The owner also gets the inbox; a visitor never sees it.
// POST /api/ai-rankings/board — owner only. Body: a BoardAction.
//
// This path is public in hubAccess so visitors can read. That makes the owner
// check below the ONLY thing guarding writes, so it runs before anything else.

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const [board, canEdit] = await Promise.all([readBoard(), viewerCanEdit()]);
    return NextResponse.json(
      {
        models: board.models,
        canEdit,
        ...(canEdit
          ? { inbox: board.inbox, lastSweepAt: board.lastSweepAt ?? null, lastSweepNote: board.lastSweepNote ?? null }
          : {}),
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("ai-rankings board: read failed", err);
    return NextResponse.json(
      { error: "The leaderboard couldn't be loaded right now. Try again in a minute." },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function POST(req: Request) {
  if (!(await viewerCanEdit())) {
    return NextResponse.json({ error: "Only the owner can change the leaderboard." }, { status: 403 });
  }

  let action: BoardAction;
  try {
    action = (await req.json()) as BoardAction;
    if (!action || typeof action !== "object" || typeof action.type !== "string") throw new Error();
  } catch {
    return NextResponse.json({ error: "That request didn't make sense." }, { status: 400 });
  }

  let board;
  try {
    board = await readBoard();
  } catch (err) {
    // Never apply a change to a board we failed to read: saving it would
    // replace everything on the real board with the change alone.
    console.error("ai-rankings board: read before write failed", err);
    return NextResponse.json({ error: "Couldn't reach storage, so nothing was changed. Try again." }, { status: 503 });
  }

  const result = applyAction(board, action, new Date().toISOString());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  if (!(await saveBoard(result.board))) {
    return NextResponse.json({ error: "Couldn't save that change. Try again." }, { status: 503 });
  }
  return NextResponse.json(
    {
      message: result.message,
      id: result.id,
      models: result.board.models,
      inbox: result.board.inbox,
    },
    { headers: NO_STORE },
  );
}

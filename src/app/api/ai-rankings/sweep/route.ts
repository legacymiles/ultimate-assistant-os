import { NextResponse } from "next/server";
import { readBoard, saveBoard, viewerCanEdit } from "@/lib/ai-rankings/boardServer";
import { mergeInbox, runSweep } from "@/lib/ai-rankings/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ai-rankings/sweep
//
// Checks Hugging Face for new releases and files them in the owner's inbox.
// Called once a day by .github/workflows/ai-rankings-sweep.yml (bearer token,
// no session) and by the owner's "Check now" button (session).
//
// It is a token path in middleware, so the check here is the only guard:
// a matching AI_RANKINGS_SWEEP_TOKEN, or the owner's own session. The worst an
// unauthorised call could do is fill the inbox early, but it still has to be
// one of those two.

function bearerOk(req: Request): boolean {
  const token = process.env.AI_RANKINGS_SWEEP_TOKEN;
  if (!token) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (got.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  if (!bearerOk(req) && !(await viewerCanEdit())) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  let board;
  try {
    board = await readBoard();
  } catch (err) {
    console.error("ai-rankings sweep: read failed", err);
    return NextResponse.json({ error: "Couldn't reach storage. The next run will try again." }, { status: 503 });
  }

  const result = await runSweep(board);
  const at = new Date().toISOString();
  const n = result.added.length;
  const note =
    (n ? `${n} new release${n === 1 ? "" : "s"} found` : "No new releases") +
    (result.failed.length ? ` · couldn't read ${result.failed.join(", ")}` : "");

  // Re-read just before saving: the owner may have approved something while
  // the feeds were loading, and saving the stale copy would undo it.
  let latest;
  try {
    latest = await readBoard();
  } catch {
    return NextResponse.json({ error: "Couldn't reach storage. The next run will try again." }, { status: 503 });
  }
  const next = { ...latest, inbox: mergeInbox(latest, result.added), lastSweepAt: at, lastSweepNote: note };
  if (!(await saveBoard(next))) {
    return NextResponse.json({ error: "Found releases but couldn't save them. The next run will try again." }, { status: 503 });
  }
  return NextResponse.json({ added: n, failed: result.failed, note, inbox: next.inbox, lastSweepAt: at });
}

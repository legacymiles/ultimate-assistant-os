import { NextResponse } from "next/server";
import { runStep } from "@/lib/h3-lab/server/steps";
import { pairedUids } from "@/lib/h3-lab/server/store";
import { isTickToken, unauthorized, workerUid } from "@/lib/h3-lab/server/http";

// POST /api/h3-lab/worker/tick — advance the agent one step without a browser.
// Callers: the PC worker (its token → its owner) and the scheduled GitHub
// Action (H3LAB_TICK_TOKEN → every owner with a paired worker). Token-only;
// session-exempt in middleware by exact path. The open page uses
// /api/h3-lab/agent/tick, which stays behind the owner session.

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const uid = await workerUid(req);
  const uids = uid ? [uid] : isTickToken(req) ? await pairedUids() : null;
  if (!uids) return unauthorized();
  const steps = [];
  for (const u of uids) steps.push((await runStep(u)).step);
  return NextResponse.json({ steps });
}

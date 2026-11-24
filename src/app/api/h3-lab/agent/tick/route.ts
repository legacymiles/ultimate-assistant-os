import { NextResponse } from "next/server";
import { runStep } from "@/lib/h3-lab/server/steps";
import { sessionUid } from "@/lib/h3-lab/server/http";

// POST /api/h3-lab/agent/tick — the open page nudging the agent one step.
// Owner-only in middleware.

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  const { step } = await runStep(await sessionUid());
  return NextResponse.json({ step });
}

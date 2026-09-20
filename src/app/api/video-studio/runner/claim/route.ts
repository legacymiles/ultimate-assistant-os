import { NextResponse } from "next/server";
import { jobPayload } from "@/lib/video-studio/server/run";
import { claimJob } from "@/lib/video-studio/server/store";
import { runnerUid, unauthorized } from "@/lib/video-studio/server/http";

// POST /api/video-studio/runner/claim
//
// Called by the studio runner on the owner's PC every few seconds. Records
// that the runner is alive — which is what makes the method cards say "Ready
// to run" rather than "Not connected" — and hands over the oldest queued job,
// or 204 when there is nothing to do.
//
// Token-authenticated; session-exempt in middleware by exact path.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const uid = await runnerUid(req);
  if (!uid) return unauthorized();

  const claimed = await claimJob(uid);
  if (!claimed) return new NextResponse(null, { status: 204 });

  return NextResponse.json(jobPayload(claimed.job, claimed.project));
}

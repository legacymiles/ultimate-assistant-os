import { NextResponse } from "next/server";
import { claimJob } from "@/lib/mp3-download/server/bridge";
import { runnerUid, unauthorized } from "@/lib/mp3-download/server/auth";

// POST /api/mp3-download/runner/claim
//
// Called by the runner on the owner's PC every few seconds. Records that it is
// alive — which is what makes the app say "Your PC is listening" rather than
// "not connected" — and hands over the oldest queued job, or 204 when there is
// nothing to do.
//
// Token-authenticated; session-exempt in middleware by exact path.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const uid = await runnerUid(request);
  if (!uid) return unauthorized();

  const job = await claimJob(uid);
  if (!job) return new NextResponse(null, { status: 204 });

  return NextResponse.json({
    id: job.id,
    url: job.url,
    mode: job.mode,
    title: job.title,
    creator: job.creator,
    filename: job.filename,
  });
}

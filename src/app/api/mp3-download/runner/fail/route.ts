import { NextResponse } from "next/server";
import { failJob } from "@/lib/mp3-download/server/bridge";
import { bad, runnerUid, unauthorized } from "@/lib/mp3-download/server/auth";

// POST /api/mp3-download/runner/fail
//
// The runner could not finish a job. The reason travels back verbatim so the
// page can show what yt-dlp actually said, rather than a shrug.
//
// Token-authenticated; session-exempt in middleware by exact path.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const uid = await runnerUid(request);
  if (!uid) return unauthorized();

  const body = (await request.json().catch(() => null)) as { jobId?: string; error?: string } | null;
  const jobId = body?.jobId ?? "";
  if (!jobId) return bad("jobId is required.");

  await failJob(uid, jobId, body?.error || "The runner did not say why.");
  return NextResponse.json({ ok: true });
}

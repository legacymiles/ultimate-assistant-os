import { NextResponse } from "next/server";
import { finishJob, note, patchProject, sceneRun, setStatus, setStep } from "@/lib/video-studio/server/store";
import { runnerUid, bad, notFound, unauthorized } from "@/lib/video-studio/server/http";

// POST /api/video-studio/runner/fail
// Body: { projectId, error, jobId?, sceneIndex? }
//
// The real error, on the screen, with the run stopped. There is no "render
// finished" path that a failure can fall through into.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const uid = await runnerUid(req);
  if (!uid) return unauthorized();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const error = (typeof body?.error === "string" ? body.error : "").trim().slice(0, 1200);
  if (!projectId || !error) return bad("projectId and error are required");

  const index = Number(body?.sceneIndex);
  const project = await patchProject(uid, projectId, (p) => {
    if (Number.isInteger(index)) {
      const run = sceneRun(p, index);
      if (run) {
        run.state = "failed";
        run.error = error;
        run.attempts += 1;
      }
      setStep(p, `scene-${index}`, "failed", error);
    }
    setStatus(p, "failed", error);
    note(p, "failed", error);
  });

  if (typeof body?.jobId === "string" && body.jobId) await finishJob(uid, body.jobId, "failed");
  return project ? NextResponse.json({ ok: true }) : notFound();
}

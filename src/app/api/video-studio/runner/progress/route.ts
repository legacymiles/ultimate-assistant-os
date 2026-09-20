import { NextResponse } from "next/server";
import { note, patchProject, sceneRun, setStatus, setStep } from "@/lib/video-studio/server/store";
import { runnerUid, bad, notFound, unauthorized } from "@/lib/video-studio/server/http";
import type { RunState } from "@/lib/video-studio/types";

// POST /api/video-studio/runner/progress
// Body: { projectId, step?: { id, label?, state, detail? }, sceneIndex?, sceneState?, log? }
//
// The runner reports what it is actually doing. Every line the user sees in
// the status list came through here or from the server-side run loop — the app
// never invents a step, and a step only turns green when the work behind it
// finished.

export const runtime = "nodejs";

const STATES: RunState[] = ["pending", "running", "done", "failed", "skipped"];

function state(value: unknown): RunState | null {
  return STATES.includes(value as RunState) ? (value as RunState) : null;
}

export async function POST(req: Request) {
  const uid = await runnerUid(req);
  if (!uid) return unauthorized();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  if (!projectId) return bad("projectId required");

  const project = await patchProject(uid, projectId, (p) => {
    const step = body?.step as { id?: unknown; label?: unknown; state?: unknown; detail?: unknown } | undefined;
    if (step && typeof step.id === "string") {
      const next = state(step.state) ?? "running";
      setStep(p, step.id, next, typeof step.detail === "string" ? step.detail.slice(0, 400) : undefined);
      const line = p.steps.find((s) => s.id === step.id);
      if (line && typeof step.label === "string" && step.label.trim()) line.label = step.label.trim().slice(0, 120);
    }

    const index = Number(body?.sceneIndex);
    const sceneState = state(body?.sceneState);
    if (Number.isInteger(index) && sceneState) {
      const run = sceneRun(p, index);
      if (run) {
        run.state = sceneState;
        run.at = new Date().toISOString();
        if (sceneState === "failed") run.error = typeof body?.detail === "string" ? body.detail.slice(0, 400) : "Failed";
      }
      setStep(p, `scene-${index}`, sceneState);
    }

    if (typeof body?.log === "string" && body.log.trim()) {
      note(p, "log", body.log.trim().slice(0, 300));
    }

    if (p.status === "queued") setStatus(p, "rendering");
  });

  return project ? NextResponse.json({ ok: true }) : notFound();
}

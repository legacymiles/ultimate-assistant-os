import { NextResponse } from "next/server";
import { briefProblem, normaliseBrief } from "@/lib/video-studio/brief";
import { DIRECTOR_ID, isMethodId } from "@/lib/video-studio/registry";
import { tidyPlan } from "@/lib/video-studio/plan";
import { createProject, listProjects, patchProject } from "@/lib/video-studio/server/store";
import { bad, sessionUid, storageFailed } from "@/lib/video-studio/server/http";
import type { ProductionPlan } from "@/lib/video-studio/types";

// GET  /api/video-studio/projects — every project, newest first
// POST /api/video-studio/projects — create one from a brief (+ optional plan)

export const runtime = "nodejs";

export async function GET() {
  const uid = await sessionUid();
  return NextResponse.json({ projects: await listProjects(uid) });
}

export async function POST(req: Request) {
  const uid = await sessionUid();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid request body");
  }

  const brief = normaliseBrief(body.brief);
  const problem = briefProblem(brief);
  if (problem) return bad(problem);

  const mode = body.mode === "director" ? "director" : "manual";
  const methodId = typeof body.methodId === "string" ? body.methodId : "";
  if (mode === "manual" && !isMethodId(methodId)) return bad("Choose a creation method first.");

  const project = await createProject(uid, brief, mode === "director" ? DIRECTOR_ID : methodId, mode);
  if (!project) return storageFailed();

  // The plan screen sends the plan it just showed the user, so the approved
  // wording is what gets rendered rather than a fresh generation.
  if (body.plan && typeof body.plan === "object") {
    const plan = tidyPlan(body.plan as ProductionPlan, mode === "director" ? "remotion" : methodId);
    const updated = await patchProject(uid, project.id, (p) => {
      p.plan = plan;
      p.title = plan.title || p.title;
      p.status = "planned";
    });
    if (updated) return NextResponse.json({ project: updated });
  }

  return NextResponse.json({ project });
}

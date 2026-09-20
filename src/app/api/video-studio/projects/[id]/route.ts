import { NextResponse } from "next/server";
import { normaliseBrief } from "@/lib/video-studio/brief";
import { DIRECTOR_ID, isMethodId, methodById } from "@/lib/video-studio/registry";
import { tidyPlan } from "@/lib/video-studio/plan";
import { advance, startRender } from "@/lib/video-studio/server/run";
import {
  duplicateProject,
  getProject,
  note,
  patchProject,
  removeProject,
  versionsOf,
} from "@/lib/video-studio/server/store";
import { bad, notFound, sessionUid, storageFailed } from "@/lib/video-studio/server/http";
import type { ProductionPlan } from "@/lib/video-studio/types";

// GET    /api/video-studio/projects/:id   — the project, its versions, and one
//                                           step of progress on a live render
// POST   /api/video-studio/projects/:id   — { action: render | render-scene |
//                                             plan | brief | method | duplicate }
// DELETE /api/video-studio/projects/:id
//
// Reading an active project ADVANCES it: server-rendered scenes move forward
// while the user is watching and stop when they stop looking, which is the
// right trade for a model that bills per second.

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const uid = await sessionUid();
  const { id } = await params;
  const existing = await getProject(uid, id);
  if (!existing) return notFound();

  const project = (await advance(uid, id)) ?? existing;
  return NextResponse.json({ project, versions: await versionsOf(uid, id) });
}

export async function DELETE(_req: Request, { params }: Params) {
  const uid = await sessionUid();
  const { id } = await params;
  return (await removeProject(uid, id)) ? NextResponse.json({ ok: true }) : notFound();
}

export async function POST(req: Request, { params }: Params) {
  const uid = await sessionUid();
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid request body");
  }

  switch (body.action) {
    case "render": {
      const { project, error } = await startRender(uid, id, null);
      if (error) return NextResponse.json({ error }, { status: 409 });
      return project ? NextResponse.json({ project }) : notFound();
    }

    case "render-scene": {
      const index = Number(body.sceneIndex);
      if (!Number.isInteger(index) || index < 1) return bad("Which scene?");
      const { project, error } = await startRender(uid, id, index);
      if (error) return NextResponse.json({ error }, { status: 409 });
      return project ? NextResponse.json({ project }) : notFound();
    }

    case "plan": {
      if (!body.plan || typeof body.plan !== "object") return bad("No plan supplied.");
      const current = await getProject(uid, id);
      if (!current) return notFound();
      const fallback = current.mode === "director" ? "remotion" : current.methodId;
      const plan = tidyPlan(body.plan as ProductionPlan, fallback);
      const project = await patchProject(uid, id, (p) => {
        p.plan = plan;
        p.title = plan.title || p.title;
        if (p.status === "draft") p.status = "planned";
        note(p, "planned", "Production plan updated");
      });
      return project ? NextResponse.json({ project }) : storageFailed();
    }

    case "brief": {
      const brief = normaliseBrief(body.brief);
      const project = await patchProject(uid, id, (p) => {
        p.brief = brief;
        // The plan was written for the old brief; keeping it would render the
        // wrong video and look like the edit was ignored.
        p.plan = null;
        p.status = "draft";
        p.steps = [];
        p.scenes = [];
        note(p, "brief", "Brief edited — the plan needs rewriting");
      });
      return project ? NextResponse.json({ project }) : storageFailed();
    }

    case "method": {
      const methodId = typeof body.methodId === "string" ? body.methodId : "";
      const director = methodId === DIRECTOR_ID;
      if (!director && !isMethodId(methodId)) return bad("Unknown method.");
      const project = await patchProject(uid, id, (p) => {
        p.methodId = methodId;
        p.mode = director ? "director" : "manual";
        if (p.plan) {
          p.plan = {
            ...p.plan,
            methodId,
            skill: director ? "AI Director" : (methodById(methodId)?.meta.skill ?? methodId),
            scenes: p.plan.scenes.map((s) => ({
              ...s,
              methodId: director ? s.methodId : methodId,
              // A directive written for one engine means nothing to another.
              directive: undefined,
            })),
          };
        }
        p.steps = [];
        p.scenes = [];
        p.videoKey = undefined;
        p.status = p.plan ? "planned" : "draft";
        note(p, "method", `Method changed to ${director ? "AI Director" : (methodById(methodId)?.meta.name ?? methodId)}`);
      });
      return project ? NextResponse.json({ project }) : storageFailed();
    }

    case "duplicate": {
      const methodId = typeof body.methodId === "string" ? body.methodId : "";
      if (methodId !== DIRECTOR_ID && !isMethodId(methodId)) return bad("Which method should the copy use?");
      const copy = await duplicateProject(uid, id, methodId);
      return copy ? NextResponse.json({ project: copy }) : notFound();
    }

    default:
      return bad("Unknown action.");
  }
}

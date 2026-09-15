import { NextResponse } from "next/server";
import { direct } from "@/lib/studio3d/director";
import { badRequest, sessionUid, storageFailed } from "@/lib/studio3d/http";
import { builderInfo, createProject, listProjects } from "@/lib/studio3d/store";
import { parseBrief } from "@/lib/studio3d/brief";
import { MAX_PROMPT_CHARS } from "@/lib/studio3d/types";

// GET  /api/studio3d/projects — this owner's video projects plus their PC studio status.
// POST /api/studio3d/projects { prompt, brief } — the director plans a new video.

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const uid = await sessionUid();
  const [projects, builder] = await Promise.all([listProjects(uid), builderInfo(uid)]);
  return NextResponse.json({ projects, builder });
}

export async function POST(req: Request) {
  const uid = await sessionUid();
  const body = (await req.json().catch(() => ({}))) as { prompt?: unknown; brief?: unknown };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 6) return badRequest("Describe the video in a few words or more.");
  if (prompt.length > MAX_PROMPT_CHARS) return badRequest(`Keep the prompt under ${MAX_PROMPT_CHARS} characters.`);

  const brief = parseBrief(body.brief);
  const plan = await direct(prompt, brief);
  const project = await createProject(uid, prompt, brief, plan);
  if (!project) return storageFailed();
  return NextResponse.json({ project }, { status: 201 });
}

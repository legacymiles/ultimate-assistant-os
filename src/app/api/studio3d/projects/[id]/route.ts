import { NextResponse } from "next/server";
import { direct } from "@/lib/studio3d/director";
import { normalizePlan } from "@/lib/studio3d/director/normalize";
import { parseBrief } from "@/lib/studio3d/brief";
import { badRequest, notFound, sessionUid, storageFailed } from "@/lib/studio3d/http";
import { canEdit } from "@/lib/studio3d/reducer";
import { cancel, getProject, queue, remove, savePlan } from "@/lib/studio3d/store";

// GET    /api/studio3d/projects/:id
// PATCH  /api/studio3d/projects/:id { plan, brief? } — the owner edited the storyboard
// POST   /api/studio3d/projects/:id { action: "render" | "cancel" | "redirect", note? }
// DELETE /api/studio3d/projects/:id

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const project = await getProject(await sessionUid(), id);
  return project ? NextResponse.json({ project }) : notFound();
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const uid = await sessionUid();
  const current = await getProject(uid, id);
  if (!current) return notFound();
  if (!canEdit(current)) return NextResponse.json({ error: "The storyboard is locked while your PC renders it." }, { status: 409 });

  const body = (await req.json().catch(() => null)) as { plan?: unknown; brief?: unknown } | null;
  if (!body?.plan) return badRequest("plan is required");
  const brief = body.brief ? parseBrief(body.brief) : current.brief;
  const plan = normalizePlan(body.plan, brief, current.prompt, current.plan.source);
  const project = await savePlan(uid, id, plan, brief);
  return project ? NextResponse.json({ project }) : storageFailed();
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const uid = await sessionUid();
  const current = await getProject(uid, id);
  if (!current) return notFound();
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; note?: unknown };

  if (body.action === "render") {
    if (!canEdit(current)) return NextResponse.json({ error: "Already rendering." }, { status: 409 });
    const project = await queue(uid, id);
    return project ? NextResponse.json({ project }) : storageFailed();
  }
  if (body.action === "cancel") {
    const project = await cancel(uid, id);
    return project ? NextResponse.json({ project }) : storageFailed();
  }
  if (body.action === "redirect") {
    if (!canEdit(current)) return NextResponse.json({ error: "The storyboard is locked while your PC renders it." }, { status: 409 });
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
    const plan = await direct(current.prompt, current.brief, { note: note || undefined, previous: current.plan });
    const project = await savePlan(uid, id, plan);
    return project ? NextResponse.json({ project }) : storageFailed();
  }
  return badRequest("Unknown action");
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const uid = await sessionUid();
  if (!(await getProject(uid, id))) return notFound();
  return (await remove(uid, id)) ? NextResponse.json({ ok: true }) : storageFailed();
}

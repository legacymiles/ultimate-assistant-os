import { NextResponse } from "next/server";
import { TOOLS, type ToolId } from "@/lib/studio3d/tools/registry";
import { builderUid, notFound, unauthorized } from "@/lib/studio3d/http";
import { progress } from "@/lib/studio3d/store";
import type { ProgressUpdate, ProjectStatus, RenderReport } from "@/lib/studio3d/types";

// POST /api/studio3d/builder/progress { projectId, status?, note?, lines?, report? }
//
// The builder streams what Claude is doing and, at the end, the render report.
// Validated field by field because the body comes from a program.

export const runtime = "nodejs";

const STATUSES: ProjectStatus[] = ["building", "animating", "rendering", "ready", "failed"];

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function report(v: unknown): RenderReport | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  const toolIds = new Set(TOOLS.map((t) => t.id));
  return {
    engine: str(r.engine, 40),
    resolution: str(r.resolution, 40),
    fps: num(r.fps),
    frames: num(r.frames),
    renderMinutes: num(r.renderMinutes),
    blendFile: str(r.blendFile, 500),
    outputPath: str(r.outputPath, 500),
    toolsUsed: (Array.isArray(r.toolsUsed) ? r.toolsUsed : [])
      .map((t) => t as Record<string, unknown>)
      .filter((t) => toolIds.has(t?.tool as ToolId))
      .slice(0, 12)
      .map((t) => ({ tool: t.tool as ToolId, used: Boolean(t.used), note: str(t.note, 400) ?? "" })),
    cut: (Array.isArray(r.cut) ? r.cut : [])
      .map((c) => (typeof c === "string" ? { item: c, reason: "" } : (c as Record<string, unknown>)))
      .filter((c) => typeof c?.item === "string")
      .slice(0, 20)
      .map((c) => ({ item: String(c.item).slice(0, 200), reason: str(c.reason, 400) ?? "" })),
  };
}

export async function POST(req: Request) {
  const uid = await builderUid(req);
  if (!uid) return unauthorized();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = str(body?.projectId, 100);
  if (!body || !projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  const update: ProgressUpdate = {
    status: STATUSES.includes(body.status as ProjectStatus) ? (body.status as ProjectStatus) : undefined,
    note: str(body.note, 300),
    lines: Array.isArray(body.lines) ? body.lines.filter((l): l is string => typeof l === "string").slice(0, 200).map((l) => l.slice(0, 2000)) : undefined,
    report: report(body.report),
  };
  const project = await progress(uid, projectId, update);
  if (!project) return notFound();
  return NextResponse.json({ ok: true, status: project.status });
}

import { NextResponse } from "next/server";
import { builderUid, notFound, unauthorized } from "@/lib/studio3d/http";
import { fail } from "@/lib/studio3d/store";

// POST /api/studio3d/builder/fail { projectId, error } — the builder gave up; the error is what the owner sees.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const uid = await builderUid(req);
  if (!uid) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown; error?: unknown };
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  const error = typeof body.error === "string" && body.error.trim() ? body.error : "The render stopped without a reason.";
  const project = await fail(uid, projectId, error);
  if (!project) return notFound();
  return NextResponse.json({ ok: true });
}

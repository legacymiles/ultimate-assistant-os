import { NextResponse } from "next/server";
import type { ThinkResultRequest } from "@/lib/h3-lab/api";
import { applyThink } from "@/lib/h3-lab/server/steps";
import { bad, readJson, unauthorized, workerUid } from "@/lib/h3-lab/server/http";

// POST /api/h3-lab/worker/think — Claude Code's answer to a think job,
// applied exactly as the hub-AI path would have applied it.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const uid = await workerUid(req);
  if (!uid) return unauthorized();
  const body = await readJson<ThinkResultRequest>(req);
  if (!body?.jobId) return bad("jobId is required.");
  await applyThink(uid, body.jobId, Boolean(body.ok), body.result, body.error);
  return NextResponse.json({ ok: true });
}

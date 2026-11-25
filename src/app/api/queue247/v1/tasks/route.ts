// 24/7 Queue public API, v1 — for websites and apps outside the hub.
// Auth: `Authorization: Bearer q247_…` (24/7 Queue › Apps). See docs/queue-247-api.md.
//
// GET  → tasks this app submitted or was assigned (?status=queued,running&limit=)
// POST { title, instruction?, executor?, kind?, schedule?, priority?, config?, assign_to_me? }
//      → { task }. executor defaults to "research"; assign_to_me files an
//        "app-webhook" task the app itself will do and report on.

import { NextResponse } from "next/server";
import { appCaller, errorJson } from "@/lib/queue247/server/auth";
import { queueDb } from "@/lib/queue247/server/db";
import { createTask } from "@/lib/queue247/server/store";
import { executorFor } from "@/lib/queue247/executors/registry";
import type { NewTaskInput } from "@/lib/queue247/engine";
import type { Task } from "@/lib/queue247/types";
import { publicTask } from "@/lib/queue247/publicTask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const who = await appCaller(req);
  if ("error" in who) return who.error;
  const p = new URL(req.url).searchParams;
  try {
    let q = queueDb()
      .from("queue_tasks")
      .select("*")
      .eq("user_id", who.uid)
      .or(`app.eq.${who.appId},created_by.eq.app:${who.appId}`);
    const statuses = (p.get("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length) q = q.in("status", statuses);
    const { data, error } = await q.order("updated_at", { ascending: false }).limit(Math.min(100, Number(p.get("limit")) || 50));
    if (error) throw new Error(error.message);
    return NextResponse.json({ tasks: ((data ?? []) as Task[]).map(publicTask) });
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: Request) {
  const who = await appCaller(req);
  if ("error" in who) return who.error;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    const executorId = body.assign_to_me ? "app-webhook" : String(body.executor ?? "research");
    const ex = executorFor(executorId);
    if (!ex || ex.id === "rollup" || ex.id === "code-change") {
      return NextResponse.json({ error: `Outside apps can file: research, monitor, h3-recreate, mt4-discovery, or assign_to_me.` }, { status: 400 });
    }
    const input: NewTaskInput = {
      title: String(body.title ?? ""),
      instruction: typeof body.instruction === "string" ? body.instruction : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      app: who.appId,
      executor: ex.id,
      agent: ex.agent,
      kind: (body.kind as NewTaskInput["kind"]) ?? ex.defaultKind,
      schedule: body.schedule as NewTaskInput["schedule"],
      priority: Number(body.priority) || 3,
      config: (body.config as Record<string, unknown>) ?? {},
      needs: ex.needs,
      created_by: `app:${who.appId}`,
      steps: ex.initialSteps?.((body.config as Record<string, unknown>) ?? {}),
    };
    const task = await createTask(queueDb(), who.uid, input);
    return NextResponse.json({ task: publicTask(task) }, { status: 201 });
  } catch (e) {
    return errorJson(e);
  }
}

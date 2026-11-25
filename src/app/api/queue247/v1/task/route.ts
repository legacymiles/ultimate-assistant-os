// 24/7 Queue public API v1 — one task: /api/queue247/v1/task?id=<task id>
// (a query parameter, not a path segment: session-exempt API paths are exact
// matches in middleware, never prefixes).
// GET  → the task (only one this app submitted or was assigned).
// POST → report on it (the app is doing the work, "app-webhook" tasks, or
//        adding to its own task):
//   { type: "progress", progress?: 0-100, step?: string, message?: string }
//   { type: "log", message, level?: "info"|"warn"|"error" }
//   { type: "finding", kind, key, title, summary?, url?, score?, data?, notable? }
//   { type: "complete", summary }
//   { type: "fail", error }
//   { type: "ask", question }        → waits for the owner (needs_input)
//   { type: "control", action: "pause"|"resume"|"cancel"|"run_now" }

import { NextResponse } from "next/server";
import { appCaller, errorJson } from "@/lib/queue247/server/auth";
import { queueDb } from "@/lib/queue247/server/db";
import { addEvent, getTask, notify, ownerAct, patchTask, upsertFinding } from "@/lib/queue247/server/store";
import { applyStepResult, type OwnerAction } from "@/lib/queue247/engine";
import { publicTask } from "@/lib/queue247/publicTask";
import type { Task } from "@/lib/queue247/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function mine(uid: string, appId: string, id: string): Promise<Task | null> {
  const t = await getTask(queueDb(), uid, id);
  if (!t) return null;
  return t.app === appId || t.created_by === `app:${appId}` ? t : null;
}

export async function GET(req: Request) {
  const who = await appCaller(req);
  if ("error" in who) return who.error;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  try {
    const t = await mine(who.uid, who.appId, id);
    if (!t) return NextResponse.json({ error: "No such task for this app." }, { status: 404 });
    return NextResponse.json({ task: publicTask(t) });
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: Request) {
  const who = await appCaller(req);
  if ("error" in who) return who.error;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    const db = queueDb();
    const t = await mine(who.uid, who.appId, id);
    if (!t) return NextResponse.json({ error: "No such task for this app." }, { status: 404 });
    const by = `app:${who.appId}`;
    const now = new Date().toISOString();
    switch (b.type) {
      case "progress": {
        const patch: Partial<Task> = { last_activity_at: now };
        if (b.progress !== undefined) patch.progress = Math.max(0, Math.min(100, Math.round(Number(b.progress) || 0)));
        if (typeof b.step === "string") patch.current_step = b.step.slice(0, 200);
        const next = await patchTask(db, id, patch);
        if (typeof b.message === "string") await addEvent(db, id, null, "step", `[${by}] ${b.message}`);
        return NextResponse.json({ task: publicTask(next) });
      }
      case "log": {
        const level = b.level === "warn" || b.level === "error" ? b.level : "info";
        await addEvent(db, id, null, level, `[${by}] ${String(b.message ?? "").slice(0, 2000)}`);
        return NextResponse.json({ ok: true });
      }
      case "finding": {
        if (typeof b.kind !== "string" || typeof b.key !== "string" || typeof b.title !== "string") {
          return NextResponse.json({ error: "A finding needs kind, key and title." }, { status: 400 });
        }
        const r = await upsertFinding(db, who.uid, id, who.appId, {
          kind: b.kind,
          key: b.key,
          title: b.title,
          summary: typeof b.summary === "string" ? b.summary : "",
          url: typeof b.url === "string" ? b.url : null,
          score: b.score === undefined ? null : Number(b.score),
          data: b.data && typeof b.data === "object" ? (b.data as Record<string, unknown>) : {},
          notable: Boolean(b.notable),
        });
        if (r.isNew) await addEvent(db, id, null, "result", `[${by}] Found: ${b.title}`);
        if (r.isNew && b.notable) await notify(db, who.uid, id, `New from ${who.appId}: ${b.title}`, String(b.summary ?? ""), "/apps/jarvis#queue");
        return NextResponse.json(r);
      }
      case "complete":
      case "fail":
      case "ask": {
        const result =
          b.type === "complete"
            ? { outcome: "done" as const, summary: String(b.summary ?? "Done.").slice(0, 2000) }
            : b.type === "fail"
              ? { outcome: "failed" as const, error: String(b.error ?? "Failed.").slice(0, 2000), retryable: false }
              : { outcome: "needs_input" as const, question: String(b.question ?? "").slice(0, 1000) || "The app needs your input." };
        const next = await patchTask(db, id, applyStepResult(t, result));
        const line =
          result.outcome === "done" ? result.summary : result.outcome === "failed" ? result.error : result.question;
        await addEvent(db, id, null, b.type === "fail" ? "error" : "result", `[${by}] ${line}`);
        if (b.type !== "complete") await notify(db, who.uid, id, `${who.appId}: ${t.title}`, line, "/apps/jarvis#queue");
        return NextResponse.json({ task: publicTask(next) });
      }
      case "control": {
        const action = String(b.action ?? "");
        if (!["pause", "resume", "cancel", "run_now"].includes(action)) return NextResponse.json({ error: "control: pause, resume, cancel or run_now." }, { status: 400 });
        const next = await ownerAct(db, who.uid, id, { action } as OwnerAction);
        return NextResponse.json({ task: publicTask(next) });
      }
      default:
        return NextResponse.json({ error: "type: progress, log, finding, complete, fail, ask or control." }, { status: 400 });
    }
  } catch (e) {
    return errorJson(e);
  }
}

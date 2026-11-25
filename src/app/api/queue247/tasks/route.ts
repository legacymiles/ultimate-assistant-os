// 24/7 Queue — the board's data and the owner's buttons.
//
// GET  → everything the command center shows at once: tasks, live workers,
//        the activity ticker, recent discoveries, notifications, apps and
//        executors. Polled every few seconds while the page is open.
// POST → { action: "create", task } · { action: "act", id, act } ·
//        { action: "delete", id } · { action: "read_notifications" } ·
//        { action: "seen_findings", ids }

import { NextResponse } from "next/server";
import { errorJson, signedIn } from "@/lib/queue247/server/auth";
import { queueDb } from "@/lib/queue247/server/db";
import {
  createTask,
  deleteTask,
  listExternalApps,
  listFindings,
  listNotifications,
  listTasks,
  liveWorkers,
  markFindingsSeen,
  markNotificationsRead,
  ownerAct,
  recentEvents,
} from "@/lib/queue247/server/store";
import { allApps } from "@/lib/queue247/apps";
import { executorFor, executorSummaries } from "@/lib/queue247/executors/registry";
import type { NewTaskInput, OwnerAction } from "@/lib/queue247/engine";
import type { Capability } from "@/lib/queue247/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const who = await signedIn();
  if ("error" in who) return who.error;
  try {
    const db = queueDb();
    const [tasks, workers, findings, notifications, external] = await Promise.all([
      listTasks(db, who.uid, 300),
      liveWorkers(db),
      listFindings(db, who.uid, { limit: 30 }),
      listNotifications(db, who.uid, 30),
      listExternalApps(db, who.uid),
    ]);
    const live = tasks.filter((t) => !["completed", "cancelled"].includes(t.status)).map((t) => t.id);
    const events = await recentEvents(db, live.length ? live : tasks.slice(0, 50).map((t) => t.id), 40);
    return NextResponse.json({
      tasks,
      workers,
      events,
      findings,
      notifications,
      apps: allApps(external).map((a) => ({ id: a.id, name: a.name, source: a.source, executors: a.executors, url: a.url })),
      executors: executorSummaries(),
      now: new Date().toISOString(),
    });
  } catch (e) {
    return errorJson(e);
  }
}

export async function POST(req: Request) {
  const who = await signedIn();
  if ("error" in who) return who.error;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    const db = queueDb();
    switch (body.action) {
      case "create": {
        const input = (body.task ?? {}) as NewTaskInput;
        const ex = executorFor(String(input.executor ?? ""));
        if (!ex || ex.id === "rollup") return NextResponse.json({ error: "Pick what kind of work this is." }, { status: 400 });
        const needs = new Set<Capability>([...ex.needs, ...((input.needs ?? []) as Capability[])]);
        const task = await createTask(db, who.uid, {
          ...input,
          agent: ex.agent,
          kind: input.kind ?? ex.defaultKind,
          needs: [...needs],
          created_by: "you",
          steps: input.steps ?? ex.initialSteps?.(input.config ?? {}),
        });
        return NextResponse.json({ task });
      }
      case "act": {
        const task = await ownerAct(db, who.uid, String(body.id ?? ""), body.act as OwnerAction);
        return NextResponse.json({ task });
      }
      case "delete":
        await deleteTask(db, who.uid, String(body.id ?? ""));
        return NextResponse.json({ ok: true });
      case "read_notifications":
        await markNotificationsRead(db, who.uid);
        return NextResponse.json({ ok: true });
      case "seen_findings":
        await markFindingsSeen(db, who.uid, Array.isArray(body.ids) ? body.ids.map(String) : []);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return errorJson(e);
  }
}

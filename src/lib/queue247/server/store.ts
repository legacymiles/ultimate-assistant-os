// ---------------------------------------------------------------------------
// 24/7 Queue store — every read and write of the queue tables.
//
// Shared by the API routes and the VPS worker so both write rows the same
// way. Every function takes the user id it acts for and filters by it; the
// tables have no RLS policies, so this file is where "nobody sees anyone
// else's tasks" is enforced.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyOwnerAction, buildTask, type NewTaskInput, type OwnerAction, type TaskPatch } from "../engine";
import type { EventLevel, Finding, QueueApp, Task, TaskEvent, TaskMessage, TaskRun } from "../types";
import type { NewFinding } from "../executors/types";

export class StoreError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function fail(what: string, error: { message: string } | null): never {
  throw new StoreError(`${what}: ${error?.message ?? "unknown database error"}`, 500);
}

// --- tasks -------------------------------------------------------------------

export async function listTasks(db: SupabaseClient, uid: string, limit = 300): Promise<Task[]> {
  const { data, error } = await db
    .from("queue_tasks")
    .select("*")
    .eq("user_id", uid)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) fail("Could not read the queue", error);
  return (data ?? []) as Task[];
}

export async function getTask(db: SupabaseClient, uid: string, id: string): Promise<Task | null> {
  const { data, error } = await db.from("queue_tasks").select("*").eq("user_id", uid).eq("id", id).maybeSingle();
  if (error) fail("Could not read the task", error);
  return (data as Task) ?? null;
}

/** The worker's read: by id only, it already holds the lock. */
export async function getTaskById(db: SupabaseClient, id: string): Promise<Task | null> {
  const { data, error } = await db.from("queue_tasks").select("*").eq("id", id).maybeSingle();
  if (error) fail("Could not read the task", error);
  return (data as Task) ?? null;
}

export async function createTask(
  db: SupabaseClient,
  uid: string,
  input: NewTaskInput,
  extra: { steps?: string[] } = {},
): Promise<Task> {
  const row = buildTask({ ...input, steps: input.steps ?? extra.steps });
  const { data, error } = await db.from("queue_tasks").insert({ ...row, user_id: uid }).select("*").single();
  if (error) fail("Could not file the task", error);
  const task = data as Task;
  await addEvent(db, task.id, null, "info", `Filed by ${task.created_by}: ${task.title}`, {
    kind: task.kind,
    executor: task.executor,
    app: task.app || null,
  });
  return task;
}

export async function patchTask(db: SupabaseClient, id: string, patch: TaskPatch): Promise<Task> {
  const { data, error } = await db
    .from("queue_tasks")
    .update({ ...patch, updated_at: patch.updated_at ?? new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) fail("Could not update the task", error);
  return data as Task;
}

/** One of the owner's buttons, folded through engine.applyOwnerAction. */
export async function ownerAct(db: SupabaseClient, uid: string, id: string, action: OwnerAction): Promise<Task> {
  const task = await getTask(db, uid, id);
  if (!task) throw new StoreError("That task is not in your queue.", 404);
  const patch = applyOwnerAction(task, action);
  const next = await patchTask(db, id, patch);
  const line = describeAction(action);
  if (line) await addEvent(db, id, null, "info", line);
  // Terminating a parent terminates its unfinished sub-tasks too.
  if (action.action === "cancel") {
    await db
      .from("queue_tasks")
      .update({ status: "cancelled", next_run_at: null, updated_at: new Date().toISOString() })
      .eq("user_id", uid)
      .eq("parent_id", id)
      .not("status", "in", "(completed,cancelled)");
  }
  return next;
}

function describeAction(a: OwnerAction): string {
  switch (a.action) {
    case "pause": return "Paused by you.";
    case "resume": return "Resumed by you.";
    case "cancel": return "Terminated by you.";
    case "restart": return "Restarted from the beginning by you.";
    case "run_now": return "You asked it to run now.";
    case "priority": return `Priority set to ${a.priority}.`;
    case "approve": return `Approved by you${a.note ? `: ${a.note}` : "."}`;
    case "reject": return `Declined by you${a.note ? `: ${a.note}` : "."}`;
    case "answer": return `You answered: ${a.text.slice(0, 300)}`;
    case "edit": return "Settings edited by you.";
  }
}

export async function deleteTask(db: SupabaseClient, uid: string, id: string): Promise<void> {
  const { error } = await db.from("queue_tasks").delete().eq("user_id", uid).eq("id", id);
  if (error) fail("Could not delete the task", error);
}

export async function childrenOf(db: SupabaseClient, uid: string, id: string): Promise<Task[]> {
  const { data, error } = await db
    .from("queue_tasks")
    .select("*")
    .eq("user_id", uid)
    .eq("parent_id", id)
    .order("created_at", { ascending: true });
  if (error) fail("Could not read sub-tasks", error);
  return (data ?? []) as Task[];
}

// --- runs & events -------------------------------------------------------------

export async function startRun(db: SupabaseClient, taskId: string, worker: string): Promise<string> {
  const { data, error } = await db.from("queue_runs").insert({ task_id: taskId, worker }).select("id").single();
  if (error) fail("Could not record the run", error);
  return (data as { id: string }).id;
}

export async function finishRun(
  db: SupabaseClient,
  runId: string,
  outcome: TaskRun["outcome"],
  summary: string | null,
  err: string | null,
  metrics: TaskRun["metrics"],
): Promise<void> {
  await db
    .from("queue_runs")
    .update({ finished_at: new Date().toISOString(), outcome, summary, error: err, metrics })
    .eq("id", runId);
}

export async function listRuns(db: SupabaseClient, taskId: string, limit = 40): Promise<TaskRun[]> {
  const { data, error } = await db
    .from("queue_runs")
    .select("*")
    .eq("task_id", taskId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) fail("Could not read runs", error);
  return (data ?? []) as TaskRun[];
}

export async function addEvent(
  db: SupabaseClient,
  taskId: string,
  runId: string | null,
  level: EventLevel,
  message: string,
  data?: Record<string, unknown> | null,
): Promise<void> {
  await db.from("queue_events").insert({
    task_id: taskId,
    run_id: runId,
    level,
    message: message.slice(0, 2000),
    data: data ?? null,
  });
}

export async function listEvents(db: SupabaseClient, taskId: string, limit = 200): Promise<TaskEvent[]> {
  const { data, error } = await db
    .from("queue_events")
    .select("*")
    .eq("task_id", taskId)
    .order("id", { ascending: false })
    .limit(limit);
  if (error) fail("Could not read the log", error);
  return (data ?? []) as TaskEvent[];
}

/** The latest few log lines across every task the user has — the live ticker. */
export async function recentEvents(db: SupabaseClient, taskIds: string[], limit = 30): Promise<TaskEvent[]> {
  if (!taskIds.length) return [];
  const { data, error } = await db
    .from("queue_events")
    .select("*")
    .in("task_id", taskIds.slice(0, 200))
    .order("id", { ascending: false })
    .limit(limit);
  if (error) fail("Could not read the activity feed", error);
  return (data ?? []) as TaskEvent[];
}

// --- findings ------------------------------------------------------------------

export async function upsertFinding(
  db: SupabaseClient,
  uid: string,
  taskId: string | null,
  app: string,
  f: NewFinding,
): Promise<{ id: string; isNew: boolean }> {
  const existing = await db
    .from("queue_findings")
    .select("id")
    .eq("user_id", uid)
    .eq("kind", f.kind)
    .eq("key", f.key)
    .maybeSingle();
  const row = {
    user_id: uid,
    task_id: taskId,
    app,
    kind: f.kind,
    key: f.key.slice(0, 400),
    title: f.title.slice(0, 300),
    summary: (f.summary ?? "").slice(0, 4000),
    url: f.url ?? null,
    score: f.score ?? null,
    data: f.data ?? {},
    notable: Boolean(f.notable),
  };
  if (existing.data) {
    const id = (existing.data as { id: string }).id;
    const { error } = await db.from("queue_findings").update(row).eq("id", id);
    if (error) fail("Could not update the finding", error);
    return { id, isNew: false };
  }
  const { data, error } = await db.from("queue_findings").insert(row).select("id").single();
  if (error) {
    // Lost a race with another worker writing the same key: it exists now.
    if (/duplicate key/i.test(error.message)) {
      const again = await db.from("queue_findings").select("id").eq("user_id", uid).eq("kind", f.kind).eq("key", f.key).single();
      return { id: (again.data as { id: string }).id, isNew: false };
    }
    fail("Could not save the finding", error);
  }
  return { id: (data as { id: string }).id, isNew: true };
}

export async function knownKeys(db: SupabaseClient, uid: string, kind: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await db
      .from("queue_findings")
      .select("key")
      .eq("user_id", uid)
      .eq("kind", kind)
      .in("key", keys.slice(i, i + 100));
    if (error) fail("Could not check what is already known", error);
    for (const r of (data ?? []) as { key: string }[]) out.add(r.key);
  }
  return out;
}

export async function listFindings(
  db: SupabaseClient,
  uid: string,
  opts: { taskId?: string; kind?: string; app?: string; limit?: number; notableOnly?: boolean; order?: "recent" | "score"; q?: string } = {},
): Promise<Finding[]> {
  let q = db.from("queue_findings").select("*").eq("user_id", uid);
  if (opts.taskId) q = q.eq("task_id", opts.taskId);
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.app) q = q.eq("app", opts.app);
  if (opts.notableOnly) q = q.eq("notable", true);
  if (opts.q) {
    const term = opts.q.replace(/[%,()]/g, " ").trim().slice(0, 80);
    if (term) q = q.or(`title.ilike.%${term}%,summary.ilike.%${term}%`);
  }
  q = opts.order === "score"
    ? q.order("score", { ascending: false, nullsFirst: false })
    : q.order("created_at", { ascending: false });
  const { data, error } = await q.limit(opts.limit ?? 50);
  if (error) fail("Could not read findings", error);
  return (data ?? []) as Finding[];
}

export async function markFindingsSeen(db: SupabaseClient, uid: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.from("queue_findings").update({ seen: true }).eq("user_id", uid).in("id", ids.slice(0, 200));
}

// --- messages ------------------------------------------------------------------

export async function addMessage(
  db: SupabaseClient,
  uid: string,
  role: TaskMessage["role"],
  text: string,
  taskId: string | null,
  taskIds: string[] = [],
  extra: { attachments?: { key: string; name: string }[]; model?: string | null } = {},
): Promise<TaskMessage> {
  const row: Record<string, unknown> = { user_id: uid, role, text: text.slice(0, 8000), task_id: taskId, task_ids: taskIds };
  if (extra.attachments?.length) row.attachments = extra.attachments.map((a) => ({ key: a.key, name: a.name }));
  if (extra.model) row.model = extra.model;
  const { data, error } = await db
    .from("queue_messages")
    .insert(row)
    .select("*")
    .single();
  if (error) fail("Could not save the message", error);
  return data as TaskMessage;
}

export async function listMessages(db: SupabaseClient, uid: string, taskId: string | null, limit = 40): Promise<TaskMessage[]> {
  let q = db.from("queue_messages").select("*").eq("user_id", uid);
  q = taskId ? q.eq("task_id", taskId) : q.is("task_id", null);
  const { data, error } = await q.order("at", { ascending: false }).limit(limit);
  if (error) fail("Could not read the conversation", error);
  return ((data ?? []) as TaskMessage[]).reverse();
}

// --- notifications ---------------------------------------------------------------

export async function notify(
  db: SupabaseClient,
  uid: string,
  taskId: string | null,
  title: string,
  body: string,
  link?: string,
): Promise<void> {
  await db.from("queue_notifications").insert({ user_id: uid, task_id: taskId, title: title.slice(0, 200), body: body.slice(0, 1000), link: link ?? null });
}

export interface QueueNotification {
  id: string;
  task_id: string | null;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  at: string;
}

export async function listNotifications(db: SupabaseClient, uid: string, limit = 30): Promise<QueueNotification[]> {
  const { data, error } = await db
    .from("queue_notifications")
    .select("id,task_id,title,body,link,read,at")
    .eq("user_id", uid)
    .order("at", { ascending: false })
    .limit(limit);
  if (error) fail("Could not read notifications", error);
  return (data ?? []) as QueueNotification[];
}

export async function markNotificationsRead(db: SupabaseClient, uid: string): Promise<void> {
  await db.from("queue_notifications").update({ read: true }).eq("user_id", uid).eq("read", false);
}

// --- workers -------------------------------------------------------------------

export interface WorkerRow {
  id: string;
  host: string;
  capabilities: string[];
  concurrency: number;
  running: number;
  version: string;
  metrics: Record<string, unknown>;
  started_at: string;
  seen_at: string;
}

export async function heartbeat(db: SupabaseClient, w: Omit<WorkerRow, "seen_at" | "started_at"> & { started_at?: string }): Promise<void> {
  await db.from("queue_workers").upsert({ ...w, seen_at: new Date().toISOString() }, { onConflict: "id" });
}

/** Workers seen in the last 10 minutes. */
export async function liveWorkers(db: SupabaseClient): Promise<WorkerRow[]> {
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data, error } = await db.from("queue_workers").select("*").gte("seen_at", since).order("seen_at", { ascending: false });
  if (error) fail("Could not read workers", error);
  return (data ?? []) as WorkerRow[];
}

// --- external apps ---------------------------------------------------------------

export async function listExternalApps(db: SupabaseClient, uid: string): Promise<QueueApp[]> {
  const { data, error } = await db.from("queue_apps").select("*").eq("user_id", uid).order("created_at");
  if (error) fail("Could not read connected apps", error);
  return ((data ?? []) as Omit<QueueApp, "source">[]).map((a) => ({ ...a, source: "external" as const }));
}

// ---------------------------------------------------------------------------
// 24/7 Queue engine — every state change a task can go through, as pure
// functions over (task, input, now) → patch.
//
// The worker, the API routes and the connector all call these and then write
// the patch they return, so there is exactly one answer to "what happens to a
// recurring task when a round succeeds?" or "how long does a failed step wait
// before its retry?". Tests: engine.test.ts.
//
// The execution model is STEP-BASED. A worker claims a task, runs one bounded
// step of its executor, and writes back the result. Everything an executor
// needs to continue lives in `task.state` in Postgres — never in the worker's
// memory — so a task survives the worker restarting, the VPS rebooting, the
// browser closing or the network dropping mid-step: an unfinished step's lock
// simply expires (`lock_until`) and the next worker re-runs that step.
// ---------------------------------------------------------------------------

import type { Capability, Task, TaskKind, TaskSchedule, TaskStatus, TaskStep } from "./types";
import { ALL_CAPABILITIES, TASK_KINDS } from "./types";

/** What one executor step reports back. */
export type StepResult =
  /** More to do right away; the worker may run the next step immediately. */
  | { outcome: "continue"; summary?: string }
  /** This round is finished. once/scheduled → completed; recurring/continuous → rest. */
  | { outcome: "done"; summary: string }
  /** Nothing to do until `until` (a render elsewhere, a rate limit, a dependency). */
  | { outcome: "wait"; until: string; summary?: string }
  /** Stop and ask the owner for a yes. Nothing continues until they answer. */
  | { outcome: "needs_approval"; question: string }
  /** Stop and ask the owner for information or a file. */
  | { outcome: "needs_input"; question: string }
  /** The step failed. `retryable` false = no point trying again (bad input). */
  | { outcome: "failed"; error: string; retryable: boolean };

export const DEFAULT_MAX_ATTEMPTS = 5;
/** How long a claim holds. A step that runs longer renews it (worker heartbeat). */
export const LEASE_SECONDS = 300;
export const MIN_EVERY_MINUTES = 5;
export const MAX_EVERY_MINUTES = 60 * 24 * 30;

// --- scheduling -----------------------------------------------------------

/** "HH:MM" → minutes after midnight, or null. */
export function parseClock(s: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes past midnight of `d` in zone `tz` (falls back to UTC on a bad zone). */
function minutesInZone(d: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
  } catch {
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

/**
 * The next moment a schedule fires strictly after `from`, or null when it
 * never fires again (a one-off `at` in the past).
 */
export function nextSlot(schedule: TaskSchedule, from: Date): Date | null {
  const clock = parseClock(schedule.dailyAt);
  if (clock !== null) {
    const tz = schedule.tz || "UTC";
    const nowMin = minutesInZone(from, tz);
    let delta = clock - nowMin;
    if (delta <= 0) delta += 24 * 60;
    // Whole minutes; drop the seconds so a slot lands on the minute.
    const base = new Date(from.getTime());
    base.setUTCSeconds(0, 0);
    return new Date(base.getTime() + delta * 60_000);
  }
  if (schedule.everyMinutes && schedule.everyMinutes > 0) {
    return new Date(from.getTime() + clampEvery(schedule.everyMinutes) * 60_000);
  }
  if (schedule.at) {
    const at = Date.parse(schedule.at);
    return Number.isFinite(at) && at > from.getTime() ? new Date(at) : null;
  }
  return null;
}

export function clampEvery(n: number): number {
  return Math.max(MIN_EVERY_MINUTES, Math.min(MAX_EVERY_MINUTES, Math.round(n)));
}

/** When a brand-new task should first run. */
export function firstRunAt(kind: TaskKind, schedule: TaskSchedule, now: Date): Date {
  if (kind === "scheduled" && schedule.at) {
    const at = Date.parse(schedule.at);
    if (Number.isFinite(at) && at > now.getTime()) return new Date(at);
  }
  if (kind === "recurring" && parseClock(schedule.dailyAt) !== null) {
    return nextSlot(schedule, now) ?? now;
  }
  return now;
}

/**
 * Backoff before retry n (1-based): 30 s, 1 min, 2 min, 4 min … capped at an
 * hour. Deterministic on purpose — tests and the UI ("retrying in 4 min")
 * must agree with what the worker does.
 */
export function retryDelayMs(attempt: number): number {
  const n = Math.max(1, attempt);
  return Math.min(60 * 60_000, 30_000 * 2 ** (n - 1));
}

// --- creating -------------------------------------------------------------

export interface NewTaskInput {
  title: string;
  description?: string;
  instruction?: string;
  app?: string;
  executor: string;
  agent?: string;
  kind?: TaskKind;
  priority?: number;
  config?: Record<string, unknown>;
  schedule?: TaskSchedule;
  parent_id?: string | null;
  depends_on?: string[];
  needs?: Capability[];
  steps?: string[];
  max_attempts?: number;
  created_by?: string;
}

export class TaskInputError extends Error {}

const SLUG = /^[a-z0-9][a-z0-9:_-]{0,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clip(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function cleanSchedule(s: unknown): TaskSchedule {
  const r = (s ?? {}) as Record<string, unknown>;
  const out: TaskSchedule = {};
  const every = Number(r.everyMinutes);
  if (Number.isFinite(every) && every > 0) out.everyMinutes = clampEvery(every);
  if (typeof r.dailyAt === "string" && parseClock(r.dailyAt) !== null) out.dailyAt = r.dailyAt.trim();
  if (typeof r.at === "string" && Number.isFinite(Date.parse(r.at))) out.at = new Date(r.at).toISOString();
  if (typeof r.tz === "string" && /^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/.test(r.tz)) out.tz = r.tz;
  return out;
}

/**
 * A validated row ready to insert (minus id/user_id/timestamps, which the
 * store sets). Throws TaskInputError with a plain-English reason.
 */
export function buildTask(input: NewTaskInput, now = new Date()): Omit<Task, "id" | "user_id" | "created_at" | "updated_at"> {
  const title = clip(input.title, 140);
  if (!title) throw new TaskInputError("A task needs a name.");
  const executor = clip(input.executor, 60).toLowerCase();
  if (!SLUG.test(executor)) throw new TaskInputError("A task needs an executor.");
  const kind: TaskKind = TASK_KINDS.includes(input.kind as TaskKind) ? (input.kind as TaskKind) : "once";
  const schedule = cleanSchedule(input.schedule);
  if (kind === "scheduled" && !schedule.at) throw new TaskInputError("A scheduled task needs a time to run.");
  if ((kind === "recurring" || kind === "continuous") && !schedule.everyMinutes && !schedule.dailyAt) {
    schedule.everyMinutes = kind === "continuous" ? 60 : 24 * 60;
  }
  const app = clip(input.app, 80).toLowerCase();
  if (app && !SLUG.test(app)) throw new TaskInputError(`"${app}" is not an app id.`);
  const priority = clampPriority(input.priority);
  const next = firstRunAt(kind, schedule, now);
  const steps: TaskStep[] = (input.steps ?? []).slice(0, 30).map((label, i) => ({
    id: `s${i + 1}`,
    label: clip(label, 160),
    state: "pending",
  }));
  return {
    title,
    description: clip(input.description, 2000),
    instruction: String(input.instruction ?? input.description ?? title).slice(0, 8000),
    app,
    executor,
    agent: clip(input.agent, 60) || executor,
    kind,
    status: next.getTime() > now.getTime() ? "scheduled" : "queued",
    priority,
    progress: 0,
    current_step: "",
    steps,
    config: isPlainObject(input.config) ? input.config : {},
    state: {},
    schedule,
    next_run_at: next.toISOString(),
    last_run_at: null,
    last_activity_at: now.toISOString(),
    attempts: 0,
    max_attempts: Math.max(1, Math.min(20, Math.round(input.max_attempts ?? DEFAULT_MAX_ATTEMPTS))),
    parent_id: input.parent_id && UUID.test(input.parent_id) ? input.parent_id : null,
    depends_on: (input.depends_on ?? []).filter((d) => UUID.test(d)).slice(0, 20),
    needs: (input.needs ?? []).filter((c) => ALL_CAPABILITIES.includes(c)),
    locked_by: null,
    lock_until: null,
    success_count: 0,
    failure_count: 0,
    last_error: null,
    result_summary: null,
    question: null,
    created_by: clip(input.created_by, 60) || "you",
  };
}

export function clampPriority(p: unknown): number {
  const n = Math.round(Number(p));
  return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 3;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

// --- a worker's step result -------------------------------------------------

export type TaskPatch = Partial<Omit<Task, "id" | "user_id" | "created_at">>;

/**
 * What to write after a step. The lock is always released here; `attempts`
 * counts consecutive failures and resets on any success.
 */
export function applyStepResult(task: Task, result: StepResult, now = new Date()): TaskPatch {
  const iso = now.toISOString();
  const base: TaskPatch = {
    locked_by: null,
    lock_until: null,
    last_run_at: iso,
    last_activity_at: iso,
    updated_at: iso,
  };
  // The owner paused or cancelled it while the step ran: honour that, keep what the step did.
  if (task.status === "paused" || task.status === "cancelled") {
    const keep = result.outcome === "done" || result.outcome === "continue";
    return { ...base, ...(keep && "summary" in result && result.summary ? { result_summary: result.summary } : {}) };
  }

  switch (result.outcome) {
    case "continue":
      return {
        ...base,
        status: "queued",
        next_run_at: iso,
        attempts: 0,
        last_error: null,
        ...(result.summary ? { result_summary: result.summary } : {}),
      };
    case "done": {
      const repeats = task.kind === "recurring" || task.kind === "continuous";
      const next = repeats ? nextSlot(task.schedule, now) : null;
      return {
        ...base,
        status: repeats && next ? "scheduled" : "completed",
        next_run_at: repeats && next ? next.toISOString() : null,
        attempts: 0,
        last_error: null,
        success_count: task.success_count + 1,
        result_summary: result.summary,
        question: null,
        progress: repeats ? task.progress : 100,
        current_step: repeats ? (next ? "Resting until the next round" : "Resting — no next round scheduled") : "Finished",
      };
    }
    case "wait":
      return {
        ...base,
        status: "scheduled",
        next_run_at: validFuture(result.until, now) ?? new Date(now.getTime() + 60_000).toISOString(),
        attempts: 0,
        ...(result.summary ? { result_summary: result.summary } : {}),
      };
    case "needs_approval":
      return { ...base, status: "waiting_approval", question: result.question, attempts: 0 };
    case "needs_input":
      return { ...base, status: "needs_input", question: result.question, attempts: 0 };
    case "failed": {
      const attempts = task.attempts; // the claim already counted this attempt
      const outOfTries = !result.retryable || attempts >= task.max_attempts;
      if (outOfTries) {
        // A standing workflow never dies of one bad round: it records the
        // failure and tries again next slot, so a flaky source on Tuesday
        // does not silently end a discovery agent forever.
        if (task.kind === "continuous" || task.kind === "recurring") {
          const next = nextSlot(task.schedule, now);
          return {
            ...base,
            status: next ? "scheduled" : "failed",
            next_run_at: next ? next.toISOString() : null,
            attempts: 0,
            failure_count: task.failure_count + 1,
            last_error: result.error,
          };
        }
        return {
          ...base,
          status: "failed",
          next_run_at: null,
          failure_count: task.failure_count + 1,
          last_error: result.error,
        };
      }
      return {
        ...base,
        status: "scheduled",
        next_run_at: new Date(now.getTime() + retryDelayMs(attempts)).toISOString(),
        failure_count: task.failure_count + 1,
        last_error: result.error,
      };
    }
  }
}

function validFuture(iso: string, now: Date): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  // Never more than 30 days out, never in the past.
  const capped = Math.min(Math.max(t, now.getTime() + 5_000), now.getTime() + 30 * 86_400_000);
  return new Date(capped).toISOString();
}

/** A running task whose worker vanished — its lease ran out. */
export function isLost(task: Pick<Task, "status" | "lock_until">, now = new Date()): boolean {
  return task.status === "running" && Boolean(task.lock_until) && Date.parse(task.lock_until!) < now.getTime();
}

// --- the owner's controls ----------------------------------------------------

export type OwnerAction =
  | { action: "pause" }
  | { action: "resume" }
  | { action: "cancel" }
  | { action: "restart" }
  | { action: "run_now" }
  | { action: "priority"; priority: number }
  | { action: "approve"; note?: string }
  | { action: "reject"; note?: string }
  | { action: "answer"; text: string }
  | { action: "edit"; title?: string; description?: string; schedule?: TaskSchedule; config?: Record<string, unknown>; max_attempts?: number };

export class ActionError extends Error {}

/**
 * The patch for one of the owner's buttons. Throws ActionError when the
 * button does not make sense for the task's current state, with a sentence
 * the UI can show as-is.
 */
export function applyOwnerAction(task: Task, a: OwnerAction, now = new Date()): TaskPatch {
  const iso = now.toISOString();
  const base: TaskPatch = { updated_at: iso, last_activity_at: iso };
  const finished = task.status === "completed" || task.status === "cancelled";
  switch (a.action) {
    case "pause":
      if (finished) throw new ActionError("It has already finished.");
      if (task.status === "paused") return base;
      return { ...base, status: "paused" };
    case "resume":
      if (task.status !== "paused" && task.status !== "failed") throw new ActionError("Only a paused or failed task can be resumed.");
      return { ...base, status: "queued", next_run_at: iso, attempts: 0, locked_by: null, lock_until: null };
    case "cancel":
      if (task.status === "cancelled") return base;
      return { ...base, status: "cancelled", next_run_at: null, question: null };
    case "restart":
      return {
        ...base,
        status: "queued",
        next_run_at: iso,
        attempts: 0,
        progress: 0,
        current_step: "",
        state: {},
        steps: task.steps.map((s) => ({ id: s.id, label: s.label, state: "pending" })),
        last_error: null,
        question: null,
        locked_by: null,
        lock_until: null,
      };
    case "run_now":
      if (finished || task.status === "running") throw new ActionError(task.status === "running" ? "It is running right now." : "It has already finished — use Restart.");
      return { ...base, status: "queued", next_run_at: iso, attempts: 0 };
    case "priority":
      return { ...base, priority: clampPriority(a.priority) };
    case "approve":
      if (task.status !== "waiting_approval") throw new ActionError("Nothing is waiting for your approval on this task.");
      return {
        ...base,
        status: "queued",
        next_run_at: iso,
        question: null,
        state: { ...task.state, approval: { answer: "yes", note: a.note ?? "", at: iso, question: task.question } },
      };
    case "reject":
      if (task.status !== "waiting_approval") throw new ActionError("Nothing is waiting for your approval on this task.");
      return {
        ...base,
        status: "queued",
        next_run_at: iso,
        question: null,
        state: { ...task.state, approval: { answer: "no", note: a.note ?? "", at: iso, question: task.question } },
      };
    case "answer": {
      const text = clip(a.text, 2000);
      if (!text) throw new ActionError("Type an answer first.");
      if (task.status !== "needs_input" && task.status !== "waiting_approval") {
        // Talking to a task that is not waiting is fine — it is kept as guidance for its next step.
        return { ...base, state: { ...task.state, guidance: [...guidanceOf(task), { text, at: iso }].slice(-10) } };
      }
      return {
        ...base,
        status: "queued",
        next_run_at: iso,
        question: null,
        state: { ...task.state, answers: [...answersOf(task), { q: task.question, a: text, at: iso }].slice(-10) },
      };
    }
    case "edit": {
      const patch: TaskPatch = { ...base };
      if (a.title !== undefined) {
        const t = clip(a.title, 140);
        if (!t) throw new ActionError("A task needs a name.");
        patch.title = t;
      }
      if (a.description !== undefined) patch.description = clip(a.description, 2000);
      if (a.schedule !== undefined) {
        const s = cleanSchedule(a.schedule);
        patch.schedule = s;
        if (task.status === "scheduled") {
          const next = task.kind === "scheduled" ? firstRunAt("scheduled", s, now) : nextSlot(s, now);
          if (next) patch.next_run_at = next.toISOString();
        }
      }
      if (a.config !== undefined && isPlainObject(a.config)) patch.config = { ...task.config, ...a.config };
      if (a.max_attempts !== undefined) patch.max_attempts = Math.max(1, Math.min(20, Math.round(a.max_attempts)));
      return patch;
    }
  }
}

function guidanceOf(task: Task): { text: string; at: string }[] {
  const g = task.state.guidance;
  return Array.isArray(g) ? (g as { text: string; at: string }[]) : [];
}

function answersOf(task: Task): { q: string | null; a: string; at: string }[] {
  const g = task.state.answers;
  return Array.isArray(g) ? (g as { q: string | null; a: string; at: string }[]) : [];
}

// --- what the board shows ----------------------------------------------------

export type Bucket = "attention" | "active" | "waiting" | "scheduled" | "autonomous" | "paused" | "failed" | "completed";

export const BUCKET_ORDER: Bucket[] = ["attention", "active", "waiting", "autonomous", "scheduled", "paused", "failed", "completed"];

export const BUCKET_LABEL: Record<Bucket, string> = {
  attention: "Needs you",
  active: "Running now",
  waiting: "In queue",
  scheduled: "Scheduled",
  autonomous: "24/7 workflows",
  paused: "Paused",
  failed: "Failed",
  completed: "Completed",
};

/** One bucket per task, the most urgent truth first. */
export function bucketOf(task: Pick<Task, "status" | "kind" | "lock_until">, now = new Date()): Bucket {
  if (task.status === "waiting_approval" || task.status === "needs_input") return "attention";
  if (task.status === "failed") return "failed";
  if (task.status === "paused") return "paused";
  if (task.status === "completed" || task.status === "cancelled") return "completed";
  if (task.status === "running" && !isLost(task, now)) return "active";
  if (task.kind === "continuous" || task.kind === "recurring") return "autonomous";
  if (task.status === "scheduled") return "scheduled";
  return "waiting";
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "Queued",
  scheduled: "Scheduled",
  running: "Running",
  waiting_approval: "Waiting for your OK",
  needs_input: "Needs your answer",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Terminated",
};

/** Step bookkeeping executors use: mark one step active/done with a note. */
export function markStep(steps: TaskStep[], id: string, state: TaskStep["state"], note?: string, now = new Date()): TaskStep[] {
  return steps.map((s) => (s.id === id ? { ...s, state, ...(note ? { note: clip(note, 300) } : {}), at: now.toISOString() } : s));
}

/** Progress from steps when an executor has no better measure. */
export function progressFromSteps(steps: TaskStep[]): number {
  if (!steps.length) return 0;
  const done = steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  return Math.round((done / steps.length) * 100);
}

/** Is every dependency finished? (The claim RPC checks the same thing in SQL.) */
export function dependenciesMet(task: Pick<Task, "depends_on">, statusOf: (id: string) => TaskStatus | undefined): boolean {
  return task.depends_on.every((id) => statusOf(id) === "completed");
}

export const ACTIVE_STATUSES: TaskStatus[] = ["queued", "scheduled", "running", "waiting_approval", "needs_input"];

export function isTerminal(s: TaskStatus): boolean {
  return s === "completed" || s === "cancelled" || s === "failed";
}

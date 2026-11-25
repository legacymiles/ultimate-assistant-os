// ---------------------------------------------------------------------------
// The 24/7 Queue worker — the process that actually does the work.
//
// Runs on the VPS (tools/queue-worker bundles this file), so tasks keep
// moving while the owner's PC is off and no browser is open. Any number of
// workers can run at once, on any machines: the Postgres claim (queue_claim,
// FOR UPDATE SKIP LOCKED) hands each task to exactly one of them.
//
// One loop, N slots:
//   claim a due task (skipping executors already at their per-worker limit)
//   → run ONE step of its executor under an abort signal and a time budget,
//     renewing the lease every minute (a renew that fails means the owner
//     paused/terminated it or the lease was lost — the step is aborted)
//   → write back state, steps, progress and the engine's patch, but only
//     while this worker still holds the lock
//   → record the run, its metrics and the log.
//
// Crash safety: nothing lives only in memory. A worker killed mid-step
// leaves the row "running" with a lease that expires; the next claim takes it
// and re-runs that step from the last saved state.
// ---------------------------------------------------------------------------

import os from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyStepResult, LEASE_SECONDS, type StepResult } from "../engine";
import { executorFor, EXECUTORS } from "../executors/registry";
import { STEP_BUDGET_MS, type StepContext } from "../executors/types";
import type { Capability, Task } from "../types";
import {
  addEvent,
  createTask,
  finishRun,
  getTaskById,
  heartbeat,
  knownKeys,
  listFindings,
  notify,
  startRun,
  upsertFinding,
} from "../server/store";

export interface WorkerOptions {
  id: string;
  host: string;
  capabilities: Capability[];
  concurrency: number;
  pollMs: number;
  version: string;
  /** Stop claiming new work above this resident memory (MB). */
  maxRssMb: number;
  log?: (line: string) => void;
}

interface Slot {
  task: Task;
  abort: AbortController;
  why?: "budget" | "lost" | "shutdown";
  done: Promise<void>;
}

export class QueueWorker {
  private running = new Map<string, Slot>();
  private stopping = false;
  private wake: (() => void) | null = null;
  private stats = { claimed: 0, completed: 0, failed: 0, steps: 0 };
  private startedAt = new Date().toISOString();

  constructor(private db: SupabaseClient, private opts: WorkerOptions) {}

  private say(line: string) {
    (this.opts.log ?? console.log)(`[${new Date().toISOString()}] ${line}`);
  }

  async start(): Promise<void> {
    this.say(`worker ${this.opts.id} up — caps [${this.opts.capabilities.join(", ")}], concurrency ${this.opts.concurrency}`);
    const beat = setInterval(() => void this.beat(), 30_000);
    await this.beat();
    try {
      while (!this.stopping) {
        await this.fill();
        await new Promise<void>((resolve) => {
          this.wake = resolve;
          setTimeout(resolve, this.opts.pollMs);
        });
        this.wake = null;
      }
    } finally {
      clearInterval(beat);
    }
  }

  /** Stop claiming, abort steps in flight, hand their tasks straight back. */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.wake?.();
    for (const s of this.running.values()) {
      s.why = "shutdown";
      s.abort.abort();
    }
    const all = Promise.all([...this.running.values()].map((s) => s.done));
    await Promise.race([all, new Promise((r) => setTimeout(r, 20_000))]);
    // Anything still running: release so another worker can take it at once.
    for (const s of this.running.values()) await this.release(s.task, "Worker shut down mid-step; handed back to the queue.");
    await this.beat();
    this.say("worker stopped");
  }

  private async beat() {
    const mem = process.memoryUsage();
    await heartbeat(this.db, {
      id: this.opts.id,
      host: this.opts.host,
      capabilities: this.opts.capabilities,
      concurrency: this.opts.concurrency,
      running: this.running.size,
      version: this.opts.version,
      started_at: this.startedAt,
      metrics: {
        rssMb: Math.round(mem.rss / 1048576),
        heapMb: Math.round(mem.heapUsed / 1048576),
        load: Math.round(os.loadavg()[0] * 100) / 100,
        loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
        freeMemMb: Math.round(os.freemem() / 1048576),
        totalMemMb: Math.round(os.totalmem() / 1048576),
        cpus: os.cpus().length,
        uptimeS: Math.round(process.uptime()),
        stopping: this.stopping,
        tasks: [...this.running.values()].map((s) => ({ id: s.task.id, title: s.task.title, executor: s.task.executor })),
        ...this.stats,
      },
    }).catch((e) => this.say(`heartbeat failed: ${(e as Error).message}`));
  }

  private overMemory(): boolean {
    return process.memoryUsage().rss / 1048576 > this.opts.maxRssMb;
  }

  private async fill() {
    while (!this.stopping && this.running.size < this.opts.concurrency) {
      if (this.overMemory()) {
        this.say(`memory above ${this.opts.maxRssMb} MB — not claiming until it drops`);
        return;
      }
      const task = await this.claim();
      if (!task) return;
      this.stats.claimed++;
      const abort = new AbortController();
      const slot: Slot = { task, abort, done: Promise.resolve() };
      slot.done = this.runStep(slot).finally(() => {
        this.running.delete(task.id);
        this.wake?.();
      });
      this.running.set(task.id, slot);
    }
  }

  private async claim(): Promise<Task | null> {
    const busy = new Map<string, number>();
    for (const s of this.running.values()) busy.set(s.task.executor, (busy.get(s.task.executor) ?? 0) + 1);
    const skip = EXECUTORS.filter((e) => (busy.get(e.id) ?? 0) >= e.concurrency).map((e) => e.id);
    const { data, error } = await this.db.rpc("queue_claim", {
      p_worker: this.opts.id,
      p_caps: this.opts.capabilities,
      p_lease_seconds: LEASE_SECONDS,
      p_skip_executors: skip,
    });
    if (error) {
      this.say(`claim failed: ${error.message}`);
      return null;
    }
    const rows = (data ?? []) as Task[];
    return rows[0] ?? null;
  }

  private async release(task: Task, why: string) {
    await this.db
      .from("queue_tasks")
      .update({ status: "queued", locked_by: null, lock_until: null, next_run_at: new Date().toISOString(), attempts: Math.max(0, task.attempts - 1) })
      .eq("id", task.id)
      .eq("locked_by", this.opts.id)
      .eq("status", "running");
    await addEvent(this.db, task.id, null, "warn", why);
  }

  private async runStep(slot: Slot): Promise<void> {
    const { task, abort } = slot;
    const started = Date.now();
    this.stats.steps++;
    const runId = await startRun(this.db, task.id, this.opts.id).catch(() => null);
    const ex = executorFor(task.executor);
    const meter = { aiCalls: 0, searches: 0 };
    const state: Record<string, unknown> = structuredClone(task.state ?? {});
    const steps = structuredClone(task.steps ?? []);
    let progress = task.progress;
    let currentStep = task.current_step;
    let lastProgressWrite = 0;

    const log: StepContext["log"] = async (message, data, level = "info") => {
      await addEvent(this.db, task.id, runId, level, message, data ?? null);
    };

    if (!ex) {
      await this.write(task, { outcome: "failed", error: `No executor called "${task.executor}" on this worker.`, retryable: false }, state, steps, progress, currentStep);
      if (runId) await finishRun(this.db, runId, "failed", null, `unknown executor ${task.executor}`, { ms: Date.now() - started });
      return;
    }

    const budget = setTimeout(() => {
      slot.why = "budget";
      abort.abort();
    }, STEP_BUDGET_MS + 30_000);
    const renew = setInterval(async () => {
      const { data } = await this.db.rpc("queue_renew", { p_task: task.id, p_worker: this.opts.id, p_lease_seconds: LEASE_SECONDS });
      if (data === false) {
        slot.why = "lost";
        abort.abort();
      }
    }, 60_000);

    const ctx: StepContext = {
      task,
      state,
      steps,
      signal: abort.signal,
      now: () => new Date(),
      log,
      progress: async (pct, step) => {
        progress = Math.max(0, Math.min(100, Math.round(pct)));
        if (step !== undefined) currentStep = step.slice(0, 200);
        if (Date.now() - lastProgressWrite > 1500) {
          lastProgressWrite = Date.now();
          await this.db
            .from("queue_tasks")
            .update({ progress, current_step: currentStep, steps, last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", task.id)
            .eq("locked_by", this.opts.id);
        }
      },
      finding: async (f) => {
        const r = await upsertFinding(this.db, task.user_id, task.id, task.app, f);
        if (r.isNew) await log(`Found: ${f.title}`, { findingId: r.id, kind: f.kind }, "result");
        return r;
      },
      knownKeys: (kind, keys) => knownKeys(this.db, task.user_id, kind, keys),
      spawn: async (child) => {
        const c = executorFor(child.executor);
        const t = await createTask(this.db, task.user_id, {
          ...child,
          agent: c?.agent,
          parent_id: task.id,
          needs: c?.needs,
          created_by: `task:${task.id.slice(0, 8)}`,
          steps: c?.initialSteps?.(child.config ?? {}),
        });
        await log(`Filed sub-task: ${t.title}`, { taskId: t.id }, "step");
        return t.id;
      },
      notify: (title, body, link) => notify(this.db, task.user_id, task.id, title, body, link),
      recentFindings: (o) => listFindings(this.db, task.user_id, { kind: o.kind, app: o.app, limit: o.limit ?? 20 }),
      meter,
    };

    let result: StepResult;
    try {
      result = await ex.run(ctx);
      if (abort.signal.aborted && slot.why === "budget") {
        result = { outcome: "failed", error: "The step ran past its 4-minute budget and was stopped.", retryable: true };
      }
    } catch (e) {
      const err = e as Error;
      result =
        slot.why === "budget"
          ? { outcome: "failed", error: "The step ran past its 4-minute budget and was stopped.", retryable: true }
          : { outcome: "failed", error: err.message || String(err), retryable: true };
    } finally {
      clearTimeout(budget);
      clearInterval(renew);
    }

    const ms = Date.now() - started;
    if (slot.why === "shutdown") {
      // Do not save a half-finished step: the next worker re-runs it from the last saved state.
      await this.release(task, "Worker restarting; the step will run again from where it last saved.");
      if (runId) await finishRun(this.db, runId, "lost", null, "worker shut down", { ms, ...meter });
      return;
    }
    if (slot.why === "lost") {
      // The owner paused/terminated it, or another worker owns it now. Save
      // state only if it is still ours (paused/cancelled keep locked_by).
      const fresh = await getTaskById(this.db, task.id);
      if (fresh && fresh.locked_by === this.opts.id) {
        await this.write(fresh, result, state, steps, progress, currentStep);
      }
      if (runId) await finishRun(this.db, runId, "lost", null, "stopped: paused, terminated or lease lost", { ms, ...meter });
      return;
    }

    await this.write(task, result, state, steps, progress, currentStep);
    if (result.outcome === "done") this.stats.completed++;
    if (result.outcome === "failed") this.stats.failed++;
    if (runId) {
      await finishRun(
        this.db,
        runId,
        result.outcome,
        "summary" in result ? (result.summary ?? null) : "question" in result ? result.question : null,
        result.outcome === "failed" ? result.error : null,
        { ms, rssMb: Math.round(process.memoryUsage().rss / 1048576), ...meter },
      );
    }
    this.say(`${task.executor} ${task.id.slice(0, 8)} → ${result.outcome} in ${ms} ms`);
  }

  /** Apply the engine's patch — only while this worker still holds the lock. */
  private async write(
    claimed: Task,
    result: StepResult,
    state: Record<string, unknown>,
    steps: Task["steps"],
    progress: number,
    currentStep: string,
  ) {
    const fresh = (await getTaskById(this.db, claimed.id)) ?? claimed;
    if (fresh.locked_by && fresh.locked_by !== this.opts.id) {
      await addEvent(this.db, claimed.id, null, "warn", `A step finished on ${this.opts.id} after another worker took the task over; its result was dropped.`);
      return;
    }
    // Approval/answer the owner gave while the step ran must not be overwritten.
    const merged: Record<string, unknown> = { ...state };
    for (const k of ["approval", "answers", "guidance"] as const) if (fresh.state?.[k] !== undefined) merged[k] = fresh.state[k];
    const patch = applyStepResult({ ...fresh, attempts: fresh.attempts }, result);
    const repeats = fresh.kind === "recurring" || fresh.kind === "continuous";
    const row = {
      ...patch,
      state: merged,
      steps,
      progress: patch.progress ?? (result.outcome === "done" && !repeats ? 100 : progress),
      current_step:
        patch.current_step ??
        (result.outcome === "needs_approval" ? "Waiting for your approval" : result.outcome === "needs_input" ? "Waiting for your answer" : currentStep),
    };
    const { error } = await this.db.from("queue_tasks").update(row).eq("id", claimed.id);
    if (error) {
      this.say(`could not save ${claimed.id}: ${error.message}`);
      return;
    }
    const uid = fresh.user_id;
    if (result.outcome === "failed") {
      await addEvent(this.db, claimed.id, null, "error", result.error);
      if (row.status === "failed") await notify(this.db, uid, claimed.id, `Failed: ${fresh.title}`, result.error, "/apps/jarvis#queue");
    } else if (result.outcome === "needs_approval") {
      await addEvent(this.db, claimed.id, null, "warn", `Needs your approval: ${result.question}`);
      await notify(this.db, uid, claimed.id, `Needs your OK: ${fresh.title}`, result.question, "/apps/jarvis#queue");
    } else if (result.outcome === "needs_input") {
      await addEvent(this.db, claimed.id, null, "warn", `Needs your answer: ${result.question}`);
      await notify(this.db, uid, claimed.id, `Question: ${fresh.title}`, result.question, "/apps/jarvis#queue");
    } else if (result.outcome === "done") {
      await addEvent(this.db, claimed.id, null, "result", result.summary);
    } else if (result.outcome === "wait" && result.summary) {
      await addEvent(this.db, claimed.id, null, "info", result.summary);
    }
  }
}

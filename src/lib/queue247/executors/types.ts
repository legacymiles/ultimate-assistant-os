// ---------------------------------------------------------------------------
// The executor contract — how a kind of work plugs into the 24/7 Queue.
//
// An executor runs ONE bounded step of a task and returns a StepResult. It
// must keep everything it needs to continue in `ctx.state` (saved to Postgres
// after every step) and never in module memory, because the next step may run
// on another worker, after a restart, hours later.
//
// Rules every executor follows:
//   - Report only what really happened. ctx.progress / ctx.log / ctx.finding
//     are the ONLY way anything reaches the owner's screen.
//   - Keep a step under STEP_BUDGET_MS. Long jobs are many steps.
//   - Check ctx.signal.aborted between slow calls; the worker aborts a step
//     that overruns or when the owner pauses/terminates the task.
//   - Anything irreversible or outward-facing (spending money, live trading,
//     posting, emailing) returns { outcome: "needs_approval" } first, and
//     reads the answer from ctx.state.approval on the next step.
// ---------------------------------------------------------------------------

import type { StepResult } from "../engine";
import type { Capability, Finding, Task, TaskStep } from "../types";

export const STEP_BUDGET_MS = 4 * 60_000;

export interface NewFinding {
  kind: string;
  /** Stable de-duplication key; an existing (user, kind, key) is updated, not duplicated. */
  key: string;
  title: string;
  summary: string;
  url?: string | null;
  score?: number | null;
  data?: Record<string, unknown>;
  notable?: boolean;
}

export interface ChildTask {
  title: string;
  executor: string;
  description?: string;
  instruction?: string;
  app?: string;
  config?: Record<string, unknown>;
  kind?: Task["kind"];
  priority?: number;
}

export interface StepContext {
  task: Task;
  /** Mutable durable state. Saved after the step whatever the outcome. */
  state: Record<string, unknown>;
  /** Mutable step list. Saved after the step. */
  steps: TaskStep[];
  signal: AbortSignal;
  now: () => Date;
  log: (message: string, data?: Record<string, unknown>, level?: "info" | "step" | "warn" | "error" | "result") => Promise<void>;
  /** 0–100 plus the line the card shows under the title. */
  progress: (pct: number, currentStep?: string) => Promise<void>;
  /** Insert or update a finding. Returns whether it was NEW (never seen before). */
  finding: (f: NewFinding) => Promise<{ id: string; isNew: boolean }>;
  /** Findings this user already has of a kind — the memory that stops repeat work. */
  knownKeys: (kind: string, keys: string[]) => Promise<Set<string>>;
  /** File a sub-task under this one. */
  spawn: (child: ChildTask) => Promise<string>;
  /** Tell the owner (in-app notification + daily log). */
  notify: (title: string, body: string, link?: string) => Promise<void>;
  /** Read previous findings for context (most recent first). */
  recentFindings: (opts: { kind?: string; app?: string; limit?: number }) => Promise<Finding[]>;
  /** Count of AI calls / searches made this step, for the run's metrics. */
  meter: { aiCalls: number; searches: number };
}

export interface Executor {
  id: string;
  /** Shown as the agent on the card. */
  agent: string;
  /** One line for the planner: what this executor can do. */
  describe: string;
  /** Config keys the planner may set, each with a one-line meaning. */
  configHelp: Record<string, string>;
  /** Machine abilities a worker must have to run it. */
  needs: Capability[];
  /** Default kind when the planner does not say. */
  defaultKind: Task["kind"];
  /** At most this many of this executor run at once per worker. */
  concurrency: number;
  /** Steps shown on a new task, before it starts. */
  initialSteps?: (config: Record<string, unknown>) => string[];
  run: (ctx: StepContext) => Promise<StepResult>;
}

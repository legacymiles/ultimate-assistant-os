// ---------------------------------------------------------------------------
// 24/7 Queue — the shapes every part of the engine agrees on.
//
// One task is one row in public.queue_tasks. The browser, the API, the
// jarvis-memory connector, the app-integration API and the VPS worker all
// read and write that row, and every state change folds through the pure
// functions in engine.ts, so no two of them can disagree about what a status
// means or when a task runs next.
//
// Nothing in here is shown as progress unless a worker actually reported it:
// `progress`, `current_step`, `steps`, `success_count` and the event log are
// written only by the executor that did the work (worker/runStep.ts).
// ---------------------------------------------------------------------------

/**
 * How a task lives.
 *
 * once        — runs until it is done, then stays done.
 * scheduled   — runs once, at `schedule.at`.
 * recurring   — runs, rests until the next slot of `schedule`, runs again.
 * continuous  — a standing workflow: every round picks up from the state the
 *               last round left (cursor, seen items, findings) and goes again
 *               after `schedule.everyMinutes`. Never "completed" by itself.
 */
export type TaskKind = "once" | "scheduled" | "recurring" | "continuous";

export const TASK_KINDS: TaskKind[] = ["once", "scheduled", "recurring", "continuous"];

/**
 * queued            — waiting for a worker.
 * scheduled         — resting until `next_run_at` (a future slot, a retry backoff).
 * running           — a worker holds the lock right now.
 * waiting_approval  — the executor stopped at something only the owner may say yes to.
 * needs_input       — the executor needs an answer or a file it cannot find itself.
 * paused            — the owner stopped it. No worker may take it.
 * completed         — finished for good (once / scheduled kinds).
 * failed            — out of retries. Needs attention.
 * cancelled         — the owner terminated it.
 */
export type TaskStatus =
  | "queued"
  | "scheduled"
  | "running"
  | "waiting_approval"
  | "needs_input"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export const ALL_STATUSES: TaskStatus[] = [
  "queued",
  "scheduled",
  "running",
  "waiting_approval",
  "needs_input",
  "paused",
  "completed",
  "failed",
  "cancelled",
];

/** Statuses a worker may claim from (when due and unlocked). */
export const CLAIMABLE: TaskStatus[] = ["queued", "scheduled", "running"];

/** What a worker machine can do. A task names what it needs; a worker says what it has. */
export type Capability = "ai" | "web" | "ffmpeg" | "ytdlp" | "storage" | "mt4" | "shell";

export const ALL_CAPABILITIES: Capability[] = ["ai", "web", "ffmpeg", "ytdlp", "storage", "mt4", "shell"];

export interface TaskSchedule {
  /** Recurring / continuous: rest this many minutes between rounds. */
  everyMinutes?: number;
  /** Recurring: run daily at this wall-clock time, "HH:MM", in `tz`. */
  dailyAt?: string;
  /** Scheduled: the one moment it runs, ISO. */
  at?: string;
  /** IANA zone for dailyAt. Default UTC. */
  tz?: string;
}

export type StepState = "pending" | "active" | "done" | "failed" | "skipped";

export interface TaskStep {
  id: string;
  label: string;
  state: StepState;
  /** One line on what came of it. */
  note?: string;
  at?: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string;
  /** The owner's own words, kept verbatim forever. */
  instruction: string;
  /** Catalog slug or registered external app id. "" = not tied to one project. */
  app: string;
  /** Which executor runs it (executors/registry.ts). */
  executor: string;
  /** The agent's display name, shown on the card ("Research agent"). */
  agent: string;
  kind: TaskKind;
  status: TaskStatus;
  /** 1 (low) … 5 (urgent). Higher is claimed first. */
  priority: number;
  progress: number;
  current_step: string;
  steps: TaskStep[];
  /** What the owner configured: inputs, sources, substitutions, limits. */
  config: Record<string, unknown>;
  /** The executor's durable memory between rounds: cursors, seen ids, partial work. */
  state: Record<string, unknown>;
  schedule: TaskSchedule;
  next_run_at: string | null;
  last_run_at: string | null;
  last_activity_at: string | null;
  attempts: number;
  max_attempts: number;
  parent_id: string | null;
  depends_on: string[];
  needs: Capability[];
  locked_by: string | null;
  lock_until: string | null;
  success_count: number;
  failure_count: number;
  last_error: string | null;
  result_summary: string | null;
  /** The question waiting on the owner, when waiting_approval / needs_input. */
  question: string | null;
  /** Who filed it: "you", "jarvis", "app:<slug>", "connector". */
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type RunOutcome = "continue" | "done" | "wait" | "needs_approval" | "needs_input" | "failed" | "lost";

export interface TaskRun {
  id: string;
  task_id: string;
  worker: string;
  started_at: string;
  finished_at: string | null;
  outcome: RunOutcome | null;
  summary: string | null;
  error: string | null;
  /** Resource use the worker measured for this run. */
  metrics: { ms?: number; rssMb?: number; aiCalls?: number; searches?: number };
}

export type EventLevel = "info" | "step" | "warn" | "error" | "result";

export interface TaskEvent {
  id: number;
  task_id: string;
  run_id: string | null;
  at: string;
  level: EventLevel;
  message: string;
  data: Record<string, unknown> | null;
}

/**
 * A durable result an executor produced: a ranked EA, a storyboard, a
 * research note, a monitor alert. Findings are what "what has Jarvis
 * discovered?" is read from, and what later tasks read so they do not redo
 * work (memory.ts).
 */
export interface Finding {
  id: string;
  task_id: string;
  user_id: string;
  app: string;
  /** "mt4-bot", "h3-storyboard", "research-note", "repo", "alert", … */
  kind: string;
  /** Stable identity for de-duplication ("github:owner/repo@sha", a URL hash). */
  key: string;
  title: string;
  summary: string;
  url: string | null;
  score: number | null;
  /** Kind-specific body: scores, prompts, analysis. */
  data: Record<string, unknown>;
  /** Interesting enough to tell the owner about. */
  notable: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskMessage {
  id: string;
  task_id: string | null;
  user_id: string;
  role: "you" | "jarvis";
  text: string;
  /** Tasks this message created or acted on. */
  task_ids: string[];
  at: string;
  /** Reference pictures the owner attached (bucket `queue-247`, refs/<uid>/…). `url` is a short-lived signed link. */
  attachments?: MessageAttachment[];
  /** The model that wrote a Jarvis reply; "offline" when the offline planner did; null on older messages. */
  model?: string | null;
}

export interface MessageAttachment {
  key: string;
  name: string;
  url?: string;
}

/** An app connected to the queue — a hub app or an outside site with a key. */
export interface QueueApp {
  id: string;
  user_id: string;
  name: string;
  /** "hub" = from the catalog; "external" = registered through the API. */
  source: "hub" | "external";
  url: string | null;
  description: string;
  /** Task types the app can take or submit, in its own words. */
  capabilities: string[];
  /** Updates about tasks this app submitted are POSTed here. */
  callback_url: string | null;
  last_seen_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// 24/7 Queue — what the command center shows, worked out from what the API
// returned. Pure: no fetch, no DOM, no clock of its own (every function that
// needs "now" takes it), so the board, the drawer and the tests agree.
//
// Nothing here invents a number. A progress bar exists only when a worker
// reported `progress`; a worker's load exists only when its heartbeat carried
// one; a count is a count of real rows.
// ---------------------------------------------------------------------------

import { BUCKET_ORDER, bucketOf, type Bucket } from "./engine";
import type { Finding, Task, TaskEvent, TaskSchedule } from "./types";

// --- the shapes GET /api/queue247/tasks returns ------------------------------

export interface WorkerMetrics {
  rssMb?: number;
  load?: number;
  freeMemMb?: number;
  totalMemMb?: number;
  cpus?: number;
  uptimeS?: number;
  tasks?: string[];
  claimed?: number;
  completed?: number;
  failed?: number;
}

export interface QueueWorker {
  id: string;
  host: string;
  capabilities: string[];
  concurrency: number;
  running: number;
  version?: string;
  metrics: WorkerMetrics | Record<string, unknown>;
  started_at?: string;
  seen_at: string;
}

export interface QueueNotice {
  id: string;
  task_id: string | null;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  at: string;
}

export interface AppRef {
  id: string;
  name: string;
  source: "hub" | "external";
  executors: string[];
  url: string | null;
}

export interface ExecutorRef {
  id: string;
  agent: string;
  describe: string;
  configHelp: Record<string, string>;
  needs: string[];
  defaultKind: Task["kind"];
}

/** A finding as the API sends it — the row carries `seen` though the type does not. */
export type SeenFinding = Finding & { seen?: boolean };

export interface QueueSnapshot {
  tasks: Task[];
  workers: QueueWorker[];
  events: TaskEvent[];
  findings: SeenFinding[];
  notifications: QueueNotice[];
  apps: AppRef[];
  executors: ExecutorRef[];
  now: string;
}

// --- time -------------------------------------------------------------------

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now", "4 min ago", "3 h ago", "yesterday", "6 d ago", "in 12 min", "in 2 h". */
export function relTime(iso: string | null | undefined, now: Date): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = t - now.getTime();
  const a = Math.abs(d);
  if (a < 45_000) return d > 0 ? "in a moment" : "just now";
  let s: string;
  if (a < HOUR) s = `${Math.round(a / MIN)} min`;
  else if (a < DAY) s = `${Math.round(a / HOUR)} h`;
  else if (d < 0 && a < 2 * DAY) return "yesterday";
  else if (d > 0 && a < 2 * DAY) return "tomorrow";
  else s = `${Math.round(a / DAY)} d`;
  return d > 0 ? `in ${s}` : `${s} ago`;
}

/** 850 → "850 ms", 4200 → "4.2 s", 95000 → "1 m 35 s", 7.2e6 → "2 h 0 m". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < MIN) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  if (ms < HOUR) return `${Math.floor(ms / MIN)} m ${Math.round((ms % MIN) / 1000)} s`;
  return `${Math.floor(ms / HOUR)} h ${Math.round((ms % HOUR) / MIN)} m`;
}

/** Uptime in seconds → "3 d 4 h", "5 h 12 m", "14 m". */
export function formatUptime(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s) || s < 0) return "—";
  const ms = s * 1000;
  if (ms >= DAY) return `${Math.floor(ms / DAY)} d ${Math.floor((ms % DAY) / HOUR)} h`;
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)} h ${Math.floor((ms % HOUR) / MIN)} m`;
  return `${Math.max(0, Math.floor(ms / MIN))} m`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// --- schedule and next run ----------------------------------------------------

/** How a schedule reads in a sentence: "every 30 min", "daily at 09:00 UTC", "once, 3 Dec 14:00". */
export function scheduleText(kind: Task["kind"], s: TaskSchedule | null | undefined): string {
  const sch = s ?? {};
  if (kind === "once") return "One-off";
  if (kind === "scheduled") {
    if (!sch.at) return "Once, time not set";
    const d = new Date(sch.at);
    return Number.isFinite(d.getTime())
      ? `Once, ${d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
      : "Once, time not set";
  }
  const parts: string[] = [];
  if (sch.dailyAt) parts.push(`daily at ${sch.dailyAt}${sch.tz ? ` ${sch.tz}` : " UTC"}`);
  if (sch.everyMinutes) parts.push(`every ${everyText(sch.everyMinutes)}`);
  const base = parts.join(", ") || "as soon as a worker is free";
  return kind === "continuous" ? `24/7 — ${base}` : `Recurring — ${base}`;
}

/** 30 → "30 min", 90 → "1 h 30 min", 1440 → "day", 2880 → "2 days". */
export function everyText(m: number): string {
  if (m % 1440 === 0) return m === 1440 ? "day" : `${m / 1440} days`;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : h === 1 ? "hour" : `${h} h`;
  }
  return `${m} min`;
}

/** The "next run" cell. Always a short phrase; never a fake time. */
export function nextRunText(t: Pick<Task, "status" | "kind" | "next_run_at">, now: Date): string {
  switch (t.status) {
    case "running":
      return "Running now";
    case "paused":
      return "Paused";
    case "completed":
      return "Done";
    case "cancelled":
      return "Terminated";
    case "failed":
      return "Stopped — failed";
    case "waiting_approval":
    case "needs_input":
      return "After you answer";
  }
  if (!t.next_run_at) return t.status === "queued" ? "Next free worker" : "Not scheduled";
  const due = Date.parse(t.next_run_at);
  if (!Number.isFinite(due) || due <= now.getTime()) return "Next free worker";
  return relTime(t.next_run_at, now);
}

// --- history ----------------------------------------------------------------

export interface History {
  ok: number;
  fail: number;
  total: number;
  /** 0–1, or null when it has never run. */
  rate: number | null;
}

export function historyOf(t: Pick<Task, "success_count" | "failure_count">): History {
  const ok = Math.max(0, Math.round(t.success_count || 0));
  const fail = Math.max(0, Math.round(t.failure_count || 0));
  const total = ok + fail;
  return { ok, fail, total, rate: total ? ok / total : null };
}

// --- the visual state of one task ------------------------------------------

/**
 * The eight looks a task can have on the board. Each has its own mark
 * (StatusMark in the UI), a colour and a word, so a state is never colour alone.
 */
export type Tone = "running" | "queued" | "scheduled" | "always" | "paused" | "failed" | "needs" | "done" | "cancelled";

export const TONE_LABEL: Record<Tone, string> = {
  running: "Running",
  queued: "Queued",
  scheduled: "Scheduled",
  always: "24/7",
  paused: "Paused",
  failed: "Failed",
  needs: "Needs you",
  done: "Completed",
  cancelled: "Terminated",
};

export function toneOf(t: Pick<Task, "status" | "kind" | "lock_until">, now: Date): Tone {
  switch (t.status) {
    case "waiting_approval":
    case "needs_input":
      return "needs";
    case "failed":
      return "failed";
    case "paused":
      return "paused";
    case "completed":
      return "done";
    case "cancelled":
      return "cancelled";
    case "running":
      // A lock that ran out is a lost worker: the task is back in line.
      if (bucketOf(t, now) === "active") return "running";
      break;
  }
  if (t.kind === "continuous" || t.kind === "recurring") return "always";
  if (t.status === "scheduled") return "scheduled";
  return "queued";
}

/** Only a real reported number is a bar. Null means "draw no bar". */
export function progressOf(t: Pick<Task, "progress" | "status">): number | null {
  const p = Number(t.progress);
  if (!Number.isFinite(p) || p <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(p)));
}

/** The step a task is on, from current_step or the active step in its list. */
export function currentStepOf(t: Pick<Task, "current_step" | "steps">): string {
  if (t.current_step?.trim()) return t.current_step.trim();
  const active = (t.steps ?? []).find((s) => s.state === "active");
  return active?.label ?? "";
}

export function stepCounts(t: Pick<Task, "steps">): { done: number; total: number } {
  const steps = t.steps ?? [];
  return { done: steps.filter((s) => s.state === "done" || s.state === "skipped").length, total: steps.length };
}

// --- grouping and filtering ---------------------------------------------------

export interface BoardFilter {
  app: string; // "" = every app
  bucket: Bucket | ""; // "" = every status
  q: string;
}

export const EMPTY_FILTER: BoardFilter = { app: "", bucket: "", q: "" };

export function matchesFilter(t: Task, f: BoardFilter, now: Date): boolean {
  if (f.app && t.app !== f.app) return false;
  if (f.bucket && bucketOf(t, now) !== f.bucket) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = `${t.title} ${t.description} ${t.agent} ${t.app} ${t.current_step} ${t.instruction}`.toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const ts = (iso: string | null | undefined, fallback = 0) => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/** Order inside a bucket: the thing you would look at first, first. */
function bucketSort(b: Bucket): (x: Task, y: Task) => number {
  switch (b) {
    case "scheduled":
    case "autonomous":
      return (x, y) => ts(x.next_run_at, Infinity) - ts(y.next_run_at, Infinity) || y.priority - x.priority;
    case "waiting":
    case "active":
      return (x, y) => y.priority - x.priority || ts(x.created_at) - ts(y.created_at);
    default:
      return (x, y) => ts(y.last_activity_at ?? y.updated_at) - ts(x.last_activity_at ?? x.updated_at);
  }
}

export interface BucketGroup {
  bucket: Bucket;
  tasks: Task[];
}

/** Every bucket in BUCKET_ORDER (empty ones included, so counts read 0), sorted inside. Sub-tasks stay under their parent. */
export function groupByBucket(tasks: Task[], now: Date): BucketGroup[] {
  const map = new Map<Bucket, Task[]>(BUCKET_ORDER.map((b) => [b, []]));
  for (const t of tasks) map.get(bucketOf(t, now))!.push(t);
  return BUCKET_ORDER.map((b) => ({ bucket: b, tasks: map.get(b)!.sort(bucketSort(b)) }));
}

// --- the ecosystem overview -------------------------------------------------

export interface WorkerView {
  id: string;
  host: string;
  running: number;
  concurrency: number;
  /** 1-minute load average / cpus as 0–100, or null when not reported. */
  loadPct: number | null;
  load: number | null;
  cpus: number | null;
  /** Used memory as 0–100, or null. */
  memPct: number | null;
  memUsedMb: number | null;
  totalMemMb: number | null;
  rssMb: number | null;
  uptime: string;
  seen: string;
  /** No heartbeat for over two minutes. */
  stale: boolean;
  completed: number | null;
  failed: number | null;
  capabilities: string[];
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function workerView(w: QueueWorker, now: Date): WorkerView {
  const m = (w.metrics ?? {}) as Record<string, unknown>;
  const load = num(m.load);
  const cpus = num(m.cpus);
  const total = num(m.totalMemMb);
  const free = num(m.freeMemMb);
  const used = total != null && free != null ? Math.max(0, total - free) : null;
  return {
    id: w.id,
    host: w.host || w.id,
    running: Math.max(0, w.running || 0),
    concurrency: Math.max(1, w.concurrency || 1),
    load,
    cpus,
    loadPct: load != null && cpus ? Math.min(100, Math.round((load / cpus) * 100)) : null,
    memPct: used != null && total ? Math.min(100, Math.round((used / total) * 100)) : null,
    memUsedMb: used,
    totalMemMb: total,
    rssMb: num(m.rssMb),
    uptime: formatUptime(num(m.uptimeS)),
    seen: relTime(w.seen_at, now),
    stale: now.getTime() - ts(w.seen_at) > 2 * MIN,
    completed: num(m.completed),
    failed: num(m.failed),
    capabilities: Array.isArray(w.capabilities) ? w.capabilities : [],
  };
}

export interface AppWorkflows {
  app: string;
  name: string;
  count: number;
  running: number;
}

export interface Ecosystem {
  running: Task[];
  needsYou: Task[];
  autonomous: AppWorkflows[];
  autonomousTotal: number;
  queued: number;
  completedToday: number;
  failed: number;
  workers: WorkerView[];
  /** Notable first, then newest. */
  discoveries: SeenFinding[];
  unseen: number;
  unread: number;
  /** One sentence: what Jarvis is doing right now. */
  headline: string;
}

export function appName(id: string, apps: AppRef[]): string {
  if (!id) return "No app";
  return apps.find((a) => a.id === id)?.name ?? id;
}

const isAutonomous = (t: Task) =>
  (t.kind === "continuous" || t.kind === "recurring") && !["paused", "cancelled", "completed", "failed"].includes(t.status);

export function ecosystem(s: QueueSnapshot, now: Date): Ecosystem {
  const tasks = s.tasks ?? [];
  const running = tasks.filter((t) => bucketOf(t, now) === "active").sort((a, b) => b.priority - a.priority);
  const needsYou = tasks
    .filter((t) => t.status === "waiting_approval" || t.status === "needs_input")
    .sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
  const byApp = new Map<string, AppWorkflows>();
  for (const t of tasks.filter(isAutonomous)) {
    const key = t.app || "";
    const row = byApp.get(key) ?? { app: key, name: appName(key, s.apps ?? []), count: 0, running: 0 };
    row.count += 1;
    if (t.status === "running") row.running += 1;
    byApp.set(key, row);
  }
  const autonomous = [...byApp.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  // Finished today: one-offs that completed today, plus recurring / 24/7
  // workflows whose last round ended well today (they rest as "scheduled",
  // so their status alone never says "completed").
  const completedToday = tasks.filter((t) => {
    if (t.status === "completed") return isSameDay(new Date(ts(t.updated_at)), now);
    const repeats = t.kind === "recurring" || t.kind === "continuous";
    return repeats && t.success_count > 0 && !t.last_error && Boolean(t.last_run_at) && isSameDay(new Date(ts(t.last_run_at!)), now) && t.status === "scheduled";
  }).length;
  const findings = s.findings ?? [];
  const discoveries = [...findings].sort(
    (a, b) => Number(b.notable) - Number(a.notable) || ts(b.created_at) - ts(a.created_at),
  );
  const workers = (s.workers ?? []).map((w) => workerView(w, now));
  return {
    running,
    needsYou,
    autonomous,
    autonomousTotal: autonomous.reduce((n, a) => n + a.count, 0),
    queued: tasks.filter((t) => bucketOf(t, now) === "waiting").length,
    completedToday,
    failed: tasks.filter((t) => t.status === "failed").length,
    workers,
    discoveries,
    unseen: findings.filter((f) => f.seen === false).length,
    unread: (s.notifications ?? []).filter((n) => !n.read).length,
    headline: headlineOf(running, needsYou, workers, tasks.length),
  };
}

function headlineOf(running: Task[], needs: Task[], workers: WorkerView[], total: number): string {
  if (!total) return "Nothing in the queue yet. Tell Jarvis what you want done.";
  const live = workers.filter((w) => !w.stale).length;
  if (running.length) {
    const first = running[0];
    const rest = running.length - 1;
    const step = currentStepOf(first);
    return `Working on “${first.title}”${step ? ` — ${step}` : ""}${rest > 0 ? `, and ${rest} more` : ""}.`;
  }
  if (needs.length) return `Waiting on you: ${needs.length === 1 ? `“${needs[0].title}”` : `${needs.length} tasks`}.`;
  if (!live) return "No worker online — tasks wait until the VPS worker is running.";
  return "Idle — every task is resting until its next slot.";
}

// --- activity -------------------------------------------------------------

export interface TickerItem extends TaskEvent {
  taskTitle: string;
}

export function tickerItems(events: TaskEvent[], tasks: Task[], limit = 40): TickerItem[] {
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  return [...events]
    .sort((a, b) => ts(b.at) - ts(a.at) || b.id - a.id)
    .slice(0, limit)
    .map((e) => ({ ...e, taskTitle: titles.get(e.task_id) ?? "A finished task" }));
}

export interface Tick {
  /** 0 = start of the window, 1 = now. */
  x: number;
  level: TaskEvent["level"];
}

/** Where each event of the last `windowMin` minutes falls on a 0–1 line. Older events are dropped. */
export function activityTicks(events: TaskEvent[], now: Date, windowMin = 60): Tick[] {
  const end = now.getTime();
  const start = end - windowMin * MIN;
  return events
    .map((e) => ({ t: ts(e.at, -1), level: e.level }))
    .filter((e) => e.t >= start && e.t <= end)
    .map((e) => ({ x: (e.t - start) / (end - start), level: e.level }))
    .sort((a, b) => a.x - b.x);
}

// --- results ------------------------------------------------------------

/** A score may arrive as a number or as { value, why }. */
export function scoreOf(v: unknown): number | null {
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) return num((v as { value: unknown }).value);
  return num(v);
}

export interface Mt4Row {
  id: string;
  title: string;
  url: string | null;
  score: number | null;
  quality: number | null;
  reliability: number | null;
  risk: number | null;
  strategyScore: number | null;
  strategy: string[];
  flags: { label: string; severity: string }[];
  verdict: string;
  backtest: { status: string; why: string } | null;
  sources: string[];
  at: string;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String((x as { url?: string; label?: string })?.url ?? (x as { label?: string })?.label ?? ""))).filter(Boolean) : [];
}

export function mt4Rows(findings: Finding[]): Mt4Row[] {
  return findings
    .filter((f) => f.kind === "mt4-bot")
    .map((f) => {
      const d = (f.data ?? {}) as Record<string, unknown>;
      const scores = (d.scores ?? {}) as Record<string, unknown>;
      const flags = Array.isArray(d.flags)
        ? (d.flags as unknown[]).map((x) =>
            typeof x === "string"
              ? { label: x, severity: "warn" }
              : { label: String((x as { label?: string }).label ?? (x as { id?: string }).id ?? ""), severity: String((x as { severity?: string }).severity ?? "warn") },
          ).filter((x) => x.label)
        : [];
      const bt = d.backtest as { status?: unknown; why?: unknown } | undefined;
      return {
        id: f.id,
        title: f.title,
        url: f.url,
        score: f.score,
        quality: scoreOf(scores.quality),
        reliability: scoreOf(scores.reliability),
        risk: scoreOf(scores.risk),
        strategyScore: scoreOf(scores.strategy),
        strategy: strList(d.strategy),
        flags,
        verdict: typeof d.verdict === "string" ? d.verdict : f.summary,
        backtest: bt && bt.status ? { status: String(bt.status), why: String(bt.why ?? "") } : null,
        sources: strList(d.sources),
        at: f.created_at,
      };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

export interface H3PromptView {
  id: string;
  title: string;
  summary: string;
  prompt: string;
  variations: { n: number; label: string; prompt: string }[];
}

export function h3Prompts(findings: Finding[]): H3PromptView[] {
  return findings
    .filter((f) => f.kind === "h3-prompt")
    .map((f) => {
      const d = (f.data ?? {}) as Record<string, unknown>;
      const vars = Array.isArray(d.variations) ? (d.variations as unknown[]) : [];
      return {
        id: f.id,
        title: f.title,
        summary: f.summary,
        prompt: typeof d.prompt === "string" ? d.prompt : "",
        variations: vars
          .map((v, i) =>
            typeof v === "string"
              ? { n: i + 1, label: `Variation ${i + 1}`, prompt: v }
              : { n: num((v as { n?: unknown }).n) ?? i + 1, label: String((v as { label?: unknown }).label ?? `Variation ${i + 1}`), prompt: String((v as { prompt?: unknown }).prompt ?? "") },
          )
          .filter((v) => v.prompt),
      };
    })
    .sort((a, b) => shotNo(a.title) - shotNo(b.title));
}

function shotNo(title: string): number {
  const m = /shot\s*(\d+)/i.exec(title);
  return m ? Number(m[1]) : 9999;
}

export interface ShotView {
  n: number;
  start: number;
  end: number;
  camera: string;
  movement: string;
  action: string;
  environment: string;
  lighting: string;
  frames: string[];
}

export function storyboardShots(f: Finding): { shots: ShotView[]; style: string; pacing: string; total: number | null } {
  const sb = ((f.data ?? {}) as { storyboard?: Record<string, unknown> }).storyboard ?? {};
  const shots = Array.isArray(sb.shots) ? (sb.shots as Record<string, unknown>[]) : [];
  return {
    style: String(sb.style ?? ""),
    pacing: String(sb.pacing ?? ""),
    total: num(sb.totalDuration),
    shots: shots.map((s, i) => ({
      n: num(s.n) ?? i + 1,
      start: num(s.start) ?? 0,
      end: num(s.end) ?? 0,
      camera: String(s.camera ?? ""),
      movement: String(s.movement ?? ""),
      action: String(s.action ?? ""),
      environment: String(s.environment ?? ""),
      lighting: String(s.lighting ?? ""),
      frames: strList(s.frames),
    })),
  };
}

export interface NoteView {
  title: string;
  url: string | null;
  summary: string;
  score: number | null;
}

/** Research notes for a digest finding (data.notes) or a plain note/repo finding. */
export function notesOf(f: Finding): NoteView[] {
  const d = (f.data ?? {}) as Record<string, unknown>;
  if (Array.isArray(d.notes)) {
    return (d.notes as Record<string, unknown>[]).map((n) => ({
      title: String(n.title ?? n.url ?? "Note"),
      url: typeof n.url === "string" ? n.url : null,
      summary: String(n.summary ?? n.snippet ?? ""),
      score: num(n.score),
    }));
  }
  return [{ title: f.title, url: f.url, summary: f.summary, score: f.score }];
}

export const FINDING_KIND_LABEL: Record<string, string> = {
  "mt4-bot": "MT4 bots",
  "h3-storyboard": "H3 storyboards",
  "h3-prompt": "H3 prompts",
  "research-note": "Research notes",
  "research-digest": "Research digests",
  repo: "Repositories",
  alert: "Alerts",
  report: "Reports",
};

export function findingKindLabel(kind: string): string {
  return FINDING_KIND_LABEL[kind] ?? kind.replace(/[-_]/g, " ");
}

// --- the per-task config form -------------------------------------------------

/**
 * Config values the form edits as text. Strings stay strings; numbers,
 * booleans, arrays and objects are written as JSON so they come back intact.
 */
export function configToFields(config: Record<string, unknown>, help: Record<string, string>): { key: string; value: string; help: string }[] {
  const keys = [...new Set([...Object.keys(help ?? {}), ...Object.keys(config ?? {})])];
  return keys.map((key) => {
    const v = config?.[key];
    return {
      key,
      help: help?.[key] ?? "",
      value: v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v),
    };
  });
}

/** Back from the text fields. Blank fields are left out; JSON-looking text is parsed when it parses. */
export function fieldsToConfig(fields: { key: string; value: string }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, value } of fields) {
    const v = value.trim();
    if (!key.trim() || !v) continue;
    if (/^[[{]/.test(v) || /^-?\d+(\.\d+)?$/.test(v) || v === "true" || v === "false") {
      try {
        out[key] = JSON.parse(v);
        continue;
      } catch {
        /* keep as text */
      }
    }
    out[key] = v;
  }
  return out;
}

/** A compact count: 999 → "999", 1284 → "1.3K", 12900 → "13K". */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1000) return String(Math.round(n));
  if (Math.abs(n) < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (Math.abs(n) < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

// ---------------------------------------------------------------------------
// Jarvis as task commander — the pure half.
//
// The owner says what they want in plain words. Jarvis (one AI call, see
// server/command.ts) answers with a PLAN: a reply, maybe a clarifying
// question, the tasks to file (each with an app, an executor, a kind and a
// schedule, and which other new tasks it waits for), and actions on tasks
// that already exist ("pause the MT4 one", "make it run every 2 hours").
//
// Everything a model returns is untrusted: `normalizePlan` keeps only
// executors that exist, apps that exist, sane kinds and schedules, and drops
// tasks that duplicate something already running — the memory that stops the
// same research being started twice. `offlinePlan` is the no-AI planner, so
// the command bar still works (more literally) with no key.
// ---------------------------------------------------------------------------

import type { KnownApp } from "./apps";
import { findApp } from "./apps";
import { cleanSchedule, clampPriority, type OwnerAction } from "./engine";
import type { Task, TaskKind, TaskSchedule } from "./types";
import { TASK_KINDS } from "./types";

export interface PlannedTask {
  ref: string;
  title: string;
  description: string;
  instruction: string;
  app: string;
  executor: string;
  kind: TaskKind;
  schedule: TaskSchedule;
  priority: number;
  config: Record<string, unknown>;
  dependsOn: string[];
}

export interface PlannedAction {
  taskId: string;
  act: OwnerAction;
}

export interface Plan {
  reply: string;
  clarify: string | null;
  tasks: PlannedTask[];
  actions: PlannedAction[];
  /** Planned tasks dropped because the same work is already queued — told to the owner. */
  duplicates: { title: string; existing: string }[];
}

export interface PlannerExecutor {
  id: string;
  agent: string;
  describe: string;
  configHelp: Record<string, string>;
  defaultKind: TaskKind;
}

export const PLANNER_SYSTEM = `You are Jarvis, the commander of the owner's 24/7 Queue — the background task engine of their "Ultimate Assistant" ecosystem of apps.
The owner tells you what they want. You turn it into queue tasks that real executors will run on a server, or you act on existing tasks.

Rules:
- Pick the right APP (by id from the list) and the right EXECUTOR (by id from the list) for every task. Use "" for app only when no app fits.
- KIND: "once" for a one-off job; "scheduled" for one run at a specific time (schedule.at ISO); "recurring" for "every day/week/at 9am" (schedule.dailyAt "HH:MM" or everyMinutes); "continuous" for standing autonomous workflows that keep going ("keep finding", "monitor", "continuously", "24/7") with schedule.everyMinutes between rounds (minimum 5).
- Break a big request into 1-6 tasks. Use dependsOn (refs like "t1") when one task must wait for another's result. Do not split what one executor does in one task.
- Anything that changes an app's code (improve, fix, add a feature, create a new app or section) → executor "code-change" with that app.
- Do NOT file a task that duplicates one in "Existing tasks" that is still active — instead mention it in reply, or act on it.
- Talking about an existing task (pause, resume, stop, restart, run now, change schedule/priority/config, answer its question) → put it in "actions" with its exact id. Allowed actions: pause, resume, cancel, restart, run_now, priority {priority}, answer {text}, edit {title?, description?, schedule?, config?}.
- If something essential is missing and cannot be defaulted (e.g. a video recreation with no video and no link), still file the task when the executor can ask for it itself; only use "clarify" when you cannot even tell what the owner wants.
- Never plan live trading, purchases, posting publicly or sending messages without saying in the reply that it will stop for the owner's approval.
- reply: 1-3 short sentences in plain English saying what you queued and when it runs. No markdown headers.

Return JSON only:
{"reply": string, "clarify": string|null,
 "tasks": [{"ref":"t1","title":string,"description":string,"app":string,"executor":string,"kind":"once"|"scheduled"|"recurring"|"continuous","schedule":{"everyMinutes"?:number,"dailyAt"?:"HH:MM","at"?:string,"tz"?:string},"priority":1-5,"config":{},"dependsOn":[]}],
 "actions": [{"taskId":string,"action":string, "priority"?:number, "text"?:string, "title"?:string, "description"?:string, "schedule"?:object, "config"?:object}]}`;

export function plannerUserMessage(input: {
  text: string;
  apps: KnownApp[];
  executors: PlannerExecutor[];
  tasks: Pick<Task, "id" | "title" | "status" | "app" | "executor" | "kind" | "result_summary">[];
  focus?: (Pick<Task, "id" | "title" | "status" | "app" | "executor" | "kind" | "config" | "schedule" | "question" | "result_summary"> & { recentLog?: string[] }) | null;
  findings: { kind: string; title: string }[];
  conversation: { role: string; text: string }[];
  now: Date;
  tz?: string;
}): string {
  const lines: string[] = [];
  lines.push(`Now: ${input.now.toISOString()}${input.tz ? ` (owner's zone ${input.tz})` : ""}`);
  lines.push("\nApps:");
  lines.push(input.apps.map((a) => `- ${a.id} — ${a.name}: ${a.description} [suits: ${a.executors.join(", ")}]`).join("\n"));
  lines.push("\nExecutors:");
  for (const e of input.executors) {
    const cfg = Object.entries(e.configHelp).map(([k, v]) => `${k}: ${v}`).join("; ");
    lines.push(`- ${e.id} (${e.agent}, default ${e.defaultKind}): ${e.describe}${cfg ? ` Config — ${cfg}` : ""}`);
  }
  const active = input.tasks.filter((t) => !["completed", "cancelled"].includes(t.status)).slice(0, 40);
  lines.push("\nExisting tasks (active):");
  lines.push(active.length ? active.map((t) => `- ${t.id} · ${t.title} · ${t.status} · ${t.kind} · app ${t.app || "-"} · ${t.executor}`).join("\n") : "(none)");
  const done = input.tasks.filter((t) => t.status === "completed").slice(0, 10);
  if (done.length) {
    lines.push("\nRecently completed (reuse their results, do not redo them):");
    lines.push(done.map((t) => `- ${t.title}: ${t.result_summary ?? ""}`.slice(0, 220)).join("\n"));
  }
  if (input.findings.length) {
    lines.push("\nAlready discovered (do not research these again):");
    lines.push(input.findings.slice(0, 20).map((f) => `- [${f.kind}] ${f.title}`).join("\n"));
  }
  if (input.focus) {
    const f = input.focus;
    lines.push(`\nThe owner is talking ABOUT this task (id ${f.id}): ${f.title} · ${f.status} · ${f.kind} · app ${f.app || "-"} · ${f.executor}`);
    lines.push(`Config: ${JSON.stringify(f.config).slice(0, 1200)}  Schedule: ${JSON.stringify(f.schedule)}`);
    if (f.question) lines.push(`It is waiting on this question: ${f.question}`);
    if (f.result_summary) lines.push(`Last result: ${f.result_summary}`);
    if (f.recentLog?.length) lines.push(`Recent log:\n${f.recentLog.slice(0, 12).join("\n")}`);
  }
  if (input.conversation.length) {
    lines.push("\nConversation so far:");
    lines.push(input.conversation.slice(-8).map((m) => `${m.role}: ${m.text}`.slice(0, 500)).join("\n"));
  }
  lines.push(`\nThe owner says: ${input.text}`);
  return lines.join("\n");
}

// --- validating what the model said -------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["pause", "resume", "cancel", "restart", "run_now", "priority", "answer", "edit"]);

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length > 2));
}

/** Jaccard similarity of the meaningful words in two titles. */
export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export function normalizePlan(
  raw: unknown,
  ctx: {
    text: string;
    apps: KnownApp[];
    executorIds: string[];
    executorKinds: Record<string, TaskKind>;
    existing: Pick<Task, "id" | "title" | "status" | "app" | "executor">[];
  },
): Plan {
  const r = (raw ?? {}) as Record<string, unknown>;
  const appIds = new Set(ctx.apps.map((a) => a.id));
  const execs = new Set(ctx.executorIds);
  const active = ctx.existing.filter((t) => !["completed", "cancelled", "failed"].includes(t.status));
  const duplicates: Plan["duplicates"] = [];

  const rawTasks = Array.isArray(r.tasks) ? r.tasks.slice(0, 8) : [];
  const tasks: PlannedTask[] = [];
  rawTasks.forEach((t, i) => {
    const x = (t ?? {}) as Record<string, unknown>;
    const executor = str(x.executor, 60).toLowerCase();
    if (!execs.has(executor)) return;
    const title = str(x.title, 140);
    if (!title) return;
    let app = str(x.app, 80).toLowerCase();
    if (app && !appIds.has(app)) app = findApp(ctx.apps, app)?.id ?? "";
    const dup = active.find((e) => e.executor === executor && (e.app || "") === app && similarity(e.title, title) >= 0.6);
    if (dup) {
      duplicates.push({ title, existing: dup.id });
      return;
    }
    const kind = TASK_KINDS.includes(x.kind as TaskKind) ? (x.kind as TaskKind) : ctx.executorKinds[executor] ?? "once";
    const schedule = cleanSchedule(x.schedule);
    tasks.push({
      ref: str(x.ref, 20) || `t${i + 1}`,
      title,
      description: str(x.description, 2000),
      instruction: ctx.text.slice(0, 4000),
      app,
      executor,
      kind: kind === "scheduled" && !schedule.at ? "once" : kind,
      schedule,
      priority: clampPriority(x.priority),
      config: x.config && typeof x.config === "object" && !Array.isArray(x.config) ? (x.config as Record<string, unknown>) : {},
      dependsOn: Array.isArray(x.dependsOn) ? x.dependsOn.map((d) => str(d, 20)).filter(Boolean) : [],
    });
  });
  // Only refs that exist and come earlier — no cycles possible.
  const refs = new Set<string>();
  for (const t of tasks) {
    t.dependsOn = t.dependsOn.filter((d) => refs.has(d));
    refs.add(t.ref);
  }

  const known = new Set(ctx.existing.map((t) => t.id));
  const actions: PlannedAction[] = [];
  for (const a of Array.isArray(r.actions) ? r.actions.slice(0, 10) : []) {
    const x = (a ?? {}) as Record<string, unknown>;
    const taskId = str(x.taskId, 40);
    const action = str(x.action, 20);
    if (!UUID.test(taskId) || !known.has(taskId) || !ACTIONS.has(action)) continue;
    let act: OwnerAction;
    if (action === "priority") act = { action, priority: clampPriority(x.priority) };
    else if (action === "answer") {
      const text = str(x.text, 2000);
      if (!text) continue;
      act = { action, text };
    } else if (action === "edit") {
      act = {
        action,
        ...(typeof x.title === "string" ? { title: x.title } : {}),
        ...(typeof x.description === "string" ? { description: x.description } : {}),
        ...(x.schedule && typeof x.schedule === "object" ? { schedule: cleanSchedule(x.schedule) } : {}),
        ...(x.config && typeof x.config === "object" && !Array.isArray(x.config) ? { config: x.config as Record<string, unknown> } : {}),
      };
    } else act = { action } as OwnerAction;
    actions.push({ taskId, act });
  }

  const clarify = str(r.clarify, 600) || null;
  let reply = str(r.reply, 1200);
  if (!reply) {
    reply = clarify
      ? clarify
      : tasks.length
        ? `Queued ${tasks.length} task${tasks.length === 1 ? "" : "s"}: ${tasks.map((t) => t.title).join("; ")}.`
        : actions.length
          ? "Done."
          : "I didn't find anything to queue in that.";
  }
  if (duplicates.length) {
    reply += ` Already running, so not filed again: ${duplicates.map((d) => d.title).join("; ")}.`;
  }
  return { reply, clarify: tasks.length || actions.length ? null : clarify, tasks, actions, duplicates };
}

// --- the no-AI planner ----------------------------------------------------------

const CONTROL: { re: RegExp; action: "pause" | "resume" | "cancel" | "restart" | "run_now" }[] = [
  { re: /^(please\s+)?(pause|hold|suspend)\b/i, action: "pause" },
  { re: /^(please\s+)?(resume|unpause|continue|restart?\s+running)\b/i, action: "resume" },
  { re: /^(please\s+)?(stop|cancel|terminate|kill|end)\b/i, action: "cancel" },
  { re: /^(please\s+)?(restart|redo|start over)\b/i, action: "restart" },
  { re: /^(please\s+)?(run|start)\b.*\bnow\b/i, action: "run_now" },
];

/**
 * With no AI, "pause the MT4 one" / "stop the research task" must act on the
 * task it names — not be filed as a new task called "Pause the MT4 one".
 * Matches the verb, then the existing task whose title, app or agent shares
 * the most words with the rest of the sentence. Null when it is not a control
 * sentence or no single task clearly matches.
 */
export function offlineControl(
  text: string,
  tasks: Pick<Task, "id" | "title" | "status" | "app" | "executor" | "agent">[],
  focusId?: string | null,
): unknown | null {
  const t = text.trim();
  const hit = CONTROL.find((c) => c.re.test(t));
  if (!hit) return null;
  if (focusId) return { reply: `Done — ${hit.action.replace("_", " ")}.`, actions: [{ taskId: focusId, action: hit.action }] };
  const rest = t.replace(hit.re, "").replace(/\b(the|my|task|tasks|job|one|workflow|agent|please|now|it)\b/gi, " ");
  const live = tasks.filter((x) => !["completed", "cancelled"].includes(x.status));
  const scored = live
    .map((x) => ({ x, s: Math.max(similarity(rest, x.title), similarity(rest, `${x.app} ${x.executor} ${x.agent}`)) }))
    .sort((a, b) => b.s - a.s);
  if (!scored.length || scored[0].s === 0 || (scored[1] && scored[1].s === scored[0].s)) return null;
  const target = scored[0].x;
  return { reply: `${hit.action === "cancel" ? "Terminated" : hit.action === "run_now" ? "Running now" : hit.action[0].toUpperCase() + hit.action.slice(1) + "d"}: ${target.title}.`, actions: [{ taskId: target.id, action: hit.action }] };
}

/**
 * "Create a recurring task that researches new video generation techniques
 * every day" → "Research new video generation techniques". The schedule words
 * go too: the card shows the schedule on its own.
 */
export function cleanTitle(text: string): string {
  let t = text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  t = t.replace(/^(please\s+)?(can you\s+)?(jarvis,?\s+)?/i, "");
  t = t.replace(/^(create|make|set up|setup|add|start)\s+(a|an)\s+((recurring|new|permanent|continuous|daily|weekly|scheduled|autonomous|24\/7)\s+)*(task|job|workflow|agent)\s+(that|to|which)\s+/i, "");
  t = t.replace(/\s+(every\s+(day|hour|week|morning|night)|daily|hourly|weekly|continuously|24\/7)(\s+at\s+\d{1,2}(:\d{2})?\s*(am|pm)?)?$/i, "");
  // "researches X" → "Research X"
  t = t.replace(/^(\w+?)(es|s)\b/, (m, stem: string, suf: string) =>
    /^(research|monitor|find|watch|check|track|scan|test|evaluat|improv|collect|discover)/i.test(stem)
      ? stem + (suf === "es" && !/(ch|sh|ss|x)$/i.test(stem) ? "e" : "")
      : m,
  );
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return (t || text.trim()).slice(0, 120);
}

export function offlinePlan(text: string, apps: KnownApp[]): unknown {
  const t = text.toLowerCase();
  const continuous = /\b(continuous(ly)?|24\/7|keep (finding|watching|looking)|monitor|always|non-?stop|autonomous)\b/.test(t);
  const daily = /\b(every ?day|daily|each day|every morning|every night)\b/.test(t);
  const hourly = /\b(every hour|hourly)\b/.test(t);
  const weekly = /\b(every week|weekly)\b/.test(t);
  const at = /\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(t);

  // App: the longest app name mentioned in the text.
  const app =
    [...apps].sort((a, b) => b.name.length - a.name.length).find((a) => t.includes(a.name.toLowerCase()))?.id ??
    (/\bh3\b/.test(t) ? apps.find((a) => a.id === "h3-experiments")?.id : undefined) ??
    (/\b(mt4|trading|ea|expert advisor)\b/.test(t) ? apps.find((a) => a.id === "trading-studio")?.id : undefined) ??
    "";

  let executor = "research";
  if (/\b(recreat|remake|reverse.?engineer)\w*\b.*\bvideo\b|\bvideo\b.*\b(recreat|remake)\w*/.test(t)) executor = "h3-recreate";
  else if (/\b(mt4|mt5|expert advisor|trading bot|\bea\b)s?\b/.test(t) && /\b(find|discover|evaluat|research|newest|new)\w*/.test(t)) executor = "mt4-discovery";
  else if (/\b(monitor|watch|uptime|health)\b/.test(t)) executor = "monitor";
  else if (/\b(improve|fix|add|build|create|make|change|update|redesign)\b/.test(t) && app && !/\b(find|research|look for)\b/.test(t)) executor = "code-change";

  const kind: TaskKind = executor === "mt4-discovery" || (executor === "monitor" && !daily) ? "continuous" : continuous ? "continuous" : daily || hourly || weekly ? "recurring" : "once";
  const schedule: TaskSchedule = {};
  if (hourly) schedule.everyMinutes = 60;
  else if (weekly) schedule.everyMinutes = 7 * 24 * 60;
  else if (daily) {
    if (at) {
      let h = Number(at[1]) % 12;
      if (at[3] === "pm") h += 12;
      if (!at[3] && Number(at[1]) >= 12) h = Number(at[1]);
      schedule.dailyAt = `${String(h).padStart(2, "0")}:${at[2] ?? "00"}`;
    } else schedule.everyMinutes = 24 * 60;
  } else if (kind === "continuous") schedule.everyMinutes = executor === "monitor" ? 15 : 360;

  const title = cleanTitle(text);
  const config: Record<string, unknown> = {};
  if (executor === "research") {
    config.topic = title;
    if (/\b(repo|repositor|open.?source|github)\w*/.test(t)) config.sources = ["web", "github"];
  }
  if (executor === "monitor") {
    const urls = text.match(/https?:\/\/[^\s<>"')]+/gi);
    if (urls) config.urls = urls;
  }
  return {
    reply: `Queued "${title}" (${kind === "once" ? "one-off" : kind}). AI planning is off on this server, so I took your words literally.`,
    clarify: null,
    tasks: [{ ref: "t1", title, description: text, app, executor, kind, schedule, priority: 3, config, dependsOn: [] }],
    actions: [],
  };
}

// ---------------------------------------------------------------------------
// Jarvis's command bar — one sentence in, real queue tasks out.
//
// Reads what Jarvis needs to understand the request (every app, every
// executor, the owner's tasks, recent findings, the conversation, and the
// task being talked about when there is one), asks the model for a plan,
// validates it (commander.normalizePlan) and applies it: files the tasks with
// their dependencies and a rollup parent for multi-part requests, applies
// actions to existing tasks, and keeps both sides of the conversation.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { allApps } from "../apps";
import { PLANNER_SYSTEM, normalizePlan, offlineControl, offlinePlan, plannerUserMessage, type Plan } from "../commander";
import { PLANNABLE, executorFor } from "../executors/registry";
import type { Capability, Task } from "../types";
import { aiReady, askJsonAs } from "./ai";
import { refsNote } from "../refs";
import type { SavedRef } from "./refs";
import {
  addMessage,
  createTask,
  getTask,
  listEvents,
  listExternalApps,
  listFindings,
  listMessages,
  listTasks,
  ownerAct,
  patchTask,
} from "./store";

export interface CommandResult {
  reply: string;
  clarify: string | null;
  created: Task[];
  acted: Task[];
  planner: "ai" | "offline";
  /** The model that planned it (from the chat's model picker, or the router's choice). */
  model?: string;
  error?: string;
}

export async function runCommand(
  db: SupabaseClient,
  uid: string,
  text: string,
  opts: {
    taskId?: string | null;
    tz?: string;
    from?: string;
    /** OpenRouter model id from the chat's picker; "" or absent = Auto (the hub's router). */
    model?: string;
    /** Reference pictures already saved to Storage (server/refs.ts saveRefs). */
    refs?: SavedRef[];
  } = {},
): Promise<CommandResult> {
  const clean = text.trim().slice(0, 4000);
  const focusId = opts.taskId ?? null;
  const [tasks, external, findings, conversation] = await Promise.all([
    listTasks(db, uid, 120),
    listExternalApps(db, uid),
    listFindings(db, uid, { limit: 25 }),
    listMessages(db, uid, focusId, 10),
  ]);
  const apps = allApps(external);
  const focusTask = focusId ? await getTask(db, uid, focusId) : null;
  const focus = focusTask
    ? { ...focusTask, recentLog: (await listEvents(db, focusTask.id, 12)).map((e) => `${e.at.slice(11, 16)} ${e.message}`) }
    : null;

  const refs = opts.refs ?? [];
  await addMessage(db, uid, "you", clean, focusId, [], { attachments: refs.map((r) => ({ key: r.key, name: r.name })) });

  const ctx = {
    text: clean,
    apps,
    executorIds: PLANNABLE.map((e) => e.id),
    executorKinds: Object.fromEntries(PLANNABLE.map((e) => [e.id, e.defaultKind])),
    existing: tasks,
  };

  let plan: Plan;
  let planner: CommandResult["planner"] = "ai";
  let error: string | undefined;
  let usedModel: string | undefined;
  if (aiReady()) {
    try {
      const asked = await askJsonAs(
        PLANNER_SYSTEM,
        plannerUserMessage({
          text: clean,
          apps,
          executors: PLANNABLE,
          tasks,
          focus,
          findings: findings.map((f) => ({ kind: f.kind, title: f.title })),
          conversation: conversation.map((m) => ({ role: m.role, text: m.text })),
          now: new Date(),
          tz: opts.tz,
        }) + refsNote(refs),
        { model: opts.model, images: refs.map((r) => r.dataUrl), temperature: 0.2, maxTokens: 3000, timeoutMs: 90_000 },
      );
      usedModel = asked.model;
      plan = normalizePlan(asked.data, ctx);
    } catch (e) {
      error = (e as Error).message;
      planner = "offline";
      plan = normalizePlan(offlineControl(clean, tasks, focusId) ?? offlinePlan(clean, apps), ctx);
      plan.reply = `${plan.reply} (Jarvis's AI planner is unavailable: ${error.slice(0, 160)})`;
    }
  } else {
    planner = "offline";
    plan = normalizePlan(
      offlineControl(clean, tasks, focusId) ??
        (focus ? { reply: "", actions: [{ taskId: focus.id, action: "answer", text: clean }] } : offlinePlan(clean, apps)),
      ctx,
    );
  }

  // Talking about one task with nothing else planned: keep the words as guidance for it.
  if (focus && !plan.tasks.length && !plan.actions.length && !plan.clarify) {
    plan.actions.push({ taskId: focus.id, act: { action: "answer", text: clean } });
  }

  const acted: Task[] = [];
  for (const a of plan.actions) {
    try {
      acted.push(await ownerAct(db, uid, a.taskId, a.act));
    } catch (e) {
      plan.reply += ` (Couldn't ${a.act.action} one task: ${(e as Error).message})`;
    }
  }

  const created: Task[] = [];
  if (plan.tasks.length) {
    const byRef = new Map<string, string>();
    for (const t of plan.tasks) {
      const ex = executorFor(t.executor)!;
      const needs = new Set<Capability>(ex.needs);
      if (t.executor === "h3-recreate" && typeof t.config.url === "string") needs.add("ytdlp");
      const task = await createTask(db, uid, {
        title: t.title,
        description: t.description,
        instruction: t.instruction,
        app: t.app,
        executor: t.executor,
        agent: ex.agent,
        kind: t.kind,
        schedule: t.schedule,
        priority: t.priority,
        config: refs.length ? { ...t.config, references: refs.map((r) => ({ key: r.key, name: r.name })) } : t.config,
        depends_on: t.dependsOn.map((d) => byRef.get(d)).filter((x): x is string => Boolean(x)),
        needs: [...needs],
        created_by: opts.from ?? "jarvis",
        steps: ex.initialSteps?.(t.config),
      });
      byRef.set(t.ref, task.id);
      created.push(task);
    }
    // A multi-part one-off request gets a parent that reports on the whole.
    // Created LAST, already depending on every part, so no worker can claim
    // it before its children exist.
    if (created.length > 1 && created.every((t) => t.kind === "once" || t.kind === "scheduled")) {
      const parent = await createTask(db, uid, {
        title: clean.length > 90 ? `${clean.slice(0, 87)}…` : clean,
        description: plan.tasks.map((t) => t.title).join(" · "),
        instruction: clean,
        app: plan.tasks.every((t) => t.app === plan.tasks[0].app) ? plan.tasks[0].app : "",
        executor: "rollup",
        agent: "Jarvis",
        kind: "once",
        priority: Math.max(...plan.tasks.map((t) => t.priority)),
        depends_on: created.map((c) => c.id),
        created_by: opts.from ?? "jarvis",
        steps: executorFor("rollup")?.initialSteps?.({}),
      });
      for (const c of created) await patchTask(db, c.id, { parent_id: parent.id });
      created.unshift(parent);
    }
  }

  if (refs.length && planner === "offline") {
    plan.reply += ` I kept your ${refs.length === 1 ? "picture" : `${refs.length} pictures`} on ${created.length ? "the task" : "this message"}, but nothing looked at ${refs.length === 1 ? "it" : "them"} — that needs the AI planner.`;
  }
  await addMessage(db, uid, "jarvis", plan.reply, focusId, [...created, ...acted].map((t) => t.id), { model: usedModel ?? (planner === "offline" ? "offline" : null) });
  return { reply: plan.reply, clarify: plan.clarify, created, acted, planner, ...(usedModel ? { model: usedModel } : {}), ...(error ? { error } : {}) };
}

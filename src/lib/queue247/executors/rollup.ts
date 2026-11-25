// ---------------------------------------------------------------------------
// Rollup — the parent of a multi-part request. It depends on every sub-task
// (the claim will not hand it out until they are all completed), then reads
// their results and writes one report: "here is what came of everything you
// asked for".
// ---------------------------------------------------------------------------

import type { StepResult } from "../engine";
import type { Executor, StepContext } from "./types";
import { queueDb } from "../server/db";
import { aiReady, askText } from "../server/ai";
import type { Task } from "../types";

async function run(ctx: StepContext): Promise<StepResult> {
  const { data } = await queueDb()
    .from("queue_tasks")
    .select("id,title,status,result_summary,executor,app")
    .eq("user_id", ctx.task.user_id)
    .eq("parent_id", ctx.task.id);
  const kids = (data ?? []) as Pick<Task, "id" | "title" | "status" | "result_summary" | "executor" | "app">[];
  const lines = kids.map((k) => `- ${k.title} (${k.status}): ${k.result_summary ?? "no summary"}`);
  let summary = `${kids.length} parts finished.\n${lines.join("\n")}`;
  if (aiReady() && kids.length) {
    try {
      summary = await askText(
        "Write a short report (3-6 plain sentences, no headers) for the owner on what came of their request, from the results of its sub-tasks. Concrete facts only; say what needs their attention.",
        `Request: ${ctx.task.instruction}\nResults:\n${lines.join("\n")}`,
        { meter: ctx.meter },
      );
    } catch (e) {
      await ctx.log(`Could not write the AI report (${(e as Error).message}); listing results instead.`, undefined, "warn");
    }
  }
  await ctx.finding({ kind: "report", key: ctx.task.id, title: ctx.task.title, summary, data: { parts: kids } });
  await ctx.notify(`Done: ${ctx.task.title}`, summary.slice(0, 400), "/apps/jarvis#queue");
  return { outcome: "done", summary: summary.slice(0, 1500) };
}

export const rollupExecutor: Executor = {
  id: "rollup",
  agent: "Jarvis",
  describe: "Internal: waits for a request's sub-tasks, then reports what came of them. Never chosen by the planner.",
  configHelp: {},
  needs: [],
  defaultKind: "once",
  concurrency: 4,
  initialSteps: () => ["Wait for every part", "Write the report"],
  run,
};

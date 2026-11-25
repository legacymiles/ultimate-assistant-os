// ---------------------------------------------------------------------------
// Outside apps — the reusable integration half.
//
// A website registered through the 24/7 Queue API (queue_apps, with a key)
// can be handed work: this executor POSTs the task to the app's callback URL
// and then waits for the app to report back through the API
// (/api/queue247/v1/tasks/<id>/events — progress, logs, findings, done or
// failed). The app owns the work; the queue owns the record of it.
// ---------------------------------------------------------------------------

import type { StepResult } from "../engine";
import type { Executor, StepContext } from "./types";
import { queueDb } from "../server/db";

interface HookState {
  deliveredAt?: string;
  checks?: number;
}

async function run(ctx: StepContext): Promise<StepResult> {
  const st = ctx.state as HookState;
  const appId = ctx.task.app;
  if (!appId) return { outcome: "failed", error: "This task is not tied to a connected app.", retryable: false };
  const { data: app } = await queueDb()
    .from("queue_apps")
    .select("id,name,callback_url")
    .eq("user_id", ctx.task.user_id)
    .eq("id", appId)
    .maybeSingle();
  if (!app) return { outcome: "failed", error: `No connected app "${appId}". Register it in 24/7 Queue › Apps.`, retryable: false };

  if (!st.deliveredAt) {
    const callback = (app as { callback_url: string | null }).callback_url;
    if (!callback) {
      await ctx.log(`${(app as { name: string }).name} has no callback URL, so it will pick this up by polling GET /api/queue247/v1/tasks.`, undefined, "step");
    } else {
      const res = await fetch(callback, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "jarvis-queue-247" },
        body: JSON.stringify({
          event: "task.assigned",
          task: { id: ctx.task.id, title: ctx.task.title, instruction: ctx.task.instruction, config: ctx.task.config, kind: ctx.task.kind },
          report: `/api/queue247/v1/task?id=${ctx.task.id}`,
        }),
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]),
      }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }) as Response);
      if (!res.ok) {
        return { outcome: "failed", error: `${(app as { name: string }).name} did not accept the task (${res.status || res.statusText}).`, retryable: true };
      }
      await ctx.log(`Delivered to ${(app as { name: string }).name}.`, { callback }, "step");
    }
    st.deliveredAt = ctx.now().toISOString();
    await ctx.progress(10, `Waiting for ${(app as { name: string }).name} to report`);
  }
  st.checks = (st.checks ?? 0) + 1;
  const timeoutH = Math.max(1, Number(ctx.task.config.timeoutHours) || 24);
  if (ctx.now().getTime() - Date.parse(st.deliveredAt) > timeoutH * 3_600_000) {
    return { outcome: "failed", error: `${(app as { name: string }).name} has not reported back in ${timeoutH} h.`, retryable: false };
  }
  // The app's own reports change the status directly; until then, rest.
  return { outcome: "wait", until: new Date(ctx.now().getTime() + 10 * 60_000).toISOString() };
}

export const appWebhookExecutor: Executor = {
  id: "app-webhook",
  agent: "Connected app",
  describe:
    "Hands the task to an outside website/app registered with the 24/7 Queue API; that app does the work and reports progress and results back.",
  configHelp: { timeoutHours: "Give up after this many hours without a report (default 24)." },
  needs: [],
  defaultKind: "once",
  concurrency: 8,
  initialSteps: () => ["Deliver to the app", "App works and reports back"],
  run,
};

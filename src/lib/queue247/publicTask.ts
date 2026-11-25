import type { Task } from "./types";

/** What an outside app is shown of a task — never another app's config or state. */
export function publicTask(t: Task) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    kind: t.kind,
    executor: t.executor,
    progress: t.progress,
    current_step: t.current_step,
    result_summary: t.result_summary,
    question: t.question,
    last_error: t.last_error,
    next_run_at: t.next_run_at,
    created_at: t.created_at,
    updated_at: t.updated_at,
    config: t.config,
  };
}

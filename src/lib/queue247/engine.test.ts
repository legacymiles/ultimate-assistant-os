import { describe, expect, it } from "vitest";
import {
  ActionError,
  applyOwnerAction,
  applyStepResult,
  bucketOf,
  buildTask,
  dependenciesMet,
  firstRunAt,
  isLost,
  nextSlot,
  parseClock,
  progressFromSteps,
  retryDelayMs,
  TaskInputError,
} from "./engine";
import type { Task } from "./types";

const NOW = new Date("2026-11-25T12:00:00.000Z");

function task(over: Partial<Task> = {}): Task {
  const base = buildTask({ title: "Find EAs", executor: "research" }, NOW);
  return { ...base, id: "00000000-0000-4000-8000-000000000001", user_id: "u1", created_at: NOW.toISOString(), updated_at: NOW.toISOString(), ...over };
}

describe("scheduling", () => {
  it("parses clocks", () => {
    expect(parseClock("09:30")).toBe(570);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("nope")).toBeNull();
  });

  it("everyMinutes adds the interval, clamped to at least 5", () => {
    expect(nextSlot({ everyMinutes: 60 }, NOW)?.toISOString()).toBe("2026-11-25T13:00:00.000Z");
    expect(nextSlot({ everyMinutes: 1 }, NOW)?.toISOString()).toBe("2026-11-25T12:05:00.000Z");
  });

  it("dailyAt picks the next wall-clock slot in the zone", () => {
    expect(nextSlot({ dailyAt: "13:00" }, NOW)?.toISOString()).toBe("2026-11-25T13:00:00.000Z");
    expect(nextSlot({ dailyAt: "11:00" }, NOW)?.toISOString()).toBe("2026-11-26T11:00:00.000Z");
    // 09:00 in New York (UTC-5 in November) = 14:00 UTC.
    expect(nextSlot({ dailyAt: "09:00", tz: "America/New_York" }, NOW)?.toISOString()).toBe("2026-11-25T14:00:00.000Z");
  });

  it("a past one-off never fires again", () => {
    expect(nextSlot({ at: "2026-11-24T00:00:00Z" }, NOW)).toBeNull();
  });

  it("scheduled tasks start at their time; others now", () => {
    expect(firstRunAt("scheduled", { at: "2026-11-26T08:00:00Z" }, NOW).toISOString()).toBe("2026-11-26T08:00:00.000Z");
    expect(firstRunAt("once", {}, NOW)).toEqual(NOW);
  });

  it("backoff doubles and caps at an hour", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(3)).toBe(120_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});

describe("buildTask", () => {
  it("defaults recurring and continuous schedules", () => {
    expect(buildTask({ title: "x", executor: "research", kind: "continuous" }, NOW).schedule.everyMinutes).toBe(60);
    expect(buildTask({ title: "x", executor: "research", kind: "recurring" }, NOW).schedule.everyMinutes).toBe(1440);
  });

  it("refuses a scheduled task with no time, and a nameless one", () => {
    expect(() => buildTask({ title: "x", executor: "research", kind: "scheduled" }, NOW)).toThrow(TaskInputError);
    expect(() => buildTask({ title: " ", executor: "research" }, NOW)).toThrow(TaskInputError);
  });

  it("a future scheduled task starts as scheduled, a one-off as queued", () => {
    expect(buildTask({ title: "x", executor: "research", kind: "scheduled", schedule: { at: "2026-12-01T00:00:00Z" } }, NOW).status).toBe("scheduled");
    expect(buildTask({ title: "x", executor: "research" }, NOW).status).toBe("queued");
  });

  it("keeps only real uuids as dependencies and known capabilities", () => {
    const t = buildTask({ title: "x", executor: "research", depends_on: ["nope", "00000000-0000-4000-8000-000000000009"], needs: ["ffmpeg", "warp" as never] }, NOW);
    expect(t.depends_on).toEqual(["00000000-0000-4000-8000-000000000009"]);
    expect(t.needs).toEqual(["ffmpeg"]);
  });
});

describe("applyStepResult", () => {
  it("a one-off done completes at 100%", () => {
    const p = applyStepResult(task({ status: "running", attempts: 1 }), { outcome: "done", summary: "ok" }, NOW);
    expect(p.status).toBe("completed");
    expect(p.progress).toBe(100);
    expect(p.success_count).toBe(1);
    expect(p.locked_by).toBeNull();
  });

  it("a continuous done rests until the next slot", () => {
    const t = task({ kind: "continuous", schedule: { everyMinutes: 30 }, status: "running" });
    const p = applyStepResult(t, { outcome: "done", summary: "round 1" }, NOW);
    expect(p.status).toBe("scheduled");
    expect(p.next_run_at).toBe("2026-11-25T12:30:00.000Z");
  });

  it("continue requeues immediately and resets attempts", () => {
    const p = applyStepResult(task({ status: "running", attempts: 2 }), { outcome: "continue" }, NOW);
    expect(p.status).toBe("queued");
    expect(p.next_run_at).toBe(NOW.toISOString());
    expect(p.attempts).toBe(0);
  });

  it("a retryable failure backs off; out of tries it fails", () => {
    const retry = applyStepResult(task({ status: "running", attempts: 2, max_attempts: 5 }), { outcome: "failed", error: "x", retryable: true }, NOW);
    expect(retry.status).toBe("scheduled");
    expect(retry.next_run_at).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    const dead = applyStepResult(task({ status: "running", attempts: 5, max_attempts: 5 }), { outcome: "failed", error: "x", retryable: true }, NOW);
    expect(dead.status).toBe("failed");
    expect(applyStepResult(task({ status: "running", attempts: 1 }), { outcome: "failed", error: "bad", retryable: false }, NOW).status).toBe("failed");
  });

  it("a standing workflow survives a bad round", () => {
    const t = task({ kind: "continuous", schedule: { everyMinutes: 60 }, status: "running", attempts: 5, max_attempts: 5 });
    const p = applyStepResult(t, { outcome: "failed", error: "source down", retryable: true }, NOW);
    expect(p.status).toBe("scheduled");
    expect(p.last_error).toBe("source down");
  });

  it("stops for approval and input", () => {
    expect(applyStepResult(task({ status: "running" }), { outcome: "needs_approval", question: "Spend $5?" }, NOW)).toMatchObject({ status: "waiting_approval", question: "Spend $5?" });
    expect(applyStepResult(task({ status: "running" }), { outcome: "needs_input", question: "Which URL?" }, NOW).status).toBe("needs_input");
  });

  it("never un-pauses a task the owner paused mid-step", () => {
    const p = applyStepResult(task({ status: "paused" }), { outcome: "continue" }, NOW);
    expect(p.status).toBeUndefined();
  });

  it("wait never schedules in the past", () => {
    const p = applyStepResult(task({ status: "running" }), { outcome: "wait", until: "2020-01-01T00:00:00Z" }, NOW);
    expect(Date.parse(p.next_run_at!)).toBeGreaterThan(NOW.getTime());
  });
});

describe("owner actions", () => {
  it("pause / resume / cancel", () => {
    expect(applyOwnerAction(task(), { action: "pause" }, NOW).status).toBe("paused");
    expect(applyOwnerAction(task({ status: "paused" }), { action: "resume" }, NOW).status).toBe("queued");
    expect(applyOwnerAction(task(), { action: "cancel" }, NOW).status).toBe("cancelled");
    expect(() => applyOwnerAction(task({ status: "queued" }), { action: "resume" }, NOW)).toThrow(ActionError);
  });

  it("approve records the answer in state for the executor", () => {
    const p = applyOwnerAction(task({ status: "waiting_approval", question: "Go?" }), { action: "approve" }, NOW);
    expect(p.status).toBe("queued");
    expect((p.state as { approval: { answer: string } }).approval.answer).toBe("yes");
  });

  it("answer to a waiting task requeues it; to a busy one it becomes guidance", () => {
    expect(applyOwnerAction(task({ status: "needs_input", question: "URL?" }), { action: "answer", text: "https://x.y" }, NOW).status).toBe("queued");
    const g = applyOwnerAction(task({ status: "running" }), { action: "answer", text: "focus on grid bots" }, NOW);
    expect(g.status).toBeUndefined();
    expect((g.state as { guidance: unknown[] }).guidance).toHaveLength(1);
  });

  it("restart wipes progress and state", () => {
    const p = applyOwnerAction(task({ status: "failed", progress: 60, state: { x: 1 }, steps: [{ id: "s1", label: "a", state: "done" }] }), { action: "restart" }, NOW);
    expect(p).toMatchObject({ status: "queued", progress: 0, state: {} });
    expect(p.steps?.[0].state).toBe("pending");
  });

  it("edit re-plans a scheduled task's next run", () => {
    const t = task({ kind: "recurring", status: "scheduled", schedule: { everyMinutes: 60 } });
    const p = applyOwnerAction(t, { action: "edit", schedule: { everyMinutes: 15 } }, NOW);
    expect(p.next_run_at).toBe("2026-11-25T12:15:00.000Z");
  });
});

describe("board helpers", () => {
  it("buckets by urgency first", () => {
    expect(bucketOf(task({ status: "needs_input" }), NOW)).toBe("attention");
    expect(bucketOf(task({ status: "running", lock_until: "2026-11-25T12:05:00Z" }), NOW)).toBe("active");
    expect(bucketOf(task({ status: "scheduled", kind: "continuous" }), NOW)).toBe("autonomous");
    expect(bucketOf(task({ status: "scheduled", kind: "once" }), NOW)).toBe("scheduled");
    expect(bucketOf(task({ status: "cancelled" }), NOW)).toBe("completed");
  });

  it("a running task with an expired lease is lost", () => {
    expect(isLost({ status: "running", lock_until: "2026-11-25T11:59:00Z" }, NOW)).toBe(true);
    expect(isLost({ status: "running", lock_until: "2026-11-25T12:01:00Z" }, NOW)).toBe(false);
  });

  it("progress from steps and dependencies", () => {
    expect(progressFromSteps([{ id: "a", label: "", state: "done" }, { id: "b", label: "", state: "pending" }])).toBe(50);
    expect(dependenciesMet({ depends_on: ["a", "b"] }, (id) => (id === "a" ? "completed" : "running"))).toBe(false);
  });
});

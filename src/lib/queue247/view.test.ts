import { describe, expect, it } from "vitest";
import type { Finding, Task, TaskEvent } from "./types";
import {
  activityTicks,
  configToFields,
  compact,
  currentStepOf,
  ecosystem,
  everyText,
  fieldsToConfig,
  formatDuration,
  groupByBucket,
  h3Prompts,
  historyOf,
  matchesFilter,
  mt4Rows,
  nextRunText,
  notesOf,
  progressOf,
  relTime,
  scheduleText,
  scoreOf,
  storyboardShots,
  tickerItems,
  toneOf,
  workerView,
  type QueueSnapshot,
} from "./view";

const NOW = new Date("2026-11-25T12:00:00.000Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const ahead = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();

function task(p: Partial<Task> = {}): Task {
  return {
    id: p.id ?? "t1",
    user_id: "u",
    title: "Find MT4 bots",
    description: "",
    instruction: "",
    app: "",
    executor: "research",
    agent: "Research agent",
    kind: "once",
    status: "queued",
    priority: 3,
    progress: 0,
    current_step: "",
    steps: [],
    config: {},
    state: {},
    schedule: {},
    next_run_at: null,
    last_run_at: null,
    last_activity_at: null,
    attempts: 0,
    max_attempts: 5,
    parent_id: null,
    depends_on: [],
    needs: [],
    locked_by: null,
    lock_until: null,
    success_count: 0,
    failure_count: 0,
    last_error: null,
    result_summary: null,
    question: null,
    created_by: "you",
    created_at: ago(60),
    updated_at: ago(5),
    ...p,
  };
}

function finding(p: Partial<Finding> = {}): Finding {
  return {
    id: p.id ?? "f1",
    task_id: "t1",
    user_id: "u",
    app: "",
    kind: "research-note",
    key: "k",
    title: "A note",
    summary: "",
    url: null,
    score: null,
    data: {},
    notable: false,
    created_at: ago(10),
    updated_at: ago(10),
    ...p,
  };
}

describe("relTime", () => {
  it("reads past and future in short phrases", () => {
    expect(relTime(ago(0.2), NOW)).toBe("just now");
    expect(relTime(ago(4), NOW)).toBe("4 min ago");
    expect(relTime(ago(180), NOW)).toBe("3 h ago");
    expect(relTime(ago(30 * 60), NOW)).toBe("yesterday");
    expect(relTime(ago(6 * 24 * 60), NOW)).toBe("6 d ago");
    expect(relTime(ahead(12), NOW)).toBe("in 12 min");
    expect(relTime(null, NOW)).toBe("—");
    expect(relTime("nonsense", NOW)).toBe("—");
  });
});

describe("durations", () => {
  it("formats run lengths", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(4200)).toBe("4.2 s");
    expect(formatDuration(95_000)).toBe("1 m 35 s");
    expect(formatDuration(undefined)).toBe("—");
  });
  it("names an interval", () => {
    expect(everyText(30)).toBe("30 min");
    expect(everyText(60)).toBe("hour");
    expect(everyText(90)).toBe("1 h 30 min");
    expect(everyText(1440)).toBe("day");
    expect(everyText(2880)).toBe("2 days");
  });
});

describe("scheduleText / nextRunText", () => {
  it("describes each kind", () => {
    expect(scheduleText("once", {})).toBe("One-off");
    expect(scheduleText("continuous", { everyMinutes: 30 })).toBe("24/7 — every 30 min");
    expect(scheduleText("recurring", { dailyAt: "09:00" })).toBe("Recurring — daily at 09:00 UTC");
    expect(scheduleText("scheduled", {})).toBe("Once, time not set");
  });
  it("never invents a time", () => {
    expect(nextRunText(task({ status: "running" }), NOW)).toBe("Running now");
    expect(nextRunText(task({ status: "queued", next_run_at: null }), NOW)).toBe("Next free worker");
    expect(nextRunText(task({ status: "scheduled", next_run_at: ahead(45) }), NOW)).toBe("in 45 min");
    expect(nextRunText(task({ status: "scheduled", next_run_at: ago(2) }), NOW)).toBe("Next free worker");
    expect(nextRunText(task({ status: "needs_input" }), NOW)).toBe("After you answer");
    expect(nextRunText(task({ status: "completed" }), NOW)).toBe("Done");
  });
});

describe("task facts", () => {
  it("counts history from the real counters", () => {
    expect(historyOf(task({ success_count: 12, failure_count: 1 }))).toEqual({ ok: 12, fail: 1, total: 13, rate: 12 / 13 });
    expect(historyOf(task()).rate).toBeNull();
  });
  it("draws a bar only for reported progress", () => {
    expect(progressOf(task({ progress: 0 }))).toBeNull();
    expect(progressOf(task({ progress: 42.4 }))).toBe(42);
    expect(progressOf(task({ progress: 130 }))).toBe(100);
  });
  it("reads the current step", () => {
    expect(currentStepOf(task({ current_step: "Scoring bots" }))).toBe("Scoring bots");
    expect(currentStepOf(task({ steps: [{ id: "a", label: "Fetch", state: "done" }, { id: "b", label: "Score", state: "active" }] }))).toBe("Score");
  });
  it("gives each state its own tone", () => {
    expect(toneOf(task({ status: "running", lock_until: ahead(3) }), NOW)).toBe("running");
    expect(toneOf(task({ status: "running", lock_until: ago(3), kind: "continuous" }), NOW)).toBe("always");
    expect(toneOf(task({ status: "scheduled", kind: "continuous" }), NOW)).toBe("always");
    expect(toneOf(task({ status: "scheduled" }), NOW)).toBe("scheduled");
    expect(toneOf(task({ status: "waiting_approval" }), NOW)).toBe("needs");
    expect(toneOf(task({ status: "paused" }), NOW)).toBe("paused");
    expect(toneOf(task({ status: "failed" }), NOW)).toBe("failed");
    expect(toneOf(task({ status: "completed" }), NOW)).toBe("done");
    expect(toneOf(task({ status: "queued" }), NOW)).toBe("queued");
  });
});

describe("groupByBucket / matchesFilter", () => {
  const tasks = [
    task({ id: "a", status: "needs_input" }),
    task({ id: "b", status: "running", lock_until: ahead(4), priority: 2 }),
    task({ id: "c", status: "running", lock_until: ahead(4), priority: 5 }),
    task({ id: "d", status: "scheduled", kind: "continuous", next_run_at: ahead(30), app: "h3-experiments" }),
    task({ id: "e", status: "scheduled", kind: "scheduled", next_run_at: ahead(5) }),
    task({ id: "f", status: "completed" }),
    task({ id: "g", status: "cancelled" }),
  ];
  it("puts every task in exactly one bucket, urgent first", () => {
    const groups = groupByBucket(tasks, NOW);
    expect(groups.map((g) => g.bucket)).toEqual(["attention", "active", "waiting", "autonomous", "scheduled", "paused", "failed", "completed"]);
    expect(groups.reduce((n, g) => n + g.tasks.length, 0)).toBe(tasks.length);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(["c", "b"]);
    expect(groups[3].tasks.map((t) => t.id)).toEqual(["d"]);
    expect(groups[7].tasks.map((t) => t.id).sort()).toEqual(["f", "g"]);
  });
  it("filters by app, bucket and words", () => {
    expect(tasks.filter((t) => matchesFilter(t, { app: "h3-experiments", bucket: "", q: "" }, NOW)).map((t) => t.id)).toEqual(["d"]);
    expect(tasks.filter((t) => matchesFilter(t, { app: "", bucket: "active", q: "" }, NOW))).toHaveLength(2);
    expect(matchesFilter(task({ title: "Monitor trading systems" }), { app: "", bucket: "", q: "trading monitor" }, NOW)).toBe(true);
    expect(matchesFilter(task({ title: "Monitor trading systems" }), { app: "", bucket: "", q: "video" }, NOW)).toBe(false);
  });
});

describe("workerView", () => {
  it("turns a heartbeat into meters", () => {
    const w = workerView(
      { id: "vps-1", host: "vps", capabilities: ["ai"], concurrency: 3, running: 1, metrics: { load: 1, cpus: 4, totalMemMb: 8000, freeMemMb: 2000, uptimeS: 7200, rssMb: 210 }, seen_at: ago(0.5) },
      NOW,
    );
    expect(w.loadPct).toBe(25);
    expect(w.memPct).toBe(75);
    expect(w.memUsedMb).toBe(6000);
    expect(w.uptime).toBe("2 h 0 m");
    expect(w.stale).toBe(false);
  });
  it("leaves unknowns unknown", () => {
    const w = workerView({ id: "x", host: "", capabilities: [], concurrency: 0, running: 0, metrics: {}, seen_at: ago(5) }, NOW);
    expect(w.loadPct).toBeNull();
    expect(w.memPct).toBeNull();
    expect(w.host).toBe("x");
    expect(w.stale).toBe(true);
  });
});

describe("ecosystem", () => {
  const snap = (p: Partial<QueueSnapshot>): QueueSnapshot => ({
    tasks: [],
    workers: [],
    events: [],
    findings: [],
    notifications: [],
    apps: [{ id: "h3-experiments", name: "H3 Prompt Lab", source: "hub", executors: [], url: null }],
    executors: [],
    now: NOW.toISOString(),
    ...p,
  });

  it("says plainly when the queue is empty", () => {
    expect(ecosystem(snap({}), NOW).headline).toMatch(/Tell Jarvis/);
  });

  it("summarises what is happening", () => {
    const e = ecosystem(
      snap({
        tasks: [
          task({ id: "r", status: "running", lock_until: ahead(3), current_step: "Reading Telegram" }),
          task({ id: "n", status: "waiting_approval" }),
          task({ id: "c1", status: "scheduled", kind: "continuous", app: "h3-experiments" }),
          task({ id: "c2", status: "running", lock_until: ahead(3), kind: "recurring", app: "h3-experiments" }),
          task({ id: "p", status: "paused", kind: "continuous", app: "h3-experiments" }),
          task({ id: "done", status: "completed", updated_at: ago(30) }),
          task({ id: "old", status: "completed", updated_at: ago(60 * 48) }),
        ],
        findings: [finding({ id: "x", notable: false, created_at: ago(1) }), { ...finding({ id: "y", notable: true, created_at: ago(50) }), seen: false }],
        notifications: [{ id: "1", task_id: null, title: "t", body: "", link: null, read: false, at: ago(1) }],
      }),
      NOW,
    );
    expect(e.running.map((t) => t.id).sort()).toEqual(["c2", "r"]);
    expect(e.needsYou.map((t) => t.id)).toEqual(["n"]);
    expect(e.autonomous).toEqual([{ app: "h3-experiments", name: "H3 Prompt Lab", count: 2, running: 1 }]);
    expect(e.completedToday).toBe(1);
    expect(e.discoveries[0].id).toBe("y");
    expect(e.unseen).toBe(1);
    expect(e.unread).toBe(1);
    expect(e.headline).toMatch(/Working on/);
  });

  it("names a missing worker", () => {
    const e = ecosystem(snap({ tasks: [task({ status: "queued" })] }), NOW);
    expect(e.headline).toBe("No worker online — tasks wait until the VPS worker is running.");
  });
});

describe("activity", () => {
  const ev = (id: number, min: number, level: TaskEvent["level"] = "info"): TaskEvent => ({ id, task_id: "t1", run_id: null, at: ago(min), level, message: `m${id}`, data: null });
  it("sorts the ticker newest first and names the task", () => {
    const items = tickerItems([ev(1, 10), ev(2, 1)], [task({ id: "t1", title: "Scan" })]);
    expect(items.map((i) => i.id)).toEqual([2, 1]);
    expect(items[0].taskTitle).toBe("Scan");
  });
  it("places the last hour's events on a line", () => {
    const ticks = activityTicks([ev(1, 30, "error"), ev(2, 0), ev(3, 90)], NOW, 60);
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toEqual({ x: 0.5, level: "error" });
    expect(ticks[1].x).toBe(1);
  });
});

describe("results", () => {
  it("reads scores as numbers or { value }", () => {
    expect(scoreOf(72)).toBe(72);
    expect(scoreOf({ value: 64, why: [] })).toBe(64);
    expect(scoreOf("x")).toBeNull();
  });

  it("ranks MT4 bots by score", () => {
    const rows = mt4Rows([
      finding({ id: "a", kind: "mt4-bot", score: 41, data: { scores: { quality: { value: 50 }, risk: 20 }, flags: [{ id: "no-sl", label: "No stop loss", severity: "danger" }], verdict: "Risky grid", backtest: { status: "queued", why: "Needs MT4" } } }),
      finding({ id: "b", kind: "mt4-bot", score: 88, data: { strategy: ["trend-following"], flags: ["Hardcoded lot"] } }),
      finding({ id: "c", kind: "repo" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(rows[1].quality).toBe(50);
    expect(rows[1].risk).toBe(20);
    expect(rows[1].flags[0]).toEqual({ label: "No stop loss", severity: "danger" });
    expect(rows[1].backtest).toEqual({ status: "queued", why: "Needs MT4" });
    expect(rows[0].flags[0].label).toBe("Hardcoded lot");
  });

  it("orders H3 prompts by shot", () => {
    const p = h3Prompts([
      finding({ id: "2", kind: "h3-prompt", title: "Shot 2 — x", data: { prompt: "B", variations: [{ n: 1, label: "Low angle", prompt: "B1" }] } }),
      finding({ id: "1", kind: "h3-prompt", title: "Shot 1 — x", data: { prompt: "A", variations: [] } }),
    ]);
    expect(p.map((x) => x.prompt)).toEqual(["A", "B"]);
    expect(p[1].variations[0].label).toBe("Low angle");
  });

  it("reads a storyboard's shots", () => {
    const sb = storyboardShots(finding({ kind: "h3-storyboard", data: { storyboard: { style: "noir", pacing: "fast", totalDuration: 9, shots: [{ n: 1, start: 0, end: 3, camera: "wide", frames: ["k1"] }] } } }));
    expect(sb.total).toBe(9);
    expect(sb.shots[0].frames).toEqual(["k1"]);
  });

  it("lists research notes", () => {
    expect(notesOf(finding({ kind: "research-digest", data: { notes: [{ title: "Paper", url: "https://x", score: 90 }] } }))[0]).toEqual({ title: "Paper", url: "https://x", summary: "", score: 90 });
    expect(notesOf(finding({ title: "Solo", url: "https://y" }))[0].title).toBe("Solo");
  });
});

describe("config form", () => {
  it("round-trips values", () => {
    const fields = configToFields({ sources: ["telegram"], limit: 20, topic: "EAs" }, { topic: "What to look for", depth: "1-3" });
    expect(fields.map((f) => f.key)).toEqual(["topic", "depth", "sources", "limit"]);
    expect(fields.find((f) => f.key === "sources")!.value).toBe('["telegram"]');
    const back = fieldsToConfig(fields.map((f) => (f.key === "depth" ? { ...f, value: "2" } : f)));
    expect(back).toEqual({ topic: "EAs", depth: 2, sources: ["telegram"], limit: 20 });
  });
  it("keeps broken JSON as text", () => {
    expect(fieldsToConfig([{ key: "x", value: "[oops" }])).toEqual({ x: "[oops" });
  });
});

describe("compact", () => {
  it("shortens counts", () => {
    expect(compact(999)).toBe("999");
    expect(compact(1284)).toBe("1.3K");
    expect(compact(12_900)).toBe("13K");
  });
});

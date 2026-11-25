import { describe, expect, it } from "vitest";
import { cleanTitle, normalizePlan, offlineControl, offlinePlan, plannerUserMessage, similarity } from "./commander";
import type { KnownApp } from "./apps";

const APPS: KnownApp[] = [
  { id: "trading-studio", name: "Trading Studio", source: "hub", description: "EAs", executors: ["code-change", "mt4-discovery"], url: "/apps/trading-studio" },
  { id: "h3-experiments", name: "H3 Prompt Lab", source: "hub", description: "H3", executors: ["code-change", "h3-recreate"], url: "/apps/h3-experiments" },
];
const EXECS = ["research", "h3-recreate", "mt4-discovery", "monitor", "code-change", "app-webhook"];
const KINDS = { research: "once", "h3-recreate": "once", "mt4-discovery": "continuous", monitor: "continuous", "code-change": "once", "app-webhook": "once" } as const;
const ctx = (existing: Parameters<typeof normalizePlan>[1]["existing"] = []) => ({
  text: "do things",
  apps: APPS,
  executorIds: EXECS,
  executorKinds: { ...KINDS },
  existing,
});

describe("normalizePlan", () => {
  it("drops unknown executors, fixes app names, keeps refs acyclic", () => {
    const plan = normalizePlan(
      {
        reply: "ok",
        tasks: [
          { ref: "t1", title: "Research bots", executor: "research", app: "Trading Studio", dependsOn: ["t2"] },
          { ref: "t2", title: "Hack the planet", executor: "nuke" },
          { ref: "t3", title: "Rank them", executor: "research", app: "trading-studio", dependsOn: ["t1", "t9"] },
        ],
      },
      ctx(),
    );
    expect(plan.tasks.map((t) => t.title)).toEqual(["Research bots", "Rank them"]);
    expect(plan.tasks[0].app).toBe("trading-studio");
    expect(plan.tasks[0].dependsOn).toEqual([]);
    expect(plan.tasks[1].dependsOn).toEqual(["t1"]);
  });

  it("uses the executor's default kind and refuses 'scheduled' with no time", () => {
    const plan = normalizePlan({ tasks: [{ title: "Find MT4 bots", executor: "mt4-discovery" }, { title: "Later", executor: "research", kind: "scheduled" }] }, ctx());
    expect(plan.tasks[0].kind).toBe("continuous");
    expect(plan.tasks[1].kind).toBe("once");
  });

  it("does not file what is already running", () => {
    const plan = normalizePlan(
      { reply: "Queued.", tasks: [{ title: "MT4 bot discovery and evaluation", executor: "mt4-discovery", app: "trading-studio" }] },
      ctx([{ id: "00000000-0000-4000-8000-000000000001", title: "MT4 Bot Discovery & Evaluation", status: "scheduled", app: "trading-studio", executor: "mt4-discovery" }]),
    );
    expect(plan.tasks).toHaveLength(0);
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.reply).toMatch(/Already running/);
  });

  it("keeps only actions on tasks that exist", () => {
    const id = "00000000-0000-4000-8000-000000000002";
    const plan = normalizePlan(
      { actions: [{ taskId: id, action: "pause" }, { taskId: "00000000-0000-4000-8000-00000000dead", action: "cancel" }, { taskId: id, action: "explode" }] },
      ctx([{ id, title: "x", status: "running", app: "", executor: "research" }]),
    );
    expect(plan.actions).toEqual([{ taskId: id, act: { action: "pause" } }]);
  });

  it("surfaces a clarifying question only when nothing was planned", () => {
    expect(normalizePlan({ clarify: "Which app?" }, ctx()).clarify).toBe("Which app?");
    expect(normalizePlan({ clarify: "Which app?", tasks: [{ title: "x", executor: "research" }] }, ctx()).clarify).toBeNull();
  });
});

describe("offlinePlan", () => {
  it("routes the owner's examples sensibly with no AI", () => {
    const mt4 = normalizePlan(offlinePlan("Find the newest MT4 trading bots on Telegram and start evaluating them", APPS), ctx());
    expect(mt4.tasks[0]).toMatchObject({ executor: "mt4-discovery", app: "trading-studio", kind: "continuous" });

    const improve = normalizePlan(offlinePlan("Improve my H3 Prompt Lab", APPS), ctx());
    expect(improve.tasks[0]).toMatchObject({ executor: "code-change", app: "h3-experiments" });

    const rec = normalizePlan(offlinePlan("Create a recurring task that researches new video generation techniques every day at 9am", APPS), ctx());
    expect(rec.tasks[0]).toMatchObject({ executor: "research", kind: "recurring" });
    expect(rec.tasks[0].schedule.dailyAt).toBe("09:00");

    const mon = normalizePlan(offlinePlan("Monitor https://example.com/health and report problems", APPS), ctx());
    expect(mon.tasks[0]).toMatchObject({ executor: "monitor", kind: "continuous" });
    expect(mon.tasks[0].config.urls).toEqual(["https://example.com/health"]);

    const repos = normalizePlan(offlinePlan("Find better open-source repositories for my photo management application", APPS), ctx());
    expect(repos.tasks[0].executor).toBe("research");
    expect(repos.tasks[0].config.sources).toEqual(["web", "github"]);
  });
});

describe("prompt + similarity", () => {
  it("names apps, executors and the focused task", () => {
    const msg = plannerUserMessage({
      text: "make it run every 2 hours",
      apps: APPS,
      executors: [{ id: "research", agent: "Research agent", describe: "researches", configHelp: { topic: "what" }, defaultKind: "once" }],
      tasks: [],
      focus: { id: "abc", title: "Video research", status: "scheduled", app: "", executor: "research", kind: "recurring", config: {}, schedule: { everyMinutes: 1440 }, question: null, result_summary: null },
      findings: [],
      conversation: [],
      now: new Date("2026-11-25T12:00:00Z"),
    });
    expect(msg).toContain("trading-studio");
    expect(msg).toContain("talking ABOUT this task (id abc)");
    expect(msg).toContain("make it run every 2 hours");
  });

  it("similarity is word overlap", () => {
    expect(similarity("MT4 bot discovery", "MT4 Bot Discovery!")).toBe(1);
    expect(similarity("research video models", "monitor trading")).toBe(0);
  });
});

describe("cleanTitle", () => {
  it("turns a command into a task name", () => {
    expect(cleanTitle("Create a recurring task that researches new video generation techniques every day")).toBe("Research new video generation techniques");
    expect(cleanTitle("Find the newest MT4 trading bots on Telegram and start evaluating them.")).toBe("Find the newest MT4 trading bots on Telegram and start evaluating them");
    expect(cleanTitle("make a task that monitors my trading systems daily at 9am")).toBe("Monitor my trading systems");
    expect(cleanTitle("Improve my H3 Prompt Lab")).toBe("Improve my H3 Prompt Lab");
  });
});

describe("offlineControl", () => {
  const tasks = [
    { id: "00000000-0000-4000-8000-0000000000a1", title: "MT4 Bot Discovery & Evaluation", status: "scheduled", app: "trading-studio", executor: "mt4-discovery", agent: "MT4 Bot Discovery" },
    { id: "00000000-0000-4000-8000-0000000000a2", title: "Research new video generation techniques", status: "scheduled", app: "", executor: "research", agent: "Research agent" },
  ] as const;
  it("acts on the task it names instead of filing a new one", () => {
    const p = normalizePlan(offlineControl("pause the MT4 bot one", [...tasks]), ctx([...tasks]));
    expect(p.tasks).toHaveLength(0);
    expect(p.actions).toEqual([{ taskId: tasks[0].id, act: { action: "pause" } }]);
    const q = normalizePlan(offlineControl("stop the video research", [...tasks]), ctx([...tasks]));
    expect(q.actions[0]).toEqual({ taskId: tasks[1].id, act: { action: "cancel" } });
  });
  it("is not a control sentence → null", () => {
    expect(offlineControl("Find better repos for photos", [...tasks])).toBeNull();
  });
  it("with a focused task, the verb applies to it", () => {
    expect(offlineControl("resume", [...tasks], tasks[1].id)).toMatchObject({ actions: [{ taskId: tasks[1].id, action: "resume" }] });
  });
});

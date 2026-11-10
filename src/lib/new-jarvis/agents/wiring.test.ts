import { describe, expect, it } from "vitest";

import {
  claimNext,
  configure,
  finish,
  newAgent,
  normalizeDoc,
  receive,
  recordThread,
  runNow,
  statusLine,
  takeable,
  type AgentsDoc,
} from "./agents";
import { briefFor } from "./describe";

const T0 = Date.parse("2026-11-09T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

function doc(...over: Parameters<typeof newAgent>[0][]): AgentsDoc {
  return { agents: over.map((o, i) => newAgent({ id: `a-test${i}`, at: iso(T0), ...o })) };
}

describe("wiring a 24/7 agent", () => {
  it("an agent filed with no steps can still be picked up", () => {
    const d = doc({ goal: "Find the newest EAs" });
    expect(d.agents[0].steps).toHaveLength(1);
    expect(takeable(d.agents[0], [], T0)).toBe(true);
  });

  it("keeps its model, apps, targets, ship mode and repeat through the store", () => {
    const d = doc({
      goal: "Scout EAs",
      pick: "openrouter:anthropic/claude-opus-5.5",
      edits: ["app:EA-World", "jarvis"],
      sendsTo: ["app:ea-world", "a-zz9", "nonsense target"],
      ship: "auto",
      repeat: "weekly",
    });
    const back = normalizeDoc(JSON.parse(JSON.stringify(d))).agents[0];
    expect(back.pick).toBe("openrouter:anthropic/claude-opus-5.5");
    expect(back.edits).toEqual(["ea-world", "jarvis"]);
    expect(back.sendsTo).toEqual(["app:ea-world", "a-zz9"]);
    expect(back.ship).toBe("auto");
    expect(back.repeat).toBe("weekly");
  });

  it("defaults to the safe choices: review, once, the default model", () => {
    const a = doc({ goal: "x", ship: "yolo" as never, repeat: "sometimes" as never, pick: "rm -rf" }).agents[0];
    expect(a.ship).toBe("review");
    expect(a.repeat).toBe("once");
    expect(a.pick).toBe("");
  });
});

describe("repeating agents", () => {
  it("rests after a round, then runs again from what the round found", () => {
    let d = doc({ goal: "Scout EAs", repeat: "daily", steps: ["search", "rank"] });
    d = claimNext(d, "pc", [], T0).doc;
    d = finish(d, "a-test0", "pc", "Sent 10 EAs to EA World.", iso(T0 + 1000));
    const a = d.agents[0];
    expect(a.status).toBe("waiting");
    expect(a.rounds).toBe(1);
    expect(a.steps.every((s) => !s.done)).toBe(true);
    expect(a.handoff?.text).toContain("Sent 10 EAs");
    expect(takeable(a, [], T0 + 60_000)).toBe(false);
    expect(statusLine(a, T0 + 60_000)).toMatch(/Next round in/);
    expect(takeable(a, [], T0 + 25 * 3_600_000)).toBe(true);
  });

  it("run now skips the rest", () => {
    let d = doc({ goal: "Scout", repeat: "weekly" });
    d = finish(d, "a-test0", "pc", "ok", iso(T0));
    d = runNow(d, "a-test0", iso(T0 + 1000));
    expect(takeable(d.agents[0], [], T0 + 2000)).toBe(true);
  });

  it("a one-off agent still finishes for good", () => {
    const d = finish(doc({ goal: "once" }), "a-test0", "pc", "done", iso(T0));
    expect(d.agents[0].status).toBe("done");
  });

  it("switching to once drops a pending rest", () => {
    let d = finish(doc({ goal: "x", repeat: "daily" }), "a-test0", "pc", "ok", iso(T0));
    d = configure(d, "a-test0", { repeat: "once" }, iso(T0 + 1));
    expect(d.agents[0].nextRunAt).toBeUndefined();
  });
});

describe("agents working together", () => {
  it("a message from another agent wakes a resting one with a new step", () => {
    let d = doc({ goal: "Scout" }, { goal: "Test EAs", repeat: "weekly" });
    d = finish(d, "a-test1", "pc", "Tested last batch.", iso(T0));
    d = receive(d, "a-test1", "a-test0", "EA One, EA Two", iso(T0 + 1000));
    const tester = d.agents[1];
    expect(tester.nextRunAt).toBeUndefined();
    expect(tester.steps.at(-1)?.text).toContain("EA One");
    expect(takeable(tester, [], T0 + 2000)).toBe(true);
  });

  it("a paused agent only logs what it was sent", () => {
    let d = doc({ goal: "Scout" }, { goal: "Test" });
    d = { agents: d.agents.map((a) => (a.id === "a-test1" ? { ...a, status: "paused" } : a)) };
    const before = d.agents[1].steps.length;
    d = receive(d, "a-test1", "a-test0", "hello", iso(T0));
    expect(d.agents[1].steps).toHaveLength(before);
    expect(d.agents[1].status).toBe("paused");
  });

  it("records what a harness run left behind", () => {
    const d = recordThread(doc({ goal: "fix" }), "a-test0", { id: "t1", branch: "jarvis/fix", at: iso(T0), outcome: "ready" }, "pc");
    expect(d.agents[0].thread?.outcome).toBe("ready");
    expect(d.agents[0].log.at(-1)?.text).toContain("jarvis/fix");
  });
});

describe("the brief a machine gets", () => {
  it("carries the model, apps, ship mode and targets as lines the runner can read", () => {
    const a = doc({
      goal: "Improve EA World",
      pick: "claude-subscription:claude-opus-5",
      edits: ["ea-world"],
      ship: "review",
      sendsTo: ["app:ea-world"],
    }).agents[0];
    const text = briefFor(a, T0);
    expect(text).toMatch(/^POWERED BY: claude-subscription:claude-opus-5$/m);
    expect(text).toMatch(/^EDITS APPS: ea-world$/m);
    expect(text).toMatch(/^SHIP: review$/m);
    expect(text).toMatch(/^SENDS RESULTS TO: app:ea-world$/m);
    expect(text).toContain("agent_send");
  });

  it("says default when no model was picked, and leaves out what isn't wired", () => {
    const text = briefFor(doc({ goal: "x" }).agents[0], T0);
    expect(text).toMatch(/^POWERED BY: default$/m);
    expect(text).not.toMatch(/EDITS APPS|SHIP:|SENDS RESULTS TO/);
  });
});

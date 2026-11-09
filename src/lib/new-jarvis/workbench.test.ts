import { describe, expect, it } from "vitest";

import type { HarnessEvent, ThreadSummary } from "./harness/types";
import { digest, pickHarness, runWorkTool, startWork, threadTitle } from "./workbench";

function session(over: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: "t1",
    harness: "deepseek",
    label: "DeepSeek Harness",
    title: "A thread",
    createdAt: 1,
    status: "thinking",
    detail: "",
    model: "",
    usd: 0,
    busy: true,
    strict: false,
    laneWrites: true,
    trust: "trusted",
    preview: null,
    cursor: 0,
    gate: null,
    worktree: { path: "C:\\wt", branch: "jarvis-a", base: "main", repo: "C:\\repo", notes: [] },
    landed: null,
    ...over,
  };
}

function event(seq: number, kind: string, extra: Record<string, unknown> = {}): HarnessEvent {
  return { seq, at: seq, kind, ...extra };
}

describe("digest", () => {
  it("joins streamed text and keeps one row per finished tool", () => {
    const d = digest(
      [
        event(1, "user", { text: "build it" }),
        event(2, "text", { text: "I'll " }),
        event(3, "text", { text: "start." }),
        event(4, "tool", { callId: "c1", name: "Edit", title: "src/a.ts", kindOf: "write" }),
        event(5, "tool_end", { callId: "c1", output: "ok" }),
      ],
      session(),
    );

    expect(d.said).toBe("I'll start.");
    expect(d.steps).toEqual([{ tool: "Edit", status: "ok", title: "src/a.ts" }]);
    expect(d.status).toBe("thinking");
    expect(d.gate).toBeNull();
  });

  it("surfaces the one live gate, with the words that explain it", () => {
    const d = digest(
      [
        event(1, "tool", { callId: "c1", name: "Bash", title: "npm test", kindOf: "run" }),
        event(2, "gate", { gateId: "g1", name: "Bash", title: "Run npm test", why: "It needs to run the tests.", risk: "act" }),
      ],
      session({ status: "waiting", gate: null }),
    );

    expect(d.gate).toEqual({
      gateId: "g1",
      name: "Bash",
      title: "Run npm test",
      why: "It needs to run the tests.",
      risk: "act",
    });
  });

  it("reports a failure once, not as a permanent cloud over a healthy thread", () => {
    const d = digest(
      [
        event(1, "user", { text: "go" }),
        event(2, "tool", { callId: "c1", name: "Bash", title: "tsc", kindOf: "run" }),
        event(3, "tool_end", { callId: "c1", output: "TS2322: wrong type", ok: false }),
      ],
      session(),
    );
    expect(d.steps[0].status).toBe("failed");
    expect(d.steps[0].said).toContain("TS2322");
  });

  it("does not send the whole transcript back as `said`", () => {
    const huge = "x".repeat(10_000);
    const d = digest([event(1, "text", { text: huge })], session());
    expect(d.said.length).toBeLessThan(3_000);
    expect(d.said).toContain("more characters");
  });
});

describe("pickHarness", () => {
  it("defaults to DeepSeek Harness, because that is the one this hub is built around", () => {
    expect(pickHarness(undefined)).toBe("deepseek");
    expect(pickHarness("nonsense")).toBe("deepseek");
    expect(pickHarness("claude")).toBe("claude");
  });
});

describe("threadTitle", () => {
  it("uses the first line, without its markdown scaffolding", () => {
    expect(threadTitle("## Add dark mode\nand a toggle")).toBe("Add dark mode");
    expect(threadTitle("")).toBe("Chat build");
  });
});

describe("startWork", () => {
  it("cuts a worktree from the checkout the bridge reported, then says the brief", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const bridge = {
      folder: "C:\\repo",
      call: async <T,>(route: string, args: Record<string, unknown> = {}): Promise<T> => {
        calls.push([route, args]);
        if (route === "harness/start") {
          return {
            session: session({
              id: "t9",
              worktree: { path: "C:\\wt", branch: "jarvis-x", base: "main", repo: "C:\\repo", notes: ["cut from main"] },
            }),
          } as T;
        }
        return {} as T;
      },
    };

    const out = await startWork(bridge, { task: "Add dark mode to the settings page and its toggle" });

    expect(out.threadId).toBe("t9");
    expect(out.branch).toBe("jarvis-x");
    expect(calls[0][0]).toBe("harness/start");
    expect(calls[0][1]).toMatchObject({ harness: "deepseek", repo: "C:\\repo", laneWrites: true, trust: "trusted" });
    expect(calls[1]).toEqual(["harness/say", { id: "t9", text: "Add dark mode to the settings page and its toggle" }]);
  });

  it("refuses a brief that is too short to build from", async () => {
    const bridge = { folder: "C:\\repo", call: async <T,>(): Promise<T> => ({}) as T };
    await expect(startWork(bridge, { task: "fix it" })).rejects.toThrow(/sentence or more/);
  });

  it("asks for a folder rather than guessing one", async () => {
    const bridge = { call: async <T,>(): Promise<T> => ({}) as T };
    await expect(startWork(bridge, { task: "Add a page and wire it into the nav" })).rejects.toThrow(/doesn't know where the repo is/);
  });

  it("uses a project slug instead of a repo when it is a brand-new app", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const bridge = {
      folder: "C:\\repo",
      call: async <T,>(route: string, args: Record<string, unknown> = {}): Promise<T> => {
        calls.push([route, args]);
        return (route === "harness/start" ? { session: session({ id: "t2" }) } : {}) as T;
      },
    };
    await startWork(bridge, { task: "Build a recipe box app with photos", project: "recipe-box" });
    expect(calls[0][1]).toMatchObject({ project: "recipe-box" });
    expect(calls[0][1].repo).toBeUndefined();
  });
});

describe("runWorkTool", () => {
  it("answers a gate with the owner's decision and reports a remembered tool", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const bridge = {
      call: async <T,>(route: string, args: Record<string, unknown> = {}): Promise<T> => {
        calls.push([route, args]);
        return { stale: false, remembered: "Bash" } as T;
      },
    };
    const out = await runWorkTool("work_decide", { threadId: "t1", gateId: "g1", allow: true, always: true }, bridge);
    expect(calls[0]).toEqual(["harness/decide", { id: "t1", gateId: "g1", allow: true, always: true }]);
    expect(out.answered).toBe("yes");
    expect(out.rememberedFor).toBe("Bash");
  });

  it("lands with a sentence that makes clear where the work did and did not go", async () => {
    const bridge = {
      call: async <T,>(route: string): Promise<T> => {
        if (route === "harness/land") return { committed: true, merged: true, sha: "abc1234", why: "" } as T;
        return {} as T;
      },
    };
    const out = await runWorkTool("work_finish", { threadId: "t1", action: "land", message: "Dark mode" }, bridge);
    expect(out.merged).toBe(true);
    expect(String(out.note)).toContain("NOT pushed");
  });

  it("reads a thread and tells the model to ask the owner about a gate", async () => {
    const bridge = {
      call: async <T,>(route: string): Promise<T> => {
        if (route !== "harness/events") return {} as T;
        return {
          events: [event(1, "gate", { gateId: "g2", name: "Write", title: "Write src/x.ts", why: "outside the worktree", risk: "act" })],
          cursor: 1,
          dropped: false,
          session: session({ status: "waiting" }),
        } as T;
      },
    };
    const out = await runWorkTool("work_check", { threadId: "t1", waitMs: 0 }, bridge);
    expect(out.gate).toMatchObject({ gateId: "g2" });
    expect(String(out.next)).toContain("work_decide");
  });
});

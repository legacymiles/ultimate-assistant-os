import { afterEach, describe, expect, it, vi } from "vitest";
import { diffRound, extractUrls, monitorExecutor, targetsOf } from "./monitor";
import type { StepContext } from "./types";
import { buildTask } from "../engine";
import type { Task } from "../types";

describe("monitor helpers", () => {
  it("pulls URLs out of an answer", () => {
    expect(extractUrls("watch https://a.com/health, and https://b.io.")).toEqual(["https://a.com/health", "https://b.io"]);
    expect(targetsOf({ urls: ["https://a.com"] }, [{ a: "also https://c.dev" }])).toEqual(["https://a.com", "https://c.dev"]);
  });

  it("alerts only on change", () => {
    const down = { url: "https://a.com", ok: false, status: 500, ms: 10, error: "HTTP 500" };
    expect(diffRound(undefined, [down], 5000).map((a) => a.kind)).toEqual(["down"]);
    expect(diffRound({ "https://a.com": { ok: false, since: "x" } }, [down], 5000)).toEqual([]);
    expect(diffRound({ "https://a.com": { ok: false, since: "x" } }, [{ ...down, ok: true, status: 200 }], 5000).map((a) => a.kind)).toEqual(["up"]);
  });
});

describe("monitor executor", () => {
  afterEach(() => vi.unstubAllGlobals());

  function ctx(config: Record<string, unknown>) {
    const task: Task = { ...buildTask({ title: "watch", executor: "monitor", kind: "continuous", config }), id: "00000000-0000-4000-8000-000000000001", user_id: "u", created_at: "", updated_at: "" };
    const found: string[] = [];
    const c: StepContext = {
      task,
      state: {},
      steps: [],
      signal: new AbortController().signal,
      now: () => new Date("2026-11-25T12:00:00Z"),
      log: async () => {},
      progress: async () => {},
      finding: async (f) => {
        found.push(f.title);
        return { id: "f", isNew: true };
      },
      knownKeys: async () => new Set(),
      spawn: async () => "x",
      notify: async () => {},
      recentFindings: async () => [],
      meter: { aiCalls: 0, searches: 0 },
    };
    return { c, found };
  }

  it("a token-protected endpoint (401) is up, not down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const { c, found } = ctx({ urls: ["https://search.example.com"] });
    const r = await monitorExecutor.run(c);
    expect(r).toMatchObject({ outcome: "done" });
    expect(found).toEqual([]);
  });

  it("strictAuth makes a 401 count as down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const { c, found } = ctx({ urls: ["https://search.example.com"], strictAuth: true });
    await monitorExecutor.run(c);
    expect(found[0]).toMatch(/DOWN/);
  });

  it("asks for targets when it has none", async () => {
    const { c } = ctx({});
    expect((await monitorExecutor.run(c)).outcome).toBe("needs_input");
  });
});

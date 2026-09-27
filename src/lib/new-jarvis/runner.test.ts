import { describe, expect, it, vi } from "vitest";
import { forModel, runBlock, MAX_ROUNDS, type RunnerDeps, type StepResponse, type WireMessage } from "./runner";
import type { Gate } from "./types";

/** A think() that replays a fixed script and records what it was sent. */
function scripted(responses: StepResponse[]) {
  const seen: WireMessage[][] = [];
  let i = 0;
  const think = vi.fn(async (messages: WireMessage[]) => {
    seen.push(structuredClone(messages));
    return responses[Math.min(i++, responses.length - 1)];
  });
  return { think, seen };
}

function deps(over: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    think: vi.fn(async () => ({ toolCall: null, text: "done" })),
    runTool: vi.fn(async () => ({ ok: true })),
    askGate: vi.fn(async () => true),
    update: vi.fn(),
    ...over,
  };
}

describe("forModel", () => {
  it("never sends an image back", () => {
    const out = forModel({ ok: true, png: "A".repeat(50_000), url: "https://x.test" });
    expect(out).not.toContain("AAAA");
    expect(out).toContain("shown to the owner");
    expect(out).toContain("x.test");
  });

  it("truncates a huge page read and says so", () => {
    const out = forModel({ text: "x".repeat(40_000) });
    expect(out.length).toBeLessThan(20_000);
    expect(out).toContain("not shown");
  });

  // The capture path's whole promise is that a value read off a page reaches
  // the Record without a model seeing it. This is the last lock on that door.
  it("never sends page field values back", () => {
    const out = forModel({ ok: true, fields: [{ key: "acct", preview: "••••4821" }], values: { acct: "12345678" } });
    expect(out).not.toContain("12345678");
    expect(out).toContain("not shown to the model");
    expect(out).toContain("acct");
  });

  it("drops the bookkeeping the model has no use for", () => {
    expect(forModel({ ok: true, ms: 12, url: "a" })).not.toContain('"ms"');
  });
});

describe("runBlock", () => {
  it("answers without touching anything when no tool is called", async () => {
    const d = deps();
    const out = await runBlock({ command: "what is my name", mode: "ask" }, d);
    expect(out.status).toBe("done");
    expect(out.answer).toBe("done");
    expect(d.runTool).not.toHaveBeenCalled();
  });

  it("runs a free step without a gate, then answers", async () => {
    const { think } = scripted([
      { toolCall: { id: "1", name: "browser_read", args: {} } },
      { toolCall: null, text: "The page says hello." },
    ]);
    const askGate = vi.fn(async () => true);
    const runTool = vi.fn(async () => ({ ok: true, text: "hello" }));
    const out = await runBlock({ command: "read it", mode: "browse" }, deps({ think, runTool, askGate }));

    expect(askGate).not.toHaveBeenCalled();
    expect(runTool).toHaveBeenCalledWith("browser/read", {});
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0].status).toBe("ok");
    expect(out.answer).toBe("The page says hello.");
  });

  it("gates a step that cannot be undone, and runs it on a yes", async () => {
    const { think } = scripted([
      { toolCall: { id: "1", name: "browser_click", args: { ref: "ref_4", name: "Send" } } },
      { toolCall: null, text: "Sent." },
    ]);
    const gates: Gate[] = [];
    const askGate = vi.fn(async (g: Gate) => {
      gates.push(g);
      return true;
    });
    const runTool = vi.fn(async () => ({ ok: true }));
    const out = await runBlock({ command: "send it", mode: "browse" }, deps({ think, runTool, askGate }));

    expect(askGate).toHaveBeenCalledTimes(1);
    expect(gates[0].risk).toBe("grave");
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(out.steps[0].status).toBe("ok");
  });

  // The one that matters most: a no has to actually stop the thing.
  it("does not run a refused step, and tells the model not to retry", async () => {
    const { think, seen } = scripted([
      { toolCall: { id: "1", name: "browser_click", args: { ref: "ref_4", name: "Delete account" } } },
      { toolCall: null, text: "I did not delete it." },
    ]);
    const runTool = vi.fn(async () => ({ ok: true }));
    const out = await runBlock(
      { command: "delete it", mode: "browse" },
      deps({ think, runTool, askGate: vi.fn(async () => false) }),
    );

    expect(runTool).not.toHaveBeenCalled();
    expect(out.steps[0].status).toBe("refused");
    const toolMsg = seen[1].find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("declined");
    expect(out.status).toBe("done");
  });

  it("records a failing tool as a failed step and keeps going", async () => {
    const { think, seen } = scripted([
      { toolCall: { id: "1", name: "browser_read", args: {} } },
      { toolCall: null, text: "The local agent is off." },
    ]);
    const runTool = vi.fn(async () => {
      throw new Error("The local agent is not running on this PC.");
    });
    const out = await runBlock({ command: "read it", mode: "browse" }, deps({ think, runTool }));

    expect(out.steps[0].status).toBe("failed");
    expect(out.steps[0].error).toContain("not running");
    expect(seen[1].find((m) => m.role === "tool")?.content).toContain("not running");
    expect(out.status).toBe("done");
  });

  it("tells the model when it invents a tool, instead of running anything", async () => {
    const { think, seen } = scripted([
      { toolCall: { id: "1", name: "send_email", args: { to: "a@b.c" } } },
      { toolCall: null, text: "I cannot send email." },
    ]);
    const runTool = vi.fn(async () => ({ ok: true }));
    await runBlock({ command: "email sam", mode: "do" }, deps({ think, runTool }));

    expect(runTool).not.toHaveBeenCalled();
    expect(seen[1].find((m) => m.role === "tool")?.content).toContain("no tool called send_email");
  });

  it("never acts on malformed arguments", async () => {
    const { think } = scripted([
      { toolCall: null, malformed: { id: "1", name: "browser_click", raw: "{ref:" } },
      { toolCall: null, text: "Sorry." },
    ]);
    const runTool = vi.fn(async () => ({ ok: true }));
    await runBlock({ command: "click", mode: "browse" }, deps({ think, runTool }));
    expect(runTool).not.toHaveBeenCalled();
  });

  it("gives up rather than looping forever", async () => {
    const think = vi.fn(async () => ({ toolCall: { id: "1", name: "browser_read", args: {} } }));
    const out = await runBlock({ command: "spin", mode: "browse" }, deps({ think }));
    expect(out.status).toBe("failed");
    expect(out.error).toContain(`${MAX_ROUNDS} steps`);
  });

  it("reports a dead agent route as a failed block, not a thrown error", async () => {
    const think = vi.fn(async () => {
      throw new Error("Failed to fetch");
    });
    const out = await runBlock({ command: "hi", mode: "ask" }, deps({ think }));
    expect(out.status).toBe("failed");
    expect(out.error).toBe("Failed to fetch");
  });

  it("stops when the owner cancels", async () => {
    const c = new AbortController();
    c.abort();
    const out = await runBlock({ command: "hi", mode: "ask" }, deps({ signal: c.signal }));
    expect(out.status).toBe("stopped");
  });
});

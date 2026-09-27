import { describe, expect, it } from "vitest";
import { modelFailure, routeFor, sanitizeAssistant, toolsFor } from "./agentTools";

describe("toolsFor", () => {
  it("offers nothing the bridge cannot actually do", () => {
    const names = toolsFor({ browser: false, shell: true, files: false, system: false }).map((t) => t.name);
    expect(names).toContain("shell_run");
    expect(names.some((n) => n.startsWith("browser_"))).toBe(false);
    expect(names).not.toContain("files_read");
  });

  it("offers nothing at all when the agent is down", () => {
    expect(toolsFor({})).toHaveLength(0);
  });
});

describe("routeFor", () => {
  it("maps a tool name to its bridge route", () => {
    expect(routeFor("browser_click")).toBe("browser/click");
    expect(routeFor("clipboard_write")).toBe("system/clipboard/write");
  });

  it("returns nothing for a tool the model invented", () => {
    expect(routeFor("send_email")).toBe("");
  });
});

describe("sanitizeAssistant", () => {
  // The bug this exists for: a provider sets reasoning: null, we echo it back
  // verbatim, and the next round dies with "expected string, received null"
  // several steps into a run that had already done real work.
  it("drops null fields the provider will not accept back", () => {
    const out = sanitizeAssistant({ role: "assistant", content: "hi", reasoning: null });
    expect("reasoning" in out).toBe(false);
    expect(out.content).toBe("hi");
  });

  it("keeps everything else untouched, including the tool calls", () => {
    const calls = [{ id: "1", function: { name: "shell_run", arguments: "{}" } }];
    const out = sanitizeAssistant({ role: "assistant", tool_calls: calls, id: "msg_1", reasoning_details: [] });
    expect(out.tool_calls).toBe(calls);
    expect(out.id).toBe("msg_1");
    expect(out.reasoning_details).toEqual([]);
  });

  it("does not mistake an empty string or false for null", () => {
    const out = sanitizeAssistant({ content: "", done: false, n: 0 });
    expect(out.content).toBe("");
    expect(out.done).toBe(false);
    expect(out.n).toBe(0);
  });
});

describe("modelFailure", () => {
  it("never leaks the provider's payload", () => {
    for (const s of [400, 401, 402, 429, 500, 502, 504, 418]) {
      const m = modelFailure(s);
      expect(m).not.toMatch(/invalid_request_error|\{|\}|param|messages\./);
      expect(m.length).toBeGreaterThan(20);
    }
  });

  it("names the recovery, not just the problem", () => {
    expect(modelFailure(401)).toContain("OPENROUTER_API_KEY");
    expect(modelFailure(402)).toMatch(/credit/i);
    expect(modelFailure(429)).toMatch(/again/i);
  });

  it("reassures that a failed round did not touch the machine", () => {
    expect(modelFailure(503)).toMatch(/Nothing on your PC/);
  });

  it("does not blame the owner for a 400", () => {
    expect(modelFailure(400)).toMatch(/steps above already ran/);
  });
});

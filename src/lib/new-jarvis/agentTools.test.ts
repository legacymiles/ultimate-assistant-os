import { describe, expect, it } from "vitest";
import { isHubTool, modelFailure, routeFor, sanitizeAssistant, toolsFor } from "./agentTools";

describe("toolsFor", () => {
  it("offers nothing the bridge cannot actually do", () => {
    const names = toolsFor({ browser: false, shell: true, files: false, system: false }).map((t) => t.name);
    expect(names).toContain("shell_run");
    expect(names.some((n) => n.startsWith("browser_"))).toBe(false);
    expect(names).not.toContain("files_read");
  });

  // The point of the hub tools: remembering something the owner just told you
  // must not depend on whether a local agent happens to be running.
  it("keeps the owner's own stores when the agent is down", () => {
    const names = toolsFor({}).map((t) => t.name);
    expect(names).toContain("propose_memory");
    expect(names).toContain("record_set");
    expect(names).toContain("lists_add_item");
    expect(names.every((n) => isHubTool(n))).toBe(true);
  });

  it("offers no PC tool when the agent is down", () => {
    const names = toolsFor({}).map((t) => t.name);
    for (const n of ["shell_run", "browser_open", "files_read", "system_windows", "page_fields"]) {
      expect(names, n).not.toContain(n);
    }
  });

  it("offers capture only through the bridge, but saving always", () => {
    expect(toolsFor({ browser: true }).map((t) => t.name)).toContain("page_fields");
    // record_capture is a hub tool: it writes from what the tab already holds,
    // so it survives the agent stopping between the read and the save.
    expect(isHubTool("record_capture")).toBe(true);
    expect(isHubTool("page_fields")).toBe(false);
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

  it("routes a hub tool to the page, not the bridge", () => {
    expect(routeFor("record_capture")).toBe("hub/record_capture");
    expect(routeFor("propose_memory")).toBe("hub/propose_memory");
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
    // OpenRouter answers 401 when the balance is gone, so the 401 copy has to
    // name credit first or it sends the owner to check a working key.
    expect(modelFailure(401)).toMatch(/balance|credit/i);
    expect(modelFailure(401)).toContain("OPENROUTER_API_KEY");
    expect(modelFailure(402)).toMatch(/credit/i);
    expect(modelFailure(429)).toMatch(/again/i);
  });

  // The clause has to scope itself to the failed round: it can land under a
  // ledger showing three completed shell steps, and an unscoped "nothing was
  // touched" would contradict what is on screen right above it.
  it("scopes its reassurance to the round, not the run", () => {
    expect(modelFailure(503)).toMatch(/steps above already ran/);
    expect(modelFailure(503)).toMatch(/nothing new was touched/);
  });

  it("always offers a next move", () => {
    for (const s of [400, 401, 402, 429, 500, 504, 418]) {
      expect(modelFailure(s), String(s)).toMatch(/again|Check|Top it up|server log/);
    }
  });

  it("does not blame the owner for a 400", () => {
    expect(modelFailure(400)).toMatch(/steps above already ran/);
  });
});

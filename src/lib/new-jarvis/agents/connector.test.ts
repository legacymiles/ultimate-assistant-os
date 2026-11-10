import { describe, expect, it } from "vitest";

import { INSTRUCTIONS, TOOLS } from "@/lib/jarvis/mcpProtocol";
import { ALL_NEEDS } from "./agents";

// ---------------------------------------------------------------------------
// The connector is the ONLY way a runner reaches an agent, so a verb that is
// missing, misnamed or missing a required argument means the laptop wakes up
// and silently cannot help. A live call needs the owner's real token, so this
// checks the thing a live call would have caught: that the six verbs are
// declared, take what the handler reads, and say what they are for.
// ---------------------------------------------------------------------------

const AGENT_TOOLS = ["agent_list", "agent_next", "agent_note", "agent_handoff", "agent_done", "agent_add"];

function tool(name: string) {
  return TOOLS.find((t) => t.name === name);
}

describe("the agent verbs on the connector", () => {
  it("declares all six", () => {
    expect(AGENT_TOOLS.filter((n) => tool(n))).toEqual(AGENT_TOOLS);
  });

  it("routes by prefix, so every one starts with agent_", () => {
    // The MCP route dispatches on name.startsWith("agent_").
    for (const name of AGENT_TOOLS) expect(name.startsWith("agent_")).toBe(true);
  });

  it("gives every one a real description", () => {
    for (const name of AGENT_TOOLS) {
      expect(tool(name)!.description.length).toBeGreaterThan(60);
    }
  });

  it("asks agent_next what the machine has, and lists the needs it understands", () => {
    const next = tool("agent_next")!;
    const schema = next.inputSchema as { properties: Record<string, { description?: string }>; required?: string[] };
    expect(schema.required).toContain("have");
    // Every need the matcher knows must be offered, or a runner cannot report it.
    for (const need of ALL_NEEDS) {
      expect(schema.properties.have.description).toContain(need);
    }
  });

  it("requires an id and a note on the verbs that change one", () => {
    for (const name of ["agent_note", "agent_handoff"]) {
      const req = (tool(name)!.inputSchema as { required?: string[] }).required ?? [];
      expect(req).toContain("id");
      expect(req).toContain("note");
    }
    expect((tool("agent_done")!.inputSchema as { required?: string[] }).required).toContain("id");
    expect((tool("agent_add")!.inputSchema as { required?: string[] }).required).toContain("goal");
  });

  it("tells agent_handoff it is the thing to call before stopping", () => {
    // This sentence is the only thing standing between "resumes" and "starts
    // over every morning", so it is worth a test.
    expect(tool("agent_handoff")!.description).toMatch(/BEFORE YOU STOP/i);
  });

  it("warns agent_next not to claim tools it has not checked for", () => {
    // The warning belongs on the `have` argument, which is what a runner is
    // filling in when it would be tempted to guess.
    const schema = tool("agent_next")!.inputSchema as { properties: Record<string, { description?: string }> };
    expect((schema.properties.have.description ?? "").toUpperCase()).toContain("CHECKED");
  });

  it("mentions agents in the connector's own instructions", () => {
    // A tool nothing points at does not get called.
    expect(INSTRUCTIONS).toContain("agent_next");
    expect(INSTRUCTIONS).toContain("agent_handoff");
  });

  it("has no duplicate tool names anywhere in the connector", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

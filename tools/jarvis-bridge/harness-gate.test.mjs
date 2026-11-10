import { describe, expect, it } from "vitest";

import { autoAllow, describeTool } from "./harness-gate.mjs";

// The policy is the line between "a build runs" and "a build waits for a card
// nobody is watching". These pin the two names that made it wait.

const allowed = (name, input, opts = { trust: "trusted" }) => autoAllow(describeTool(name, input, "C:/work"), opts);

describe("a trusted build's own tools", () => {
  it("runs a PowerShell command without asking", () => {
    // The Claude Code SDK calls its Windows shell `PowerShell`, not `Bash`.
    expect(allowed("PowerShell", { command: "node -v; npm -v" })).toBe(true);
  });

  it("still stops a PowerShell command that deletes", () => {
    expect(allowed("PowerShell", { command: "Remove-Item -Recurse -Force ." })).toBe(false);
  });

  it("reads the Jarvis connector's findings without asking", () => {
    expect(allowed("mcp__jarvis-memory__get_findings", {})).toBe(true);
  });

  it("does not wave through an MCP tool that reaches a client", () => {
    expect(allowed("mcp__jarvis-memory__client_review_preview", {})).toBe(false);
  });

  it("lets a build look at a reference page without asking", () => {
    expect(allowed("mcp__plugin_playwright_playwright__browser_navigate", {})).toBe(true);
    expect(allowed("mcp__plugin_playwright_playwright__browser_take_screenshot", {})).toBe(true);
  });

  it("keeps a browser click gated", () => {
    expect(allowed("mcp__plugin_playwright_playwright__browser_click", {})).toBe(false);
  });

  it("installs a brand-new project's own packages without asking", () => {
    expect(allowed("PowerShell", { command: "npm install" }, { trust: "trusted", project: true })).toBe(true);
  });

  it("still asks before installing into a shared worktree", () => {
    expect(allowed("PowerShell", { command: "npm install" }, { trust: "trusted", project: false })).toBe(false);
  });

  it("keeps asking under Ask", () => {
    expect(allowed("PowerShell", { command: "node -v" }, { trust: "ask" })).toBe(false);
  });
});

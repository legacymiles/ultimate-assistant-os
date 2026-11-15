import { describe, expect, it } from "vitest";

import { autoAllow, describeTool, pushIsGrave } from "./harness-gate.mjs";

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
    expect(allowed("mcp__plugin_playwright_playwright__browser_evaluate", {})).toBe(true);
  });

  it("keeps a browser click gated", () => {
    expect(allowed("mcp__plugin_playwright_playwright__browser_click", {})).toBe(false);
  });

  it("lets a build drive its own preview", () => {
    expect(allowed("mcp__plugin_playwright_playwright__browser_click", {}, { trust: "trusted", laneWrites: true })).toBe(true);
    expect(allowed("mcp__plugin_playwright_playwright__browser_press_key", {}, { trust: "trusted", project: true })).toBe(true);
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

  // The two cards that stopped a "make it blue" edit for the owner.
  it("lets a build lane clear its own scratch folder", () => {
    const lane = { trust: "trusted", laneWrites: true };
    expect(allowed("Bash", { command: "cp .shots/mine/a.css src/a.css && rm -rf .shots .playwright-mcp" }, lane)).toBe(true);
    expect(allowed("PowerShell", { command: "Remove-Item -Recurse -Force .shots" }, lane)).toBe(true);
  });

  it("runs Monitor like any other command", () => {
    expect(allowed("Monitor", { command: "gh pr checks 29" }, { trust: "trusted", laneWrites: true })).toBe(true);
  });
});

describe("a delete that could reach outside the worktree", () => {
  const lane = { trust: "trusted", laneWrites: true };
  it.each([
    "rm -rf .",
    "rm -rf *",
    "rm -rf ../other",
    "rm -rf /c/Users/honey",
    "rm -rf ~/x",
    "rm -rf C:/dev",
    "rm -rf node_modules",
    "rm -rf .git",
    "cd .. && rm -rf build",
    "rm -rf $DIR",
    "find . -name x | xargs rm",
  ])("still asks for %s", (command) => {
    expect(allowed("Bash", { command }, lane)).toBe(false);
  });

  it("still asks in an ordinary chat thread", () => {
    expect(allowed("Bash", { command: "rm -rf .shots" }, { trust: "trusted" })).toBe(false);
  });
});

describe("a build's own commit and push", () => {
  // The exact line a quick edit ended on (Personas Studio, 15 Nov 2026). The
  // commit's `-F -` was read as `push -f`, and the edit waited 17 minutes on
  // "Allow once".
  const chained = [
    "cd C:/Users/honey/.jarvis-harness/worktrees/personas-studio-v2-client-edits-da584f && git add -A src/app/globals.css && git commit -q -F - <<'EOF' && git push -q -u origin HEAD && git log --oneline -1",
    "Personas Studio: purple brand colours and a bold centred hero",
    "",
    "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>",
    "EOF",
  ].join("\n");

  it("is not a force push", () => {
    expect(pushIsGrave(chained)).toBe(false);
  });

  it("passes for a trusted build lane", () => {
    const wt = "C:/Users/honey/.jarvis-harness/worktrees/personas-studio-v2-client-edits-da584f";
    const d = describeTool("Bash", { command: chained }, wt);
    expect(autoAllow(d, { trust: "trusted", laneWrites: true, project: wt })).toBe(true);
  });

  it("still stops a real force push or a push to main, chained or not", () => {
    expect(pushIsGrave("git commit -q -F - && git push -f origin HEAD")).toBe(true);
    expect(pushIsGrave("git add -A && git commit -m x && git push origin main")).toBe(true);
    expect(pushIsGrave("git push --force-with-lease")).toBe(true);
    expect(pushIsGrave("git push origin HEAD:main")).toBe(true);
  });
});

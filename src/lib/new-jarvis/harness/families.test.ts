import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { askedBefore, familyOf } from "./families";
import { EMPTY_THREAD } from "./types";
import type { GateCard, ThreadView, Turn } from "./types";

const card = (over: Partial<GateCard> = {}): GateCard => ({
  gateId: "g1",
  name: "Write",
  title: "Write x.ts",
  why: "",
  risk: "act",
  patch: "",
  command: "",
  path: "x.ts",
  askedAt: 0,
  ...over,
});

const turn = (gates: GateCard[]): Turn => ({
  id: "t1",
  at: 0,
  prompt: "",
  text: "",
  thinking: "",
  tools: [],
  gates,
  plan: [],
  notes: [],
  status: "running",
  ms: 0,
  usd: 0,
  error: "",
});

const view = (gates: GateCard[]): ThreadView => ({ ...EMPTY_THREAD, turns: [turn(gates)] });

describe("which cards are the same question", () => {
  it("treats writing and editing a file as one act", () => {
    expect(familyOf("Write")).toBe(familyOf("Edit"));
    expect(familyOf("Edit")).toBe(familyOf("MultiEdit"));
    expect(familyOf("NotebookEdit")).toBe(familyOf("Write"));
  });

  it("keeps every MCP tool its own, because the name is the risk", () => {
    expect(familyOf("mcp__pw__browser_navigate")).not.toBe(familyOf("mcp__pw__browser_evaluate"));
    expect(familyOf("Bash")).toBe("Bash");
  });

  it("agrees with the copy the bridge actually enforces", () => {
    // Two files, one rule. If they drift the page offers an "Always" the
    // bridge will not honour, which is worse than not offering it.
    const src = readFileSync(path.join(process.cwd(), "tools/jarvis-bridge/harness-gate.mjs"), "utf8");
    for (const name of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
      expect(src).toContain(`["${name}", "write-a-file"]`);
    }
    expect(familyOf("Write")).toBe("write-a-file");
  });
});

describe("offering Always first on a repeat", () => {
  it("is quiet the first time a tool asks", () => {
    expect(askedBefore(view([]), card())).toBe(false);
  });

  it("fires when the same act was already allowed under another name", () => {
    const earlier = card({ gateId: "g0", name: "Write", answered: true, allowed: true });
    expect(askedBefore(view([earlier]), card({ gateId: "g1", name: "Edit" }))).toBe(true);
  });

  it("fires for the same MCP tool asking twice — the case that wasted the time", () => {
    const earlier = card({ gateId: "g0", name: "mcp__pw__browser_resize", answered: true, allowed: true });
    expect(askedBefore(view([earlier]), card({ gateId: "g1", name: "mcp__pw__browser_resize" }))).toBe(true);
  });

  it("does not fire for a different MCP tool", () => {
    const earlier = card({ gateId: "g0", name: "mcp__pw__browser_resize", answered: true, allowed: true });
    expect(askedBefore(view([earlier]), card({ gateId: "g1", name: "mcp__pw__browser_evaluate" }))).toBe(false);
  });

  it("ignores a refusal and the card being asked right now", () => {
    const refused = card({ gateId: "g0", name: "Write", answered: true, allowed: false });
    expect(askedBefore(view([refused]), card({ gateId: "g1", name: "Edit" }))).toBe(false);
    const live = card({ gateId: "g1", name: "Write" });
    expect(askedBefore(view([live]), live)).toBe(false);
  });
});

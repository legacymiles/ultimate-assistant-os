import { describe, expect, it } from "vitest";

import { countActions, emptyThread, isEscalationNotice, reduceEvents } from "./model";
import type { HarnessEvent } from "./types";

let seq = 0;
const ev = (kind: string, rest: Record<string, unknown> = {}): HarnessEvent => ({
  seq: ++seq,
  at: 1_000 + seq,
  kind,
  ...rest,
});

const fold = (...events: HarnessEvent[]) => reduceEvents(emptyThread(), events);

describe("reduceEvents", () => {
  it("returns the same object when there is nothing to apply", () => {
    const before = emptyThread();
    expect(reduceEvents(before, [])).toBe(before);
  });

  it("keeps notes that arrive before the first turn out of the turns", () => {
    const view = fold(ev("note", { text: "Working in a worktree." }));
    expect(view.notes).toEqual(["Working in a worktree."]);
    expect(view.turns).toHaveLength(0);
  });

  it("concatenates streamed text into one answer", () => {
    const view = fold(
      ev("user", { text: "hello" }),
      ev("text", { text: "It " }),
      ev("text", { text: "works" }),
      ev("text", { text: "." }),
      ev("turn_end", { ms: 1200, usd: 0.02 }),
    );
    expect(view.turns).toHaveLength(1);
    expect(view.turns[0].prompt).toBe("hello");
    expect(view.turns[0].text).toBe("It works.");
    expect(view.turns[0].status).toBe("done");
    expect(view.usd).toBeCloseTo(0.02);
  });

  it("pairs a tool with its result by call id", () => {
    const view = fold(
      ev("user", { text: "go" }),
      ev("tool", { callId: "c1", name: "Read", title: "Read a.ts", kindOf: "read" }),
      ev("tool", { callId: "c2", name: "Write", title: "Write b.ts", kindOf: "write" }),
      ev("tool_end", { callId: "c2", ok: true, output: "written" }),
      ev("tool_end", { callId: "c1", ok: true, output: "contents" }),
    );
    const tools = view.turns[0].tools;
    expect(tools.map((t) => t.callId)).toEqual(["c1", "c2"]);
    expect(tools[0].status).toBe("ok");
    expect(tools[0].output).toBe("contents");
    expect(tools[1].status).toBe("ok");
  });

  it("marks a genuinely failed tool as failed", () => {
    const view = fold(
      ev("user", { text: "go" }),
      ev("tool", { callId: "c1", name: "Bash", title: "npm test", kindOf: "run" }),
      ev("tool_end", { callId: "c1", ok: false, output: "1 test failed" }),
    );
    expect(view.turns[0].tools[0].status).toBe("failed");
  });

  // --- the gate ----------------------------------------------------------

  it("parks a live gate and clears it when answered", () => {
    let view = fold(
      ev("user", { text: "write it" }),
      ev("tool", { callId: "c1", name: "Write", title: "Write x.md", kindOf: "write" }),
      ev("gate", { gateId: "g1", name: "Write", title: "Write x.md", risk: "act", patch: "+hi" }),
    );
    expect(view.liveGate?.gateId).toBe("g1");
    expect(view.turns[0].status).toBe("waiting");

    view = reduceEvents(view, [ev("gate_done", { gateId: "g1", allow: true, how: "owner" })]);
    expect(view.liveGate).toBeNull();
    expect(view.turns[0].status).toBe("running");
    expect(view.turns[0].gates[0]).toMatchObject({ answered: true, allowed: true, how: "owner" });
  });

  it("turns the running step into a refusal when the gate is refused", () => {
    let view = fold(
      ev("user", { text: "delete it" }),
      ev("tool", { callId: "c1", name: "Bash", title: "rm -rf build", kindOf: "run" }),
      ev("gate", { gateId: "g1", name: "Bash", title: "rm -rf build", risk: "grave" }),
    );
    view = reduceEvents(view, [ev("gate_done", { gateId: "g1", allow: false, how: "owner" })]);
    expect(view.turns[0].tools[0].status).toBe("refused");
    expect(view.turns[0].gates[0].allowed).toBe(false);
  });

  it("records a gate that timed out as refused, with how it ended", () => {
    let view = fold(
      ev("user", { text: "x" }),
      ev("gate", { gateId: "g1", name: "Write", title: "Write x", risk: "act" }),
    );
    view = reduceEvents(view, [ev("gate_done", { gateId: "g1", allow: false, how: "timeout" })]);
    expect(view.turns[0].gates[0].how).toBe("timeout");
    expect(view.liveGate).toBeNull();
  });

  // --- dsh's escalation dance --------------------------------------------

  it("recognises dsh's sandbox denial as a question, not a failure", () => {
    expect(isEscalationNotice("Error: [sandbox: file access denied under read-only mode]")).toBe(true);
    expect(isEscalationNotice("[sandbox: escalation available — retry this exact call]")).toBe(true);
    expect(isEscalationNotice("1 test failed")).toBe(false);
  });

  it("folds dsh's denied-then-retried write into one step", () => {
    const view = fold(
      ev("user", { text: "write it" }),
      ev("tool", { callId: "a1", name: "Write", title: "Write HARNESS.md", kindOf: "write" }),
      ev("tool_end", {
        callId: "a1",
        ok: false,
        output: "Error: [sandbox: file access denied under read-only mode] [sandbox: escalation available]",
      }),
      // The identical call again, with sandbox_permissions set.
      ev("tool", { callId: "a2", name: "Write", title: "Write HARNESS.md", kindOf: "write" }),
      ev("gate", { gateId: "g1", name: "Write", title: "Write HARNESS.md", risk: "act" }),
      ev("gate_done", { gateId: "g1", allow: true, how: "owner" }),
      ev("tool_end", { callId: "a2", ok: true, output: "updated successfully" }),
    );
    // One row, not a red failure above a green success.
    expect(view.turns[0].tools).toHaveLength(1);
    expect(view.turns[0].tools[0].status).toBe("ok");
    expect(view.turns[0].tools[0].callId).toBe("a2");
  });

  // --- the rest ----------------------------------------------------------

  it("tracks dsh's context usage and the last status detail", () => {
    const view = fold(
      ev("status", { status: "ready", detail: "DeepSeek-V4-Flash · read-only sandbox" }),
      ev("user", { text: "x" }),
      ev("usage", { used: 8_052, size: 1_000_000 }),
    );
    expect(view.used).toBe(8_052);
    expect(view.size).toBe(1_000_000);
    expect(view.detail).toContain("DeepSeek-V4-Flash");
  });

  it("fails an unfinished turn when the thread ends under it", () => {
    const view = fold(
      ev("user", { text: "x" }),
      ev("tool", { callId: "c1", name: "Bash", title: "sleep", kindOf: "run" }),
      ev("status", { status: "ended" }),
    );
    expect(view.turns[0].status).toBe("failed");
  });

  it("keeps an error that arrives with no turn open out of the turns", () => {
    const view = fold(ev("error", { message: "dsh has no DeepSeek API key on this PC." }));
    expect(view.notes).toEqual(["dsh has no DeepSeek API key on this PC."]);
  });

  it("starts a turn for text that arrives without a prompt", () => {
    const view = fold(ev("text", { text: "resumed" }));
    expect(view.turns).toHaveLength(1);
    expect(view.turns[0].prompt).toBe("");
    expect(view.turns[0].text).toBe("resumed");
  });

  it("ignores event kinds it does not know", () => {
    const view = fold(ev("user", { text: "x" }), ev("something_new", { a: 1 }));
    expect(view.turns).toHaveLength(1);
  });

  it("records a plan when one is sent", () => {
    const view = fold(
      ev("user", { text: "x" }),
      ev("plan", { entries: [{ text: "Read the file", status: "completed" }, { text: "Edit it", status: "pending" }] }),
    );
    expect(view.turns[0].plan).toEqual([
      { text: "Read the file", status: "completed" },
      { text: "Edit it", status: "pending" },
    ]);
  });
});

describe("countActions", () => {
  it("counts reads apart from changes, and refusals apart from both", () => {
    const view = fold(
      ev("user", { text: "x" }),
      ev("tool", { callId: "r1", name: "Read", title: "Read a", kindOf: "read" }),
      ev("tool_end", { callId: "r1", ok: true, output: "" }),
      ev("tool", { callId: "r2", name: "Grep", title: "Grep b", kindOf: "read" }),
      ev("tool_end", { callId: "r2", ok: true, output: "" }),
      ev("tool", { callId: "w1", name: "Write", title: "Write c", kindOf: "write" }),
      ev("tool_end", { callId: "w1", ok: true, output: "" }),
      ev("tool", { callId: "w2", name: "Bash", title: "rm d", kindOf: "run" }),
      ev("gate", { gateId: "g1", name: "Bash", title: "rm d", risk: "grave" }),
      ev("gate_done", { gateId: "g1", allow: false, how: "owner" }),
    );
    expect(countActions(view)).toEqual({ reads: 2, changes: 1, refused: 1 });
  });
});

import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./events";
import { PRIORITY, priorityOf } from "./priority";

const ev = (over: Partial<AgentEvent>): AgentEvent => ({
  id: "x",
  kind: "comment",
  handle: "a",
  user: "A",
  text: "hello",
  ts: 0,
  ...over,
});

describe("priorityOf", () => {
  it("ranks a gift above a follow above chatter", () => {
    expect(priorityOf(ev({ kind: "gift" }), "Alex")).toBe(PRIORITY.gift);
    expect(priorityOf(ev({ kind: "follow" }), "Alex")).toBe(PRIORITY.follow);
    expect(priorityOf(ev({ text: "nice stream" }), "Alex")).toBe(PRIORITY.chatter);
    expect(PRIORITY.gift).toBeGreaterThan(PRIORITY.follow);
    expect(PRIORITY.follow).toBeGreaterThan(PRIORITY.chatter);
  });

  it("treats a named mention as a mention, case-insensitively", () => {
    expect(priorityOf(ev({ text: "alex where are you from" }), "Alex")).toBe(PRIORITY.mention);
    expect(priorityOf(ev({ text: "@Alex hey" }), "Alex")).toBe(PRIORITY.mention);
  });

  it("does not match the name inside a longer word", () => {
    expect(priorityOf(ev({ text: "alexandria is far" }), "Alex")).toBe(PRIORITY.chatter);
  });

  it("treats a question mark as a question", () => {
    expect(priorityOf(ev({ text: "where are you from?" }), "Alex")).toBe(PRIORITY.question);
  });

  it("prefers mention over question when a comment is both", () => {
    expect(priorityOf(ev({ text: "Alex how old are you?" }), "Alex")).toBe(PRIORITY.mention);
  });

  it("ranks a share above chatter and below a follow", () => {
    const p = priorityOf(ev({ kind: "share" }), "Alex");
    expect(p).toBeGreaterThan(PRIORITY.chatter);
    expect(p).toBeLessThan(PRIORITY.follow);
  });

  it("keeps the operator above everything", () => {
    expect(PRIORITY.operator).toBeGreaterThan(PRIORITY.gift);
  });
});

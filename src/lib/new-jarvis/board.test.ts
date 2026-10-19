import { describe, expect, it } from "vitest";
import { ticketForError, ticketForIdea, ticketForQueueRow } from "./board";
import type { Idea } from "./ideas";
import type { QueueRow } from "./queue";
import type { ErrorEntry } from "../site-errors/log";

const criteria = (body: string) => body.split("\n").filter((l) => l.startsWith("- [ ] "));
const SECTIONS = ["## Problem", "## Context", "## Fix", "## Acceptance Criteria", "## Risk", "## Blocked by"];

describe("board cards", () => {
  it("an idea becomes a Felix card with its evidence", () => {
    const idea: Idea = {
      id: "i1", kind: "jarvis", title: "Add a one-tap photo resend", why: "You resent photos by hand three times this week.",
      firstStep: "Add a resend button to Camera Autopilot", effort: "hours", evidence: ["Oct 15: asked why a photo didn't send"],
      prompt: "Help me add a resend button", origin: "chat", at: "2026-10-18T00:00:00Z",
    };
    const t = ticketForIdea(idea);
    expect(t.title.length).toBeLessThanOrEqual(70);
    for (const s of SECTIONS) expect(t.body).toContain(s);
    expect(t.body).toContain("Oct 15: asked why a photo didn't send");
    expect(criteria(t.body).length).toBeGreaterThanOrEqual(2);
  });

  it("an unfinished queue row lists what's missing", () => {
    const row = {
      id: "app:x", kind: "app", name: "Dance Vault", blurb: "dances", group: "Fun", signals: {},
      state: "wip", derived: "wip", byHand: false, why: "no tests", note: "needs upload",
      evidence: [{ label: "has tests", met: false }, { label: "has a page", met: true }],
    } as unknown as QueueRow;
    const t = ticketForQueueRow(row);
    expect(t.labels).toEqual(["tech-debt", "felix"]);
    expect(t.body).toContain("close: has tests");
    expect(t.body).not.toContain("close: has a page");
  });

  it("a crash becomes a bug card with the evidence table", () => {
    const e: ErrorEntry = {
      id: "hub-1", site: "hub", kind: "error", message: "Cannot read properties of undefined", stack: "TypeError\n at x",
      urls: ["/apps/jarvis"], agents: ["iPhone Safari"], count: 7, firstSeen: "2026-10-17T00:00:00Z", lastSeen: "2026-10-18T00:00:00Z",
    };
    const t = ticketForError(e);
    expect(t.title).toMatch(/^🐛 \[bug\] hub:/);
    expect(t.body).toContain("## Evidence");
    expect(t.body).toContain("| Count | 7 |");
    expect(criteria(t.body)[0]).toMatch(/reproduced first/);
  });
});

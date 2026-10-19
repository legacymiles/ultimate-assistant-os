import { describe, expect, it } from "vitest";
import { CHECKLIST, QUESTIONS, checklistFor, draftBrief, ticketFrom, topicOf } from "./felix";

describe("topicOf", () => {
  it.each([
    ["build me a booking app for my barber client", "app"],
    ["make a landing page website for my cousin's food truck", "website"],
    ["add a widget to the jarvis dashboard that shows my crypto", "plugin"],
    ["the iphone shortcut keeps failing and photos upload twice", "fix"],
    ["write an instagram post about our grand opening", "content"],
  ])("%s → %s", (text, topic) => {
    expect(topicOf(text)).toBe(topic);
  });

  it("leaves short and casual messages alone", () => {
    expect(topicOf("hi jarvis")).toBeNull();
    expect(topicOf("what's the weather like in Columbus today")).toBeNull();
    expect(topicOf("remind me to call mom at 5")).toBeNull();
  });
});

describe("questions", () => {
  it("every topic asks the end goal first", () => {
    for (const set of Object.values(QUESTIONS)) expect(set[0].id).toBe("goal");
  });
});

describe("checklist", () => {
  it("cites only codes that exist in the one checklist", async () => {
    const { STARTER_LINES } = await import("../jarvis-profile/checklist");
    const codes = new Set(STARTER_LINES.map((l) => l.code));
    expect(CHECKLIST.length).toBe(STARTER_LINES.length);
    const answers = { touches: ["Accounts / sign-in", "Payments", "Personal data", "Other apps", "AI", "Works offline"], audience: "The public" };
    for (const t of ["app", "website", "plugin", "fix"] as const) for (const c of checklistFor(t, answers)) expect(codes.has(c.id)).toBe(true);
  });

  it("pulls in the right lines from the answers", () => {
    const ids = (t: Parameters<typeof checklistFor>[0], a = {}) => checklistFor(t, a).map((c) => c.id);
    expect(ids("app")).toEqual(expect.arrayContaining(["R1", "R2", "U1", "O1"]));
    expect(ids("app", { touches: ["Payments", "Personal data"] })).toEqual(expect.arrayContaining(["S5", "S7", "S2", "D4"]));
    expect(ids("app", { touches: ["Accounts / sign-in"] })).toContain("L1");
    expect(ids("website")).toEqual(expect.arrayContaining(["P1", "C1", "C4"]));
    expect(ids("content")).toEqual([]);
  });
});

describe("draftBrief", () => {
  it("keeps the request, leads with the goal and ends with checkable criteria", () => {
    const b = draftBrief("build me a booking app for my barber client", "app", {
      goal: "the chairs stay full without him answering the phone",
      audience: "My clients",
      success: ["People finish the main task without help", "Never crashes, fast on phones"],
      features: "online booking, SMS reminders",
      touches: ["Accounts / sign-in"],
    });
    expect(b.prompt.indexOf("<goal>")).toBe(0);
    expect(b.prompt).toContain("build me a booking app for my barber client");
    expect(b.prompt).toContain("online booking, SMS reminders");
    expect(b.prompt).toContain("<success_criteria>");
    expect(b.acceptance.length).toBeGreaterThanOrEqual(2);
    expect(b.acceptance.length).toBeLessThanOrEqual(5);
    expect(b.assumptions).toHaveLength(0);
    expect(b.title.length).toBeLessThanOrEqual(70);
  });

  it("works with no answers, and says what it assumed", () => {
    const b = draftBrief("make a dashboard for my trading bots", "app", {});
    expect(b.goal).toBe("make a dashboard for my trading bots");
    expect(b.assumptions.length).toBeGreaterThan(0);
    expect(b.acceptance.length).toBeGreaterThanOrEqual(2);
  });

  it("a fix reproduces before it changes anything", () => {
    const b = draftBrief("photos upload twice", "fix", { goal: "photos upload twice" });
    expect(b.acceptance[0]).toMatch(/reproduced first/);
    expect(b.title).toMatch(/^🐛 \[bug\]/);
  });
});

describe("ticketFrom", () => {
  it("writes a super-board card with 2–5 criteria and routes payments to a human", () => {
    const b = draftBrief("build a store for my client", "app", { touches: ["Payments"], success: ["Makes money"] });
    const t = ticketFrom(b, "build a store for my client");
    expect(t.labels).toEqual(expect.arrayContaining(["feature", "felix", "money"]));
    for (const h of ["## Problem", "## Context", "## Fix", "## Acceptance Criteria", "## Risk", "## Blocked by"]) expect(t.body).toContain(h);
    const criteria = t.body.split("\n").filter((l) => l.startsWith("- [ ] "));
    expect(criteria.length).toBeGreaterThanOrEqual(2);
    expect(criteria.length).toBeLessThanOrEqual(5);
  });
});

import { describe, expect, it } from "vitest";
import { CHAT_SYSTEM, EXTRA_SYSTEM, PLAN_SCHEMA, PLAN_SYSTEM, VERIFY_SYSTEM, briefBlock } from "./prompts";
import { emptyBrief } from "./types";

describe("the plan prompt", () => {
  it("refuses the business-formation topics by name", () => {
    for (const forbidden of ["LLC", "insurance", "branding", "marketing", "hiring"]) {
      expect(PLAN_SYSTEM).toContain(forbidden);
    }
    expect(PLAN_SYSTEM).toMatch(/do not|never/i);
  });

  it("asks for a legal flag as a question with somebody to ask", () => {
    expect(PLAN_SYSTEM).toMatch(/whoToAsk/);
    expect(PLAN_SYSTEM).toMatch(/never state what is legal|not legal advice/i);
  });

  it("names every field the sheet needs, so a plan is never half a sheet", () => {
    for (const field of ["phases", "steps", "cost", "low", "high", "materials", "suppliers", "check", "hours", "assumptions", "openQuestions"]) {
      expect(PLAN_SCHEMA).toContain(field);
    }
  });
});

describe("the chat prompt", () => {
  it("demands ops against ids, and allows an answer that changes nothing", () => {
    expect(CHAT_SYSTEM).toContain("ops");
    expect(CHAT_SYSTEM).toMatch(/stepId/);
    expect(CHAT_SYSTEM).toMatch(/empty/i);
  });

  it("forbids inventing an id", () => {
    expect(CHAT_SYSTEM).toMatch(/only ids that appear|ids that exist/i);
  });
});

describe("the extra prompt", () => {
  it("answers one topic and refuses to wander into the others", () => {
    expect(EXTRA_SYSTEM).toMatch(/only the topic|only the topic you are given|exactly the topic/i);
  });
});

describe("the verify prompt", () => {
  it("insists on a source for every price", () => {
    expect(VERIFY_SYSTEM).toMatch(/source/i);
    expect(VERIFY_SYSTEM).toMatch(/do not invent|never invent/i);
  });
});

describe("briefBlock", () => {
  it("writes the brief as labelled lines, skipping what was left blank", () => {
    const block = briefBlock(
      { ...emptyBrief(), what: "Picture frames", scale: "a-few", skill: "handy" },
      { city: "Raleigh", region: "NC", country: "US", currency: "USD" },
    );
    expect(block).toContain("Picture frames");
    expect(block).toContain("Raleigh");
    expect(block).toContain("USD");
    expect(block).not.toMatch(/Tools/);
  });

  it("says plainly when there is no home base, so the plan can say so too", () => {
    const block = briefBlock({ ...emptyBrief(), what: "Frames" }, null);
    expect(block).toMatch(/no location|online/i);
  });
});

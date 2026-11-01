import { describe, expect, it } from "vitest";
import { depthAxes, depthBrief, depthFor, depthOf, depthSteps } from "./depth";
import { bestGuesses, intakeQuestions, newProject, understand } from "./engine";
import type { Answers, BuilderProject } from "./types";

function built(idea: string, extra: Answers = {}): BuilderProject {
  const p = newProject(idea, new Date("2026-11-01T10:00:00Z"), "ab_depth");
  p.questions = intakeQuestions(idea);
  p.answers = bestGuesses(p.questions, extra);
  p.understanding = understand(idea, p.answers);
  return p;
}

describe("which depth a build earns", () => {
  it("is commercial when other people use it — the normal case", () => {
    const p = built("an app where neighbours swap tools with each other", { audience: "The public" });
    expect(depthFor(p.idea, p.understanding, p.answers).depth).toBe("commercial");
  });

  it("is commercial when it touches accounts or personal data, even just for me", () => {
    const p = built("a dashboard for my own habits", { audience: "Just me / my team", touches: ["Accounts / sign-in"] });
    expect(depthFor(p.idea, p.understanding, p.answers).depth).toBe("commercial");
  });

  it("is plain for a tool only I use that saves in the browser", () => {
    const p = built("a tool that converts my csv files", { audience: "Just me / my team", touches: ["Works offline"] });
    expect(depthFor(p.idea, p.understanding, p.answers).depth).toBe("plain");
  });

  it("is commercial 2x only when the owner asks for money", () => {
    const p = built("a habit tracker I want to charge a subscription for", { audience: "The public" });
    expect(depthFor(p.idea, p.understanding, p.answers).depth).toBe("commercial-2x");
  });

  it("says why, in words the owner can read", () => {
    const p = built("a marketplace for local bakers", { audience: "The public" });
    const { why } = depthFor(p.idea, p.understanding, p.answers);
    expect(why).toMatch(/[a-z]/);
    expect(why).not.toMatch(/undefined|\[object/);
  });

  it("lets the owner override it, and says so", () => {
    const p = built("a marketplace for local bakers", { audience: "The public" });
    expect(depthOf({ ...p, depth: "plain" })).toEqual({ depth: "plain", why: "you chose this depth" });
  });

  it("keeps the earned reason when the owner picked the same depth anyway", () => {
    const p = built("a marketplace for local bakers", { audience: "The public" });
    expect(depthOf({ ...p, depth: "commercial" }).why).not.toBe("you chose this depth");
  });
});

describe("what a depth runs", () => {
  it("runs nothing commercial on plain", () => {
    expect(depthSteps("plain")).toEqual([]);
    expect(depthAxes("plain")).toEqual([]);
  });

  it("runs the full commercial set on an app", () => {
    expect(depthSteps("commercial", "webapp")).toEqual([0, 2, 3, 4, 5, 6, 8]);
  });

  it("skips the foundation on a site people only visit", () => {
    expect(depthSteps("commercial", "website")).toEqual([2, 4, 6]);
    expect(depthAxes("commercial", "website")).not.toContain("Foundation");
    expect(depthAxes("commercial", "website")).not.toContain("Retention");
  });

  it("only scores Money at 2x", () => {
    expect(depthAxes("commercial", "webapp")).not.toContain("Money");
    expect(depthAxes("commercial-2x", "webapp")).toContain("Money");
  });

  it("forbids charging at plain commercial, in the brief itself", () => {
    const brief = depthBrief("commercial", "webapp");
    expect(brief).toContain("COMPLETELY FREE");
    expect(brief).toContain("switched OFF");
    expect(brief).toContain("commercial 2x");
  });

  it("switches the money on at 2x", () => {
    const brief = depthBrief("commercial-2x", "webapp");
    expect(brief).toMatch(/paywalls/);
    expect(brief).toMatch(/9\/10/);
  });

  it("names the commercial steps it is asking for", () => {
    expect(depthBrief("commercial", "webapp")).toContain("Steps 0, 2, 3, 4, 5, 6, 8");
  });
});

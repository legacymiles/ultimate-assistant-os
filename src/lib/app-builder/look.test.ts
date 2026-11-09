import { describe, expect, it } from "vitest";

import { lookOf, masterPrompt, pipeline, queueText, QUEUE_LIMIT } from "./engine";
import type { BuilderProject, Feature, Understanding } from "./types";

const T = "2026-11-09T12:00:00.000Z";

function feature(title: string, over: Partial<Feature> = {}): Feature {
  return {
    id: `f_${title.slice(0, 8)}`,
    title,
    why: "It is why the app exists",
    detail: "Does the thing, end to end",
    kind: "core",
    impact: 3,
    effort: "M",
    status: "accepted",
    source: "agent",
    ...over,
  };
}

const UNDERSTANDING: Understanding = {
  name: "Receipt Keeper",
  oneLiner: "Every receipt, filed the moment you photograph it",
  appType: "webapp",
  purpose: "Stop losing expenses at tax time",
  audience: "Freelancers who hate paperwork",
  endGoal: "Never think about a receipt again",
  beyond: "Taxes stop being a weekend",
  model: "Free",
  designSkill: "minimalist-skill",
  designWhy: "Calm beats clever for paperwork",
  judge: ["A receipt is filed in under 5 seconds"],
};

function project(over: Partial<BuilderProject> = {}): BuilderProject {
  return {
    id: "p_1",
    createdAt: T,
    updatedAt: T,
    idea: "An app that keeps my receipts in order",
    stage: "features",
    questions: [],
    answers: {},
    understanding: UNDERSTANDING,
    features: [feature("Photograph a receipt"), feature("Find any receipt by shop", { kind: "experience", impact: 2 })],
    chat: [],
    ...over,
  };
}

describe("the picked look overriding the agent's guess", () => {
  it("leaves the understanding alone when nothing was picked", () => {
    expect(lookOf(project(), UNDERSTANDING)).toBe(UNDERSTANDING);
  });

  it("leaves it alone when the pick agrees with the guess", () => {
    const p = project({ look: { skill: "minimalist-skill", at: T, by: "owner" } });
    expect(lookOf(p, UNDERSTANDING)).toBe(UNDERSTANDING);
  });

  it("replaces the design skill, and says who chose it", () => {
    const p = project({ look: { skill: "brutalist-skill", at: T, by: "owner" } });
    const u = lookOf(p, UNDERSTANDING);
    expect(u.designSkill).toBe("brutalist-skill");
    expect(u.designWhy).toContain("owner picked this direction from the mockups");
    expect(u.designWhy).toContain("minimalist-skill");
    expect(lookOf(project({ look: { skill: "brutalist-skill", at: T, by: "client" } }), UNDERSTANDING).designWhy).toContain(
      "client picked",
    );
  });
});

describe("the look reaching the build", () => {
  const picked = project({ look: { skill: "brutalist-skill", at: T, by: "owner" } });

  it("puts the chosen skill in the skills pipeline, not the guessed one", () => {
    const skills = pipeline(lookOf(picked, UNDERSTANDING)).map((s) => s.skill);
    expect(skills).toContain("brutalist-skill");
    expect(skills).not.toContain("minimalist-skill");
    // impeccable still closes the look pass, whichever base ran.
    expect(skills.indexOf("impeccable")).toBeGreaterThan(skills.indexOf("brutalist-skill"));
  });

  it("tells the build it is a decision rather than a suggestion", () => {
    const brief = masterPrompt(picked);
    expect(brief).toContain("<look>");
    expect(brief).toContain("brutalist-skill");
    expect(brief).toContain("This is a DECISION, not a suggestion");
    expect(brief).toContain("Do not substitute another design skill");
  });

  it("describes the surface the mockup showed, so the structure carries too", () => {
    expect(masterPrompt(picked)).toContain("a list of rows");
    const board = project({
      look: { skill: "brutalist-skill", at: T, by: "owner" },
      features: [feature("Move a receipt through three stages")],
    });
    expect(masterPrompt(board)).toContain("a board with columns");
  });

  it("writes no look block at all when nothing was picked", () => {
    expect(masterPrompt(project())).not.toContain("<look>");
    expect(queueText(project())).not.toContain("Look:");
  });

  it("carries it into the short queue brief as well", () => {
    const q = queueText(picked);
    expect(q).toContain("Look: brutalist-skill");
    expect(q).toContain("picked by the owner from three drawn mockups");
    expect(q).toContain("→ brutalist-skill → impeccable");
    expect(q.length).toBeLessThanOrEqual(QUEUE_LIMIT);
  });

  it("says the client approved it, when they did", () => {
    const byClient = project({ look: { skill: "brutalist-skill", at: T, by: "client" } });
    expect(queueText(byClient)).toContain("approved by the client");
    expect(masterPrompt(byClient)).toContain("the client approved");
  });

  it("keeps the queue brief under the limit with a long feature list and a look", () => {
    const many = project({
      look: { skill: "brutalist-skill", at: T, by: "owner" },
      features: Array.from({ length: 14 }, (_, i) =>
        feature(`Feature number ${i + 1} with a reasonably long title`, {
          detail: "A long-winded description ".repeat(6),
        }),
      ),
    });
    expect(queueText(many).length).toBeLessThanOrEqual(QUEUE_LIMIT);
  });
});

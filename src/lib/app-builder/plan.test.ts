import { describe, expect, it } from "vitest";
import { bestGuesses, intakeQuestions, newProject, offlineFeatures, understand } from "./engine";
import { buildSteps, etaFor, landsIn, relTime, slugOf, yourMove, type BuildState } from "./plan";
import type { BuilderProject } from "./types";

const IDEA = "an app called WalkBook where dog owners book a trusted walker";

function project(): BuilderProject {
  const p = newProject(IDEA, new Date("2026-11-01T10:00:00Z"), "ab_plan");
  p.questions = intakeQuestions(IDEA);
  p.answers = bestGuesses(p.questions, { audience: "The public" });
  p.understanding = understand(IDEA, p.answers);
  p.features = offlineFeatures(IDEA, p.answers, p.understanding).map((f) => ({ ...f, status: "accepted" as const }));
  p.handoff = { at: "2026-11-01T10:05:00Z", queueId: "q-7k2m9x" };
  return p;
}

describe("how long it says it takes", () => {
  it("gives a range, not a number", () => {
    const eta = etaFor(6, "commercial");
    expect(eta.high).toBeGreaterThan(eta.low);
    expect(eta.label).toContain("–");
  });

  it("asks for more time at greater depth", () => {
    expect(etaFor(6, "commercial-2x").high).toBeGreaterThan(etaFor(6, "commercial").high);
    expect(etaFor(6, "commercial").high).toBeGreaterThan(etaFor(6, "plain").high);
  });

  it("never claims a build is instant, even with one feature", () => {
    expect(etaFor(1, "plain").low).toBeGreaterThanOrEqual(10);
  });
});

describe("relative times", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  it("says just now inside a minute", () => {
    expect(relTime("2026-11-01T11:59:40Z", now)).toBe("just now");
  });
  it("counts minutes and hours in plain words", () => {
    expect(relTime("2026-11-01T11:55:00Z", now)).toBe("5 minutes ago");
    expect(relTime("2026-11-01T09:00:00Z", now)).toBe("3 hours ago");
  });
  it("says nothing rather than NaN for a missing or broken time", () => {
    expect(relTime(undefined, now)).toBe("");
    expect(relTime("not a date", now)).toBe("");
  });
});

describe("where it lands", () => {
  it("slugs the app's name for the folder", () => {
    expect(slugOf("WalkBook — for dog people!")).toBe("walkbook-for-dog-people");
  });
  it("never produces an empty folder name", () => {
    expect(slugOf("!!!")).toBe("new-app");
  });
  it("names the folder and the repo for a new app", () => {
    const l = landsIn(project());
    expect(l.where).toContain("walkbook");
    expect(l.detail).toContain("GitHub");
  });
  it("names the branch and the pull request for a client edit", () => {
    const p = project();
    p.edit = {
      reviewId: "crp_1",
      batchId: "b1",
      siteName: "Baker St",
      clientName: "Sam",
      fromVersion: "v1",
      fromUrl: "https://example.com",
      version: "v2",
      versionId: "ver_2",
      baseBranch: "main",
      branch: "jarvis/baker-v2",
      brief: "",
      items: [],
    };
    const l = landsIn(p);
    expect(l.where).toContain("jarvis/baker-v2");
    expect(l.detail).toContain("merge");
  });
});

describe("the steps after Build it", () => {
  const queued: BuildState = { phase: "queued", queueId: "q-7k2m9x", at: "2026-11-01T10:05:00Z" };

  it("marks the request filed and the pick-up as the owner's move", () => {
    const steps = buildSteps(project(), queued);
    expect(steps[0].state).toBe("done");
    expect(steps[1].state).toBe("now");
    expect(steps[1].yours).toBe(true);
    expect(steps[1].detail).toContain("work my Jarvis queue");
  });

  it("never claims a build is running while it is only queued", () => {
    const steps = buildSteps(project(), queued);
    expect(steps[2].state).toBe("wait");
    expect(steps[2].detail).toMatch(/once it starts/);
  });

  it("tells the owner the one thing to say, while it waits", () => {
    expect(yourMove(queued)?.say).toBe("work my Jarvis queue");
  });

  it("stops asking anything of the owner once it is picked up", () => {
    const working: BuildState = { ...queued, phase: "working", startedBy: "claude-code", startedAt: "2026-11-01T10:30:00Z" };
    const steps = buildSteps(project(), working);
    expect(steps[1].state).toBe("done");
    expect(steps[1].title).toContain("claude-code");
    expect(steps[2].state).toBe("now");
    expect(yourMove(working)).toBeNull();
  });

  it("shows the agent's latest note instead of a guess, once there is one", () => {
    const working: BuildState = {
      ...queued,
      phase: "working",
      startedBy: "claude-code",
      notes: [{ at: "2026-11-01T10:40:00Z", text: "Supabase tables are up; building the booking flow", by: "claude-code" }],
    };
    expect(buildSteps(project(), working)[2].detail).toContain("booking flow");
  });

  it("ends on the result line it was given", () => {
    const done: BuildState = { ...queued, phase: "done", doneAt: "2026-11-01T12:00:00Z", doneBy: "claude-code", result: "Live at walkbook.vercel.app" };
    const steps = buildSteps(project(), done);
    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(steps[2].detail).toContain("walkbook.vercel.app");
  });

  it("only mentions Client Review when a link was opened", () => {
    expect(buildSteps(project(), queued).some((s) => s.id === "review")).toBe(false);
    const p = project();
    p.handoff = { ...p.handoff!, review: { id: "crp_1", versionId: "ver_1", token: "tok", number: "v1", at: "2026-11-01T10:05:00Z" } };
    expect(buildSteps(p, queued).some((s) => s.id === "review")).toBe(true);
  });
});

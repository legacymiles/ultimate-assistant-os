import { describe, expect, it } from "vitest";
import { createProject, cleanBriefModel, ReviewError, updateProjectMeta } from "./logic";
import {
  buildModelFor,
  buildModelNote,
  buildsWithPick,
  DEFAULT_BUILD_MODEL,
  isLaneValue,
  laneForModel,
  laneOfValue,
  pickValue,
  SUBSCRIPTION_PREFIX,
} from "./models";

const T = "2026-10-18T12:00:00.000Z";
const fresh = () => createProject({ name: "Glow Spa", siteUrl: "glowspa.vercel.app" }, T);

describe("the brief's model pick", () => {
  it("defaults to the lane and shows the lane in the menu", () => {
    expect(pickValue(fresh())).toBe("");
    expect(pickValue({ ...fresh(), lane: "standard" })).toBe("lane:standard");
    expect(pickValue({ ...fresh(), lane: "uncensored" })).toBe("lane:uncensored");
  });

  it("prefers an explicit pick over the lane", () => {
    const p = { ...fresh(), lane: "uncensored" as const, briefModel: "deepseek/deepseek-v4.1-flash-1017" };
    expect(pickValue(p)).toBe("deepseek/deepseek-v4.1-flash-1017");
    expect(isLaneValue(pickValue(p))).toBe(false);
  });

  it("round-trips a pick through the store, and clears back to the lane", () => {
    let p = updateProjectMeta(fresh(), { briefModel: "anthropic/claude-opus-5.5" }, T);
    expect(p.briefModel).toBe("anthropic/claude-opus-5.5");
    p = updateProjectMeta(p, { briefModel: "" }, T);
    expect(p.briefModel).toBeUndefined();
    expect(pickValue(p)).toBe("");
  });

  it("accepts a Claude-plan pick and refuses nonsense", () => {
    expect(cleanBriefModel(`${SUBSCRIPTION_PREFIX}claude-opus-5-5`)).toBe(`${SUBSCRIPTION_PREFIX}claude-opus-5-5`);
    expect(cleanBriefModel("deepseek/deepseek-v4.1-flash-1017")).toBe("deepseek/deepseek-v4.1-flash-1017");
    expect(() => cleanBriefModel("not a model id")).toThrow(ReviewError);
    expect(() => cleanBriefModel(`${SUBSCRIPTION_PREFIX}has a space`)).toThrow(ReviewError);
    expect(cleanBriefModel(undefined)).toBeUndefined();
  });

  it("maps the menu's lane values back to lanes", () => {
    expect(laneOfValue("")).toBe("auto");
    expect(laneOfValue("lane:standard")).toBe("standard");
    expect(laneOfValue("lane:uncensored")).toBe("uncensored");
    expect(laneOfValue("deepseek/deepseek-v4.1-flash")).toBe("auto");
  });

  it("colours the badge by what actually answered", () => {
    expect(laneForModel("anthropic/claude-sonnet-5.5")).toBe("standard");
    expect(laneForModel("deepseek/deepseek-v4-pro-0813")).toBe("uncensored");
    expect(laneForModel("x-ai/grok-4.6")).toBe("uncensored");
  });
});

describe("which model actually runs the build", () => {
  it("runs the owner's plan pick, as Claude Code names it", () => {
    expect(buildModelFor(SUBSCRIPTION_PREFIX + "claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(buildModelFor(SUBSCRIPTION_PREFIX + "claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(buildsWithPick(SUBSCRIPTION_PREFIX + "claude-opus-5-5")).toBe(true);
  });

  it("maps an OpenRouter Claude id to the same model, not to the default", () => {
    expect(buildModelFor("anthropic/claude-opus-5.5")).toBe("claude-opus-5-5");
    expect(buildModelFor("anthropic/claude-sonnet-5.5")).toBe("claude-sonnet-5-5");
    expect(buildsWithPick("anthropic/claude-opus-5")).toBe(true);
  });

  it("falls back for a lane or a model a build cannot run, and never returns empty", () => {
    for (const pick of ["", "lane:standard", "lane:uncensored", "x-ai/grok-4.6", "orca/orcacyber-flash-1.0", "openai/gpt-6-luna-pro"]) {
      expect(buildModelFor(pick)).toBe(DEFAULT_BUILD_MODEL);
      expect(buildsWithPick(pick)).toBe(false);
    }
  });

  it("says which model the build will use, in every case", () => {
    expect(buildModelNote(SUBSCRIPTION_PREFIX + "claude-opus-5-5")).toContain("claude-opus-5-5");
    // A pick a build cannot run must not be silently dropped: the note has to
    // name both the build's model and the one that wrote the brief.
    const note = buildModelNote("x-ai/grok-4.6");
    expect(note).toContain(DEFAULT_BUILD_MODEL);
    expect(note).toContain("Grok 4.6");
  });
});

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PICK,
  HARNESS_MODELS,
  cleanPick,
  groupedPicks,
  pickShort,
  routeOf,
  routeStates,
} from "./models";

describe("the Powered by list", () => {
  it("offers Opus 5 and Opus 5.5 on BOTH the subscription and the API", () => {
    const values = HARNESS_MODELS.map((m) => m.value);
    for (const v of [
      "claude-subscription:claude-opus-5-5",
      "claude-subscription:claude-opus-5",
      "openrouter:anthropic/claude-opus-5.5",
      "openrouter:anthropic/claude-opus-5",
    ]) {
      expect(values).toContain(v);
    }
  });

  it("groups by who pays, subscription first", () => {
    expect(groupedPicks().map((g) => g.route)).toEqual(["subscription", "openrouter", "deepseek"]);
  });

  it("defaults to Opus 5.5 on the plan", () => {
    expect(DEFAULT_PICK).toBe("claude-subscription:claude-opus-5-5");
  });

  it("tells plan and API apart in the short label", () => {
    expect(pickShort("claude-subscription:claude-opus-5")).toBe("Opus 5 · plan");
    expect(pickShort("openrouter:anthropic/claude-opus-5.5")).toBe("Opus 5.5 · API");
    expect(pickShort("openrouter:anthropic/claude-haiku-5.5")).toBe("claude-haiku-5.5 · API");
  });

  it("only keeps values the bridge can parse", () => {
    expect(cleanPick("openrouter:anthropic/claude-opus-5.5")).toBe("openrouter:anthropic/claude-opus-5.5");
    expect(cleanPick("openrouter:no-slash")).toBe("");
    expect(cleanPick("claude-subscription:a/b")).toBe("");
    expect(cleanPick("rm -rf")).toBe("");
    expect(cleanPick(42)).toBe("");
  });

  it("knows each value's route", () => {
    expect(routeOf("deepseek")).toBe("deepseek");
    expect(routeOf("openrouter:anthropic/claude-opus-5")).toBe("openrouter");
    expect(routeOf("claude-subscription:claude-opus-5")).toBe("subscription");
  });
});

describe("routeStates", () => {
  it("is all-unknown with the PC off, so nothing is greyed", () => {
    expect(routeStates(null)).toEqual({ subscription: null, openrouter: null, deepseek: null });
  });

  it("reads the bridge's per-route answer", () => {
    const s = routeStates([
      {
        id: "claude",
        label: "Claude Code",
        blurb: "",
        available: true,
        why: "",
        routes: { subscription: { available: true, why: "" }, openrouter: { available: false, why: "No key" } },
      },
      { id: "deepseek", label: "DeepSeek", blurb: "", available: false, why: "not installed" },
    ]);
    expect(s.subscription?.available).toBe(true);
    expect(s.openrouter).toEqual({ available: false, why: "No key" });
    expect(s.deepseek?.why).toBe("not installed");
  });
});

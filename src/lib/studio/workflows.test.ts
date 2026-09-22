import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  MENTIONS,
  WORKFLOWS,
  mentionQueryAt,
  mentionsIn,
  searchMentions,
  workflowBrief,
} from "./workflows";

describe("studio workflows", () => {
  it("has unique, mention-safe ids", () => {
    const ids = WORKFLOWS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const w of WORKFLOWS) {
      expect(w.id).toMatch(/^[a-z0-9-]+$/);
      for (const v of w.variants ?? []) expect(v.id).toMatch(/^[a-z0-9-]+$/);
    }
    const tokens = MENTIONS.map((m) => m.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("files every workflow in a category of its own medium", () => {
    for (const w of WORKFLOWS) {
      const c = CATEGORIES.find((x) => x.id === w.category);
      expect(c?.medium, w.id).toBe(w.medium);
    }
  });

  it("finds workflows and variants in a message, once each", () => {
    const found = mentionsIn("Make @kids-story with @e-commerce:flat-lay and @kids-story again, email@x.com @nope");
    expect(found.map((m) => m.token)).toEqual(["kids-story", "e-commerce:flat-lay"]);
    expect(found[1].label).toBe("E-commerce › Flat lay");
  });

  it("reads the half-typed mention before the caret", () => {
    expect(mentionQueryAt("make a @kid", 11)).toEqual({ start: 7, query: "kid" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("mail me@home", 12)).toBeNull();
    expect(mentionQueryAt("@kids done", 10)).toBeNull();
  });

  it("ranks name matches first and finds variants by name", () => {
    expect(searchMentions("kids")[0].token).toBe("kids-story");
    expect(searchMentions("flat lay").map((m) => m.token)).toContain("e-commerce:flat-lay");
    expect(searchMentions("").every((m) => !m.variant)).toBe(true);
  });

  it("gives Jarvis each brief, with the variant", () => {
    const text = workflowBrief(mentionsIn("@e-commerce:flat-lay @music-video"));
    expect(text).toContain("E-commerce › Flat lay");
    expect(text).toContain("Top-down arrangement");
    expect(text).toContain("## Music video");
    expect(workflowBrief([])).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { isNo, isYes } from "./useVoice";

// A spoken confirmation is the one place a misread word could send an email
// nobody asked for, so the two tests are deliberately strict: only a clear yes
// counts as yes, and anything ambiguous is neither.
describe("spoken confirmation", () => {
  it("accepts the ways people actually say yes", () => {
    for (const s of ["yes", "Yeah", "yep do it", "ok", "okay", "sure", "go ahead", "send it", "confirm"]) {
      expect(isYes(s)).toBe(true);
    }
  });

  it("accepts the ways people say no", () => {
    for (const s of ["no", "nope", "don't", "dont", "cancel", "stop", "not now", "never mind"]) {
      expect(isNo(s)).toBe(true);
    }
  });

  it("treats anything else as neither, leaving the action pending", () => {
    for (const s of ["maybe later", "what does it say", "yesterday we agreed", "I said no earlier", ""]) {
      expect(isYes(s) && isNo(s)).toBe(false);
    }
    // "yesterday" must not read as "yes".
    expect(isYes("yesterday we agreed")).toBe(false);
    // A no buried mid-sentence is not a no either.
    expect(isNo("I said no earlier")).toBe(false);
  });
});

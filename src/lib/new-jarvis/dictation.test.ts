import { describe, expect, it } from "vitest";
import { dictationError, joinDictation } from "./useDictation";

describe("joinDictation", () => {
  it("fills an empty box with what was said", () => {
    expect(joinDictation("", "  make me a  logo ")).toBe("make me a logo");
  });
  it("adds one space after typed words", () => {
    expect(joinDictation("A poster", "for my bakery")).toBe("A poster for my bakery");
    expect(joinDictation("A poster ", "for my bakery")).toBe("A poster for my bakery");
  });
  it("leaves the box alone when nothing was heard", () => {
    expect(joinDictation("keep me", "   ")).toBe("keep me");
  });
});

describe("dictationError", () => {
  it("speaks plain English, never the browser code", () => {
    for (const code of ["not-allowed", "no-speech", "audio-capture", "network", "weird"]) {
      const msg = dictationError(code);
      expect(msg).not.toContain(code === "weird" ? "weird" : code);
      expect(msg.length).toBeGreaterThan(10);
    }
  });
});

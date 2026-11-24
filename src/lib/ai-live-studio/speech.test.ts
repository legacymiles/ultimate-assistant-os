import { describe, expect, it } from "vitest";
import { splitSentences } from "./speech";

describe("splitSentences", () => {
  it("splits on sentence endings and keeps the punctuation", () => {
    expect(splitSentences("I'm from Leeds. Where are you?")).toEqual(["I'm from Leeds.", "Where are you?"]);
  });

  it("returns one piece when there is one sentence", () => {
    expect(splitSentences("just the one")).toEqual(["just the one"]);
  });

  it("returns nothing for empty or blank text", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });

  it("does not split on a decimal point", () => {
    expect(splitSentences("It cost 3.50 in total")).toEqual(["It cost 3.50 in total"]);
  });

  it("keeps a run of terminators with its sentence", () => {
    expect(splitSentences("Really?! That's wild.")).toEqual(["Really?!", "That's wild."]);
  });

  it("merges a fragment shorter than the floor into the one before it", () => {
    expect(splitSentences("Hello there. Hi.")).toEqual(["Hello there. Hi."]);
  });

  it("never returns a blank piece", () => {
    for (const piece of splitSentences("One. Two. Three!  ")) expect(piece.trim()).not.toBe("");
  });
});

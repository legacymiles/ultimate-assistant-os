import { describe, expect, it } from "vitest";
import { coerceIdeas, decide, foldIdeas, offlineIdeas } from "./ideas";

describe("ideas that go with an edit", () => {
  it("keeps at most five, drops blanks and repeats", () => {
    const raw = [
      { title: "Match buttons", detail: "Carry the colour into buttons." },
      { title: "match buttons", detail: "Again." },
      { title: "", detail: "No title" },
      ...Array.from({ length: 8 }, (_, i) => ({ title: `Idea ${i}`, detail: `Does ${i}` })),
    ];
    const out = coerceIdeas(raw);
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({ id: "i1", title: "Match buttons", status: "proposed" });
    expect(coerceIdeas("nope")).toEqual([]);
  });

  it("has something to offer with no AI, from what kind of change it is", () => {
    expect(offlineIdeas("make this app blue").map((i) => i.title)).toContain("Match buttons and links");
    expect(offlineIdeas("move the reviews above the footer")).toEqual([]);
  });

  it("folds only the accepted ones into the request", () => {
    let ideas = offlineIdeas("make it blue");
    ideas = decide(ideas, "i1", "accepted");
    ideas = decide(ideas, "i2", "denied");
    const text = foldIdeas("make it blue", ideas);
    expect(text).toContain("make it blue");
    expect(text).toContain("Match buttons and links");
    expect(text).not.toContain("Keep text readable");
    expect(foldIdeas("make it blue", [])).toBe("make it blue");
  });

  it("pressing the same choice again undoes it", () => {
    const once = decide(offlineIdeas("make it blue"), "i1", "accepted");
    expect(decide(once, "i1", "accepted")[0].status).toBe("proposed");
  });
});

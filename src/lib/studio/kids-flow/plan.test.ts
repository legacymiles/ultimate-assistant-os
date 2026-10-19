import { describe, expect, it } from "vitest";
import {
  beatCount,
  blankDraft,
  briefText,
  checkPlan,
  coercePlan,
  draftBeats,
  placesIn,
  relay,
  runtimeOf,
  wantIn,
} from "./plan";

describe("reading the story line", () => {
  it("finds the places and the thing he wants", () => {
    const story = "His kite blows away and he chases it through town, a forest and up a hill, and catches it at sunset";
    expect(placesIn(story)).toEqual(["town", "a forest", "a hill"]);
    expect(wantIn(story)).toBe("kite");
    expect(wantIn("a boy finds a puppy")).toBe("treasure");
  });
});

describe("draftBeats", () => {
  for (const length of [30, 45, 60] as const) {
    it(`lays out a full arc for ${length} s that passes its own checks`, () => {
      const d = { ...blankDraft(), length };
      d.beats = draftBeats(d);
      expect(d.beats).toHaveLength(beatCount(length));
      expect(d.beats.map((b) => b.role)).toEqual(expect.arrayContaining(["hook", "silence", "payoff", "return"]));
      expect(runtimeOf(d.beats)).toBe(length);
      expect(checkPlan(d)).toEqual([]);
      // every cut on the 120 BPM 8th grid
      for (const b of d.beats) expect((b.start * 4) % 1).toBe(0);
    });
  }
});

describe("checkPlan", () => {
  it("catches long captions, a missing silence and gaps", () => {
    const d = blankDraft();
    d.beats = draftBeats(d).filter((b) => b.role !== "silence");
    d.beats[0] = { ...d.beats[0], caption: "one two three four five six seven" };
    const msgs = checkPlan(d).map((p) => p.message).join("\n");
    expect(msgs).toMatch(/silence/);
    expect(msgs).toMatch(/7 words/);
    expect(msgs).toMatch(/doesn't start where/);
    expect(checkPlan(blankDraft()).map((p) => p.at)).toContain("plan");
  });
});

describe("coercePlan", () => {
  it("clamps a model's answer into a safe, grid-aligned plan at the asked length", () => {
    const plan = coercePlan(
      {
        sheet: { hair: "short black curls", heroColor: "yellow #f6cf55", bogus: 1 },
        beats: [
          { role: "hook", action: "flies a kite", seconds: 5, expression: "smile", caption: "Windy day!" },
          { role: "weird", action: "runs", seconds: 30, expression: "angry", caption: "a b c d e f g h" },
          { action: "" },
        ],
      },
      45,
    )!;
    expect(plan.sheet).toEqual({ hair: "short black curls", heroColor: "yellow #f6cf55" });
    expect(plan.beats).toHaveLength(2);
    expect(plan.beats[1]).toMatchObject({ role: "journey", expression: "smile", caption: "a b c d e f" });
    expect(runtimeOf(plan.beats)).toBe(45);
    expect(coercePlan({ beats: [] }, 45)).toBeNull();
  });
});

describe("briefText", () => {
  it("writes the template the PC skill reads", () => {
    const d = blankDraft();
    d.title = "Milo and the Lost Kite";
    d.sheet = { ...d.sheet, skin: "#8d5a3b", heroColor: "yellow", palette: ["#f6cf55", "#4c6fb5"] };
    d.beats = draftBeats(d);
    const text = briefText(d);
    expect(text.split("\n")[0]).toBe("TITLE: Milo and the Lost Kite");
    expect(text).toContain("SKILL: animate-character-story · MODE: Rebuild · LOOK: cut paper · SHAPE: 16:9 · LENGTH: ~45 s");
    expect(text).toContain("CHARACTER (Subject 1): Milo — skin #8d5a3b. His colour: yellow. Sampled palette: #f6cf55 #4c6fb5.");
    expect(text).toMatch(/SILENCE — /);
    expect(text).toMatch(/LOUDEST HIT — /);
  });
});

describe("relay", () => {
  it("re-times beats end to end after one is stretched", () => {
    const beats = draftBeats(blankDraft());
    beats[2] = { ...beats[2], end: beats[2].end + 2 };
    const out = relay(beats);
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBe(out[i - 1].end);
  });
});

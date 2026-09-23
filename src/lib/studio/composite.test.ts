import { describe, expect, it } from "vitest";
import { CORNERS } from "./composite";
import { jobsFrom } from "./render";

describe("a composite asked for by the model", () => {
  const args = (job: Record<string, unknown>) => jobsFrom({ medium: "video", jobs: [{ prompt: "p", ...job }] }).jobs[0];

  it("reads the clip a plate is laid over, and the placement", () => {
    const j = args({ composite_over: 2, composite: { corner: "bottom-right", share: 0.28, inset: 0.05, audio: "base" } });
    expect(j.compositeOver).toBe(2);
    expect(j.composite).toEqual({ corner: "bottom-right", share: 0.28, inset: 0.05, audio: "base" });
  });

  it("leaves both unset when the job says nothing — an ordinary clip is not a composite", () => {
    const j = args({});
    expect(j.compositeOver).toBeUndefined();
    expect(j.composite).toBeUndefined();
  });

  it("throws out a corner and an audio mode that are not real", () => {
    const j = args({ composite_over: 1, composite: { corner: "middle", audio: "surround", share: 0.3 } });
    expect(j.composite).toEqual({ share: 0.3 });
  });

  it("ignores a Subject number that could not name an attachment", () => {
    expect(args({ composite_over: 0 }).compositeOver).toBeUndefined();
    expect(args({ composite_over: "two" }).compositeOver).toBeUndefined();
  });

  it("offers the four corners a cut-out can stand in", () => {
    expect(CORNERS).toEqual(["bottom-left", "bottom-right", "top-left", "top-right"]);
  });
});

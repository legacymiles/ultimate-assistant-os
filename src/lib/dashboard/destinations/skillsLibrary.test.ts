import { describe, expect, it } from "vitest";
import { skillsLibraryDestination as d } from "./skillsLibrary";

const FULL = {
  title: "Adversarial reviewer",
  overview: "Critiques output against a named quality bar.",
  body: "You are a critic.\nFind the weakest claim.\nName the bar it fails.",
  truncated: false,
};

describe("Skills Library destination", () => {
  it("keeps the transcribed body verbatim, line breaks included", () => {
    expect(d.parse(FULL)?.body).toBe(FULL.body);
  });

  it("drops a proposal with no body — an empty skill is not a skill", () => {
    expect(d.parse({ ...FULL, body: "" })).toBeNull();
  });

  it("drops a proposal with no title", () => {
    expect(d.parse({ ...FULL, title: "" })).toBeNull();
  });

  it("flags a truncated capture", () => {
    const f = d.parse({ ...FULL, truncated: true })!;
    expect(d.preview(f).unverified).toBeTruthy();
    expect(d.preview(d.parse(FULL)!).unverified).toBeUndefined();
  });

  it("reports how much text was captured", () => {
    expect(d.preview(d.parse(FULL)!).lines.join(" ")).toContain("characters transcribed");
  });
});

import { describe, expect, it } from "vitest";

import { readingsFromText, readingsUser, REVISE_SYSTEM, reviseUser } from "./edit";

const LANES = [
  { label: "Purple hero", instruction: "Turn the hero background to #6D28D9 and keep the white headline 'Personas Studio'." },
  { label: "Glow hero", instruction: "Purple #6D28D9 hero with a soft violet glow behind the New persona button and larger type." },
  { label: "Split hero", instruction: "Split the hero: headline left on #6D28D9, a stacked card preview right, buttons under the headline." },
];

describe("changing the mockups from a note", () => {
  it("reads the whole request — a note at the end of a long prompt is not cut off", () => {
    const long = `${"Keep the cards, the nav and the footer exactly as they are. ".repeat(20)}Make the hero a deeper purple.`;
    expect(long.length).toBeGreaterThan(1200);
    expect(readingsUser({ edit: long, siteName: "Personas Studio" })).toContain("deeper purple");
  });

  it("hands the model the three on screen and the note, and tells it the note wins", () => {
    const user = reviseUser({ edit: "make this app purple", change: "the bold one but keep the logo white", previous: LANES, siteName: "Personas Studio" });
    expect(user).toContain("1. Purple hero:");
    expect(user).toContain("3. Split hero:");
    expect(user).toContain("the bold one but keep the logo white");
    expect(REVISE_SYSTEM).toMatch(/note wins/);
    expect(REVISE_SYSTEM).toMatch(/"lanes"/);
  });

  it("reads three readings from plain JSON, chatter around it, or the PC helper's answer envelope", () => {
    const json = JSON.stringify({ lanes: LANES });
    expect(readingsFromText(json)).toHaveLength(3);
    expect(readingsFromText(`Here you go:\n\`\`\`json\n${json}\n\`\`\``)).toHaveLength(3);
    expect(readingsFromText(JSON.stringify({ answer: json }))?.[2].label).toBe("Split hero");
    expect(readingsFromText("I couldn't do that.")).toBeNull();
    expect(readingsFromText(JSON.stringify({ lanes: LANES.slice(0, 2) }))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { createProject, looksFor, MOCKUP_IMAGE_MAX, pickLook, portalView, ReviewError, saveMockups } from "./logic";

const T = "2026-11-10T12:00:00.000Z";
const PIC = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

function fresh() {
  return createProject({ name: "Glow Spa", clientName: "Dana", siteUrl: "glowspa.vercel.app" }, T);
}

const pick = {
  lane: "bold",
  label: "Bold",
  edit: "Bigger booking button",
  instruction: "Bigger booking button, reimagined boldly for that part of the page",
  tweaks: ["make it gold"],
};

describe("picking a version of an edit", () => {
  it("keeps which version was picked, with its tweaks, beside the look", () => {
    const p = fresh();
    const skill = looksFor(p)[0];
    const next = pickLook(p, skill, "client", T, pick);
    expect(next.look?.skill).toBe(skill);
    expect(next.look?.edit).toEqual(pick);
  });

  it("re-picking the same version writes nothing; a new tweak does", () => {
    const p = pickLook(fresh(), looksFor(fresh())[0], "client", T, pick);
    expect(pickLook(p, p.look!.skill, "client", T, pick)).toBe(p);
    expect(pickLook(p, p.look!.skill, "client", T, { ...pick, tweaks: ["make it silver"] })).not.toBe(p);
  });

  it("refuses a version that was never on offer", () => {
    const p = fresh();
    expect(() => pickLook(p, looksFor(p)[0], "client", T, { ...pick, lane: "secret" })).toThrow(ReviewError);
  });
});

describe("the owner's paintings, kept for the client", () => {
  it("saves up to three, one per lane, and shows them on the client's view", () => {
    const next = saveMockups(fresh(), {
      edit: "Bigger booking button",
      lanes: [
        { lane: "faithful", image: PIC },
        { lane: "faithful", image: PIC },
        { lane: "bold", image: PIC },
        { lane: "polished", image: PIC },
      ],
    }, T);
    expect(next.mockups?.lanes.map((l) => l.lane)).toEqual(["faithful", "bold", "polished"]);
    expect(portalView(next, null).mockups?.edit).toBe("Bigger booking button");
  });

  it("saving the same set again writes nothing", () => {
    const once = saveMockups(fresh(), { edit: "x", lanes: [{ lane: "bold", image: PIC }] }, T);
    expect(saveMockups(once, { edit: "x", lanes: [{ lane: "bold", image: PIC }] }, T)).toBe(once);
  });

  it("refuses anything that isn't a bounded picture", () => {
    const p = fresh();
    expect(() => saveMockups(p, { edit: "x", lanes: [{ lane: "bold", image: "javascript:alert(1)" }] })).toThrow(ReviewError);
    expect(() =>
      saveMockups(p, { edit: "x", lanes: [{ lane: "bold", image: `data:image/jpeg;base64,${"A".repeat(MOCKUP_IMAGE_MAX)}` }] }),
    ).toThrow(ReviewError);
    expect(() => saveMockups(p, { edit: "", lanes: [{ lane: "bold", image: PIC }] })).toThrow(ReviewError);
    expect(() => saveMockups(p, { edit: "x", lanes: [] })).toThrow(ReviewError);
  });
});

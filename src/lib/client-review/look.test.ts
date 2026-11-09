import { describe, expect, it } from "vitest";

import { directionsFor } from "@/lib/mockup/directions";
import { builderProject, createProject, looksFor, pickLook, portalView, ReviewError } from "./logic";

const T = "2026-11-09T12:00:00.000Z";

function fresh(designSkill?: string) {
  const p = createProject({ name: "Glow Spa", clientName: "Dana", siteUrl: "glowspa.vercel.app" }, T);
  if (designSkill) p.designSkill = designSkill;
  return p;
}

describe("the look a client can pick", () => {
  it("offers exactly the three the owner was shown", () => {
    const p = fresh("minimalist-skill");
    expect(looksFor(p)).toEqual(directionsFor("minimalist-skill").map((d) => d.skill));
    expect(looksFor(p)).toHaveLength(3);
    expect(looksFor(p)[0]).toBe("minimalist-skill");
  });

  it("offers the house set when App Builder sent no recommendation", () => {
    expect(looksFor(fresh())[0]).toBe("interactive-web-studio");
  });

  it("records the pick, and who made it", () => {
    const p = fresh("minimalist-skill");
    const skill = looksFor(p)[1];
    const next = pickLook(p, skill, "client", T);
    expect(next.look).toEqual({ skill, at: T, by: "client" });
    expect(pickLook(p, skill, "owner", T).look?.by).toBe("owner");
  });

  it("refuses a look that was never on offer", () => {
    const p = fresh("minimalist-skill");
    expect(() => pickLook(p, "brandkit", "client", T)).toThrow(ReviewError);
    expect(() => pickLook(p, "../../etc/passwd", "client", T)).toThrow(ReviewError);
    expect(() => pickLook(p, "", "client", T)).toThrow(ReviewError);
    expect(() => pickLook(p, 42, "client", T)).toThrow(ReviewError);
    expect(() => pickLook(p, null, "client", T)).toThrow(ReviewError);
  });

  it("says so in plain English, with no code in the message", () => {
    try {
      pickLook(fresh(), "not-a-look", "client", T);
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toBe("That isn't one of the looks on offer.");
      expect(msg).not.toMatch(/error|\d{3}|\{/i);
    }
  });

  it("writes nothing when the same look is picked twice", () => {
    const p = fresh("minimalist-skill");
    const skill = looksFor(p)[2];
    const once = pickLook(p, skill, "client", T);
    const twice = pickLook(once, skill, "client", "2026-11-09T13:00:00.000Z");
    expect(twice).toBe(once);
    expect(twice.look?.at).toBe(T);
  });

  it("lets a client change their mind back to the first direction", () => {
    const p = fresh("minimalist-skill");
    const [one, two] = looksFor(p);
    const after = pickLook(pickLook(p, two, "client", T), one, "client", T);
    expect(after.look?.skill).toBe(one);
  });

  it("keeps the offered set stable after a pick", () => {
    const p = fresh("minimalist-skill");
    const before = looksFor(p);
    expect(looksFor(pickLook(p, before[1], "client", T))).toEqual(before);
  });
});

describe("what the client's browser is told about the look", () => {
  it("carries the look and the recommendation, and still no branch or PR", () => {
    const p = pickLook(fresh("minimalist-skill"), looksFor(fresh("minimalist-skill"))[1], "client", T);
    p.versions[0].branch = "feat/secret-branch";
    p.versions[0].prUrl = "https://github.com/owner/repo/pull/9";
    const view = portalView(p, null);
    expect(view.designSkill).toBe("minimalist-skill");
    expect(view.look?.by).toBe("client");
    const json = JSON.stringify(view);
    expect(json).not.toContain("feat/secret-branch");
    expect(json).not.toContain("/pull/9");
  });

  it("is null rather than missing when nothing has been picked", () => {
    const view = portalView(fresh(), null);
    expect(view.look).toBeNull();
    expect(view.designSkill).toBeNull();
  });
});

describe("the look crossing the App Builder hand-off", () => {
  it("arrives with the project, so the client sees the owner's three", () => {
    const { project } = builderProject(
      { name: "Receipt Keeper", summary: "Receipt Keeper — files receipts\n\n• Photograph a receipt", designSkill: "minimalist-skill" },
      T,
    );
    expect(project.designSkill).toBe("minimalist-skill");
    expect(looksFor(project)[0]).toBe("minimalist-skill");
  });

  it("arrives already chosen when the owner picked one", () => {
    const { project } = builderProject(
      { name: "Receipt Keeper", designSkill: "minimalist-skill", look: "minimalist-skill" },
      T,
    );
    expect(project.look).toEqual({ skill: "minimalist-skill", at: T, by: "owner" });
  });

  it("ignores a look that isn't a string, rather than storing rubbish", () => {
    const { project } = builderProject({ name: "Receipt Keeper", look: { skill: "x" } }, T);
    expect(project.look).toBeUndefined();
  });

  it("opens with no look at all when App Builder sent none", () => {
    const { project } = builderProject({ name: "Receipt Keeper" }, T);
    expect(project.look).toBeUndefined();
    expect(project.designSkill).toBeUndefined();
  });
});

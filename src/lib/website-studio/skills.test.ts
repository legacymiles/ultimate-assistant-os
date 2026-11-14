import { describe, expect, it } from "vitest";
import roster from "@/lib/redesigner/design-skills.json";
import {
  CLOSING_PASS,
  DEFAULT_BASE,
  combine,
  comboBrief,
  comboLabel,
  inferRole,
  skillGroups,
  studioSkills,
  toggleSkill,
} from "./skills";

const ALL = studioSkills();
const names = (role: string) => ALL.filter((s) => s.role === role).map((s) => s.name);

describe("the dropdown is the real registry", () => {
  it("offers only skills that are in the roster — none invented here", () => {
    const real = new Set((roster as { name: string }[]).map((r) => r.name));
    for (const s of ALL) expect(real.has(s.name)).toBe(true);
    expect(ALL.length).toBeGreaterThan(20);
  });

  it("leaves out roster entries that are not a way to style or start a website", () => {
    for (const n of ["commercial", "hyperframes", "preview-icon", "theme-factory", "blender-threejs-export"]) {
      expect(ALL.map((s) => s.name)).not.toContain(n);
    }
  });

  it("classifies the skills the owner has rules about", () => {
    expect(names("base")).toEqual(expect.arrayContaining([DEFAULT_BASE, "taste-skill", "soft-skill", "minimalist-skill", "brutalist-skill", "cinematic-ui", "redesign-skill"]));
    expect(names("pass")).toEqual(expect.arrayContaining(["impeccable", "ui-ux-pro-max", "web-design-guidelines"]));
    expect(names("specialist")).toEqual(expect.arrayContaining(["webgl-trail-reveal", "exploded-showcase"]));
    expect(names("workflow")).toEqual(expect.arrayContaining(["clone-site", "remix-site"]));
  });

  it("marks everything that spends money or renders footage, and nothing else", () => {
    const paid = ALL.filter((s) => s.paid).map((s) => s.name).sort();
    expect(paid).toEqual(
      ["blender-to-web", "brandkit", "h3-scroll-world", "image-to-code-skill", "imagegen-frontend-web", "real-estate-reveal", "scroll-craft", "scroll-world"].sort(),
    );
    expect(ALL.find((s) => s.name === DEFAULT_BASE)!.paid).toBe(false);
  });

  it("carries the Skills Library's 'best for' line where the guide has one", () => {
    expect(ALL.find((s) => s.name === DEFAULT_BASE)!.bestFor).not.toBe("");
  });

  it("groups look first with the default leading, and free before paid", () => {
    const groups = skillGroups(ALL);
    expect(groups.map((g) => g.role)).toEqual(["base", "pass", "specialist", "workflow"]);
    expect(groups[0].skills[0].name).toBe(DEFAULT_BASE);
    expect(groups[1].skills[0].name).toBe(CLOSING_PASS);
    const spec = groups[2].skills.map((s) => s.paid);
    expect(spec.indexOf(true)).toBeGreaterThan(spec.lastIndexOf(false));
  });
});

describe("it grows without a code change", () => {
  it("a skill added to the roster tomorrow appears, classified from its description", () => {
    const grown = studioSkills([
      { name: "glass-skill", description: "A frosted-glass look for landing pages and dashboards." },
      { name: "a11y-audit", description: "Audit a page for accessibility and review contrast." },
      { name: "particle-hero", description: "A WebGL particle hero that reacts to the cursor." },
    ]);
    expect(grown.find((s) => s.name === "glass-skill")!.role).toBe("base");
    expect(grown.find((s) => s.name === "a11y-audit")!.role).toBe("pass");
    expect(grown.find((s) => s.name === "particle-hero")!.role).toBe("specialist");
  });

  it("never lists a skill twice, and ignores blanks", () => {
    const grown = studioSkills([
      { name: DEFAULT_BASE, description: "again" },
      { name: "  ", description: "blank" },
    ]);
    expect(grown.filter((s) => s.name === DEFAULT_BASE)).toHaveLength(1);
    expect(grown).toHaveLength(ALL.length);
  });

  it("reads a role from words, not from a list", () => {
    expect(inferRole("Clone any website pixel for pixel")).toBe("workflow");
    expect(inferRole("Editorial, calm, monochrome interfaces")).toBe("base");
  });
});

describe("combining", () => {
  it("nothing picked is the default look, closed by Impeccable", () => {
    const c = combine([], ALL);
    expect(c.base).toBe(DEFAULT_BASE);
    expect(c.order).toEqual([DEFAULT_BASE, CLOSING_PASS]);
    expect(comboLabel(c)).toBe(DEFAULT_BASE);
  });

  it("bases replace each other — ticking a second look unticks the first", () => {
    let picks = toggleSkill([], "taste-skill", ALL);
    picks = toggleSkill(picks, "webgl-trail-reveal", ALL);
    picks = toggleSkill(picks, "soft-skill", ALL);
    expect(picks).toEqual(["webgl-trail-reveal", "soft-skill"]);
    expect(combine(picks, ALL).base).toBe("soft-skill");
  });

  it("passes and specialists stack, in a fixed running order", () => {
    const c = combine(["exploded-showcase", "ui-ux-pro-max", "brutalist-skill", "web-design-guidelines", "webgl-trail-reveal"], ALL);
    expect(c.order).toEqual(["ui-ux-pro-max", "brutalist-skill", "exploded-showcase", "webgl-trail-reveal", "web-design-guidelines", "impeccable"]);
    expect(comboLabel(c)).toBe("brutalist-skill + 4");
  });

  it("Impeccable always closes and cannot be unticked", () => {
    expect(toggleSkill(["impeccable"], "impeccable", ALL)).toEqual(["impeccable"]);
    expect(combine(["taste-skill"], ALL).order.at(-1)).toBe("impeccable");
    expect(combine(["impeccable", "taste-skill"], ALL).order).toEqual(["taste-skill", "impeccable"]);
  });

  it("unticking the look falls back to the default, never to none", () => {
    const picks = toggleSkill(["cinematic-ui"], "cinematic-ui", ALL);
    expect(picks).toEqual([]);
    expect(combine(picks, ALL).base).toBe(DEFAULT_BASE);
  });

  it("drops names that are not skills", () => {
    expect(combine(["made-up-skill", "taste-skill"], ALL).order).toEqual(["taste-skill", "impeccable"]);
    expect(toggleSkill(["taste-skill"], "made-up-skill", ALL)).toEqual(["taste-skill"]);
  });

  it("reports paid picks and says so in the brief, and only then", () => {
    const paid = combine(["soft-skill", "scroll-craft"], ALL);
    expect(paid.paid).toEqual(["scroll-craft"]);
    expect(comboBrief(paid)).toMatch(/opted in to scroll-craft/);
    expect(comboBrief(paid)).toMatch(/WanGP/);
    expect(comboBrief(combine(["soft-skill"], ALL))).not.toMatch(/opted in/);
  });

  it("the brief names the order and who owns the look", () => {
    const b = comboBrief(combine(["ui-ux-pro-max", "minimalist-skill", "webgl-trail-reveal"], ALL));
    expect(b).toContain("ui-ux-pro-max → minimalist-skill → webgl-trail-reveal → impeccable");
    expect(b).toContain("minimalist-skill owns the look");
  });
});

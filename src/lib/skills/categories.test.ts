import { describe, expect, it } from "vitest";
import { categoriesIn, matchesQuery, nicknameClashes, skillMeta } from "./categories";
import type { Skill } from "./types";

const skill = (slug: string, body: string, overview = "", title = slug): Skill => ({
  id: slug,
  title,
  overview,
  body,
  source: "claude-code",
  slug,
  origin: "Personal",
  createdAt: "",
  updatedAt: "",
});

const felix = skill(
  "felix",
  `---
name: felix
description: Ambitious planning. Nicknames: Felix, the Felix skill, be ambitious, end goal skill.
license: MIT
metadata:
  author: legacymiles
  category: Prompt Engineering, Planning
  nicknames: Felix, the Felix skill, be ambitious, end goal skill
---
# Felix`,
  "Ambitious planning. Nicknames: Felix, the Felix skill, be ambitious, end goal skill.",
);

describe("skillMeta", () => {
  it("reads category and nicknames from the skill file", () => {
    const m = skillMeta(felix);
    expect(m.categories).toEqual(["Prompt Engineering", "Planning"]);
    expect(m.guessed).toBe(false);
    expect(m.nicknames).toEqual(["the Felix skill", "be ambitious", "end goal skill"]);
    expect(m.command).toBe("/felix");
  });

  it("reads nicknames from the description alone", () => {
    const s = skill("x-skill", "---\nname: x-skill\ndescription: Does x. Also called: ex, the x thing.\n---", "Does x. Also called: ex, the x thing.");
    expect(skillMeta(s).nicknames).toEqual(["ex", "the x thing"]);
  });

  it("uses the curated map for skills it doesn't own", () => {
    const s = skill("super-qa", "---\nname: super-qa\ndescription: QA lane.\n---", "QA lane.");
    expect(skillMeta(s).categories[0]).toBe("Testing & QA");
    expect(skillMeta(s).nicknames).toContain("bug bash");
  });

  it("guesses a category when nothing says, and never leaves one empty", () => {
    expect(skillMeta(skill("clip-cutter", "", "Cut and caption short video clips for TikTok")).categories[0]).toBe("Video Editing");
    expect(skillMeta(skill("clip-cutter-2", "", "Cut and caption short video clips")).guessed).toBe(true);
    expect(skillMeta(skill("mystery", "", "Does a thing")).categories).toEqual(["Other"]);
  });
});

describe("search and filters", () => {
  it("finds a skill by nickname, command or category", () => {
    expect(matchesQuery(felix, "be ambitious")).toBe(true);
    expect(matchesQuery(felix, "/felix")).toBe(true);
    expect(matchesQuery(felix, "prompt engineering")).toBe(true);
    expect(matchesQuery(felix, "video")).toBe(false);
  });

  it("counts categories in display order, Other last", () => {
    const list = [felix, skill("mystery", "", "Does a thing"), skill("cut", "", "edit video footage")];
    const cats = categoriesIn(list);
    const used = cats.filter((c) => c.count > 0).map((c) => c.name);
    expect(used).toEqual(["Prompt Engineering", "Planning", "Video Editing", "Other"]);
    // The standard set is always there, even empty, so the chips never vanish.
    expect(cats.find((c) => c.name === "Security")?.count).toBe(0);
    expect(cats[cats.length - 1].name).toBe("Other");
  });

  it("flags two skills answering to the same nickname", () => {
    const other = skill("ambition", "---\nname: ambition\ndescription: x. Nicknames: be ambitious.\n---", "x. Nicknames: be ambitious.");
    expect(nicknameClashes([felix, other]).get("be ambitious")).toEqual(["felix", "ambition"]);
    expect(nicknameClashes([felix]).size).toBe(0);
  });
});

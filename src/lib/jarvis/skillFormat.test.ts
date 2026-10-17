import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hashSkill,
  normalizeFiles,
  readSkillDir,
  skillDescription,
  validRefPath,
  validSkillName,
} from "./skillFormat.mjs";
import { INSTRUCTIONS, TOOLS } from "./mcpProtocol";

const SKILL = `---
name: stock-screener
description: >-
  Screen stocks by rules the owner gives.
  Use when asked to screen or filter tickers.
---
# Stock screener
Do the thing.
`;

describe("skill names and paths (they become folders on every machine)", () => {
  it("accepts ordinary names and refuses anything that could escape a folder", () => {
    for (const ok of ["rea", "stock-screener", "my_skill.v2", "A1"]) expect(validSkillName(ok)).toBe(true);
    for (const bad of ["", "../x", "a/b", "a\\b", ".hidden", "-x", "x".repeat(65), "a..b", "C:x"]) expect(validSkillName(bad)).toBe(false);
  });
  it("only lets text files under references/ through", () => {
    expect(validRefPath("references/guide.md")).toBe(true);
    expect(validRefPath("references/deep/notes.txt")).toBe(true);
    for (const bad of [
      "SKILL.md",
      "references/../../../.ssh/authorized_keys",
      "references/../x.md",
      "/etc/passwd",
      "references\\x.md",
      "C:/x/references/a.md",
      "references/img.png",
      "references/",
      "scripts/run.sh",
    ])
      expect(validRefPath(bad)).toBe(false);
  });
  it("drops invalid entries instead of storing them", () => {
    expect(normalizeFiles({ "references/a.md": "a", "references/../b.md": "b", "references/c.md": 3, "x.md": "x" })).toEqual({
      "references/a.md": "a",
    });
  });
});

describe("the hash every writer agrees on", () => {
  it("ignores file order and invalid files, and changes when content changes", () => {
    const a = hashSkill(SKILL, { "references/b.md": "2", "references/a.md": "1" });
    const b = hashSkill(SKILL, { "references/a.md": "1", "references/b.md": "2", "references/../evil.md": "x" });
    expect(a).toBe(b);
    expect(hashSkill(SKILL, { "references/a.md": "1!" , "references/b.md": "2"})).not.toBe(a);
    expect(hashSkill(SKILL + " ", {})).not.toBe(hashSkill(SKILL, {}));
  });
  it("is what readSkillDir reports for the same files on disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "skill-"));
    await writeFile(path.join(dir, "SKILL.md"), SKILL);
    await mkdir(path.join(dir, "references", "deep"), { recursive: true });
    await writeFile(path.join(dir, "references", "a.md"), "1");
    await writeFile(path.join(dir, "references", "deep", "b.txt"), "2");
    await writeFile(path.join(dir, "references", "pic.png"), "binary");
    const skipped: string[] = [];
    const sk = await readSkillDir(dir, skipped);
    expect(sk?.files).toEqual({ "references/a.md": "1", "references/deep/b.txt": "2" });
    expect(sk?.hash).toBe(hashSkill(SKILL, { "references/a.md": "1", "references/deep/b.txt": "2" }));
    expect(skipped.some((s) => s.includes("pic.png"))).toBe(true);
  });
  it("reads a folded description", () => {
    expect(skillDescription(SKILL)).toBe("Screen stocks by rules the owner gives. Use when asked to screen or filter tickers.");
    expect(skillDescription("---\nname: x\ndescription: Inline one.\n---\n")).toBe("Inline one.");
  });
});

describe("the connector tells every client to save skills into Jarvis", () => {
  it("has the skill tools and says when to use them", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["save_skill", "list_skills", "get_skill"]));
    expect(INSTRUCTIONS).toMatch(/save_skill/);
    const save = TOOLS.find((t) => t.name === "save_skill")!;
    expect((save.inputSchema as { required: string[] }).required).toEqual(["name", "skill_md"]);
  });
});

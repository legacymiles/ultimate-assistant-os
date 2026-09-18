import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPrompt, followUpPrompt, ownerMessage } from "../lib/claude.mjs";
import { findGameSkills, parseSkill, skillReport } from "../lib/skills.mjs";
import { watchGame } from "../lib/watch.mjs";

const skillMd = (name, extra = "") => `---
name: ${name}
description: >-
  Build a real game. Second sentence here.
metadata:
  game-creator: true
${extra}---

# ${name}
`;

test("parseSkill only accepts skills tagged game-creator", () => {
  assert.deepEqual(parseSkill(skillMd("unreal-game-builder", "  game-creator-default: true\n"), "x"), {
    name: "unreal-game-builder",
    description: "Build a real game.",
    isDefault: true,
  });
  assert.equal(parseSkill("---\nname: gauntlet-loop\ndescription: x\n---\n", "gauntlet-loop"), null);
  assert.equal(parseSkill("no frontmatter", "x"), null);
});

test("findGameSkills scans folders and skillReport picks one default", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gc-skills-"));
  try {
    for (const [name, md] of [
      ["unreal-game-builder", skillMd("unreal-game-builder")],
      ["godot-builder", skillMd("godot-builder", "  game-creator-default: true\n")],
      ["gauntlet-loop", "---\nname: gauntlet-loop\ndescription: critic loop\n---\n"],
    ]) {
      await fs.mkdir(path.join(dir, name));
      await fs.writeFile(path.join(dir, name, "SKILL.md"), md);
    }
    const skills = await findGameSkills([dir, path.join(dir, "missing")]);
    assert.deepEqual(skills.map((s) => s.name), ["godot-builder", "unreal-game-builder"]);
    assert.equal(skillReport(skills).defaultSkill, "godot-builder");
    assert.equal(skillReport(skills, "unreal-game-builder").defaultSkill, "unreal-game-builder");
    assert.equal(skillReport(skills, "not-there").defaultSkill, "godot-builder");
    assert.equal(skillReport([]).defaultSkill, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildPrompt pins the chosen skill as the first action", () => {
  const p = buildPrompt({ id: "g1", prompt: "zombie shooter", template: "Auto", skill: "godot-builder" });
  assert.match(p, /FIRST action must be the Skill tool with skill "godot-builder"/);
  assert.match(p, /Do not load any other game-building skill/);
  assert.match(p, /Message from the owner/);
  assert.match(buildPrompt({ id: "g1", prompt: "zombie shooter", template: "Auto" }), /skill "unreal-game-builder"/);
});

test("followUpPrompt carries the owner's messages; a fresh session also gets the skill and original prompt", () => {
  const game = { id: "g1", prompt: "zombie shooter", skill: "unreal-game-builder", paths: { uproject: "C:/p/DeadCity.uproject" } };
  const resumed = followUpPrompt(game, [{ text: "make the zombies faster" }], { resumed: true });
  assert.match(resumed, /make the zombies faster/);
  assert.match(resumed, /DeadCity\.uproject/);
  assert.doesNotMatch(resumed, /FIRST action/);
  const fresh = followUpPrompt(game, [{ text: "add fog" }], { resumed: false });
  assert.match(fresh, /FIRST action must be the Skill tool/);
  assert.match(fresh, /zombie shooter/);
  assert.match(ownerMessage("hi"), /^Message from the owner/);
});

test("a follow-up watcher ignores the files the last build left", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gc-follow-"));
  try {
    const projectDir = path.join(root, "DeadCity");
    const gc = path.join(projectDir, "GameCreator");
    await fs.mkdir(path.join(gc, "shots"), { recursive: true });
    await fs.mkdir(path.join(root, ".game-creator"), { recursive: true });
    await fs.writeFile(path.join(root, ".game-creator", "registry.json"), JSON.stringify({ g1: { projectDir, uproject: "x" } }));
    await fs.writeFile(path.join(gc, "game.json"), JSON.stringify({ stage: "ready", title: "old" }));
    await fs.writeFile(path.join(gc, "shots", "01.png"), "png");

    const seen = [];
    const w = watchGame({ projectsRoot: root, gameId: "g1", intervalMs: 50, ignoreExisting: true, onChange: (c) => seen.push(c) });
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(seen.map((c) => c.type), ["project"]);

    await fs.writeFile(path.join(gc, "game.json"), JSON.stringify({ stage: "ready", title: "new" }));
    await new Promise((r) => setTimeout(r, 300));
    await w.stop();
    const manifests = seen.filter((c) => c.type === "manifest");
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0].manifest.title, "new");
    assert.ok(!seen.some((c) => c.type === "screenshot"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

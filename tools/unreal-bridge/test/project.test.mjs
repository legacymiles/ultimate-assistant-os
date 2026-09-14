import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildUproject, createProject, parseSharedContentPacks, safeProjectName, REQUIRED_PLUGINS } from "../lib/project.mjs";
import { get } from "../lib/registry.mjs";

let tmp;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gc-project-"));
  const engine = path.join(tmp, "engine");
  const tpl = path.join(engine, "Templates", "TP_FirstPersonBP");
  await fs.mkdir(path.join(tpl, "Config"), { recursive: true });
  await fs.mkdir(path.join(tpl, "Content", "FirstPerson"), { recursive: true });
  await fs.writeFile(path.join(tpl, "Config", "DefaultEngine.ini"), "[x]\n");
  await fs.writeFile(
    path.join(tpl, "Config", "TemplateDefs.ini"),
    [
      "[x]",
      'SharedContentPacks=(MountName="Characters",DetailLevels=("High"))',
      'SharedContentPacks=(MountName="Input",DetailLevels=("High"))',
      'Variants=(Name="Shooter",SharedContentPacks=((DetailLevels=(Standard),MountName="Weapons")))',
    ].join("\n"),
  );
  const res = path.join(engine, "Templates", "TemplateResources");
  await fs.mkdir(path.join(res, "High", "Characters", "Content", "Mannequins"), { recursive: true });
  await fs.writeFile(path.join(res, "High", "Characters", "Content", "Mannequins", "SK.uasset"), "sk");
  // Input only exists at Standard: exercises the detail-level fallback.
  await fs.mkdir(path.join(res, "Standard", "Input", "Content", "Actions"), { recursive: true });
  await fs.writeFile(path.join(res, "Standard", "Input", "Content", "Actions", "IA_Jump.uasset"), "ia");
  await fs.writeFile(path.join(tpl, "Content", "FirstPerson", "Lvl.umap"), "map");
  await fs.writeFile(
    path.join(tpl, "TP_FirstPersonBP.uproject"),
    JSON.stringify({ Plugins: [{ Name: "GameplayStateTree", Enabled: true }] }),
  );
  process.env.UE_ENGINE_DIR = engine;
  process.env.GC_PROJECTS_ROOT = path.join(tmp, "projects");
});

after(async () => {
  delete process.env.UE_ENGINE_DIR;
  delete process.env.GC_PROJECTS_ROOT;
  await fs.rm(tmp, { recursive: true, force: true });
});

test("safeProjectName makes a valid, short identifier", () => {
  assert.equal(safeProjectName("My cool game!"), "MyCoolGame");
  assert.equal(safeProjectName("3d racer"), "G3dRacer");
  assert.equal(safeProjectName(""), "Game");
  assert.equal(safeProjectName("an extremely long name for a game project").length, 20);
});

test("buildUproject enables every MCP plugin and keeps template plugins", () => {
  const doc = buildUproject({ templatePlugins: [{ Name: "GameplayStateTree", Enabled: true }] });
  assert.equal(doc.EngineAssociation, "5.8");
  const names = doc.Plugins.map((p) => p.Name);
  assert.ok(names.includes("GameplayStateTree"));
  for (const req of REQUIRED_PLUGINS) {
    const p = doc.Plugins.find((x) => x.Name === req);
    assert.ok(p?.Enabled, `${req} enabled`);
    // Editor-only, or packaging demands a compiled game build.
    assert.deepEqual(p.TargetAllowList, ["Editor"], `${req} limited to the editor`);
  }
  assert.equal(doc.Plugins.find((p) => p.Name === "GameplayStateTree").TargetAllowList, undefined);
  assert.equal(new Set(names).size, names.length, "no duplicates");
});

test("buildUproject turns on a required plugin the template had disabled", () => {
  const doc = buildUproject({ templatePlugins: [{ Name: "PythonScriptPlugin", Enabled: false }] });
  assert.equal(doc.Plugins.filter((p) => p.Name === "PythonScriptPlugin").length, 1);
  assert.equal(doc.Plugins.find((p) => p.Name === "PythonScriptPlugin").Enabled, true);
});

test("createProject copies the template, writes the uproject, and registers the game", async () => {
  const entry = await createProject({ name: "Target Range", template: "FirstPerson", id: "g1" });
  assert.equal(entry.name, "TargetRange");
  const uproject = JSON.parse(await fs.readFile(entry.uproject, "utf8"));
  assert.ok(uproject.Plugins.find((p) => p.Name === "ModelContextProtocol"));
  await fs.access(path.join(entry.projectDir, "Content", "FirstPerson", "Lvl.umap"));
  await fs.access(path.join(entry.projectDir, "GameCreator", "shots"));
  await assert.rejects(fs.access(path.join(entry.projectDir, "Config", "TemplateDefs.ini")));
  assert.equal((await get("g1")).projectDir, entry.projectDir);
});

test("parseSharedContentPacks reads top-level packs and skips variant packs", () => {
  const ini = [
    'SharedContentPacks=(MountName="Characters",DetailLevels=("High"))',
    ';SharedContentPacks=(MountName="Commented",DetailLevels=("Standard"))',
    'Variants=(Name="All",SharedContentPacks=((DetailLevels=(Standard),MountName="Weapons")))',
    'SharedContentPacks=(MountName="Cursor",DetailLevels=("Standard"))',
  ].join("\r\n");
  assert.deepEqual(parseSharedContentPacks(ini), [
    { mount: "Characters", levels: ["High"] },
    { mount: "Cursor", levels: ["Standard"] },
  ]);
});

test("createProject copies shared content packs into /Game/<Mount>", async () => {
  const entry = await createProject({ name: "Pack Check", template: "FirstPerson", id: "g3" });
  await fs.access(path.join(entry.projectDir, "Content", "Characters", "Mannequins", "SK.uasset"));
  await fs.access(path.join(entry.projectDir, "Content", "Input", "Actions", "IA_Jump.uasset"));
  await assert.rejects(fs.access(path.join(entry.projectDir, "Content", "Weapons")));
  assert.deepEqual(entry.contentPacks, ["Characters (High)", "Input (Standard)"]);
});

test("createProject never overwrites an existing project folder", async () => {
  const second = await createProject({ name: "Target Range", template: "FirstPerson", id: "g2" });
  assert.equal(second.name, "TargetRange2");
});

test("createProject rejects an unknown template", async () => {
  await assert.rejects(createProject({ name: "x", template: "Nope" }), /Unknown template/);
});

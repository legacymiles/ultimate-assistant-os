import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withPackagingUproject } from "../lib/package.mjs";
import { buildUproject } from "../lib/project.mjs";

let tmp;
let uproject;
let original;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gc-package-"));
  uproject = path.join(tmp, "Game.uproject");
  const doc = buildUproject({
    templatePlugins: [
      { Name: "ModelingToolsEditorMode", Enabled: true, TargetAllowList: ["Editor"] },
      { Name: "GameplayStateTree", Enabled: true },
    ],
  });
  original = JSON.stringify(doc, null, "\t");
  await fs.writeFile(uproject, original, "utf8");
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

test("packaging sees only editor-only template plugins; runtime and MCP plugins are left out", async () => {
  const { seen, removed } = await withPackagingUproject(uproject, async (removed) => ({
    seen: JSON.parse(await fs.readFile(uproject, "utf8")),
    removed,
  }));
  assert.deepEqual(seen.Plugins.map((p) => p.Name), ["ModelingToolsEditorMode"]);
  assert.ok(removed.includes("GameplayStateTree"));
  assert.ok(removed.includes("ModelContextProtocol"));
});

test("the original .uproject is restored afterwards", async () => {
  await withPackagingUproject(uproject, async () => "done");
  assert.equal(await fs.readFile(uproject, "utf8"), original);
  await assert.rejects(fs.access(`${uproject}.gamecreator-backup`));
});

test("the original is restored even when packaging throws", async () => {
  await assert.rejects(
    withPackagingUproject(uproject, async () => {
      throw new Error("cook crashed");
    }),
    /cook crashed/,
  );
  assert.equal(await fs.readFile(uproject, "utf8"), original);
});

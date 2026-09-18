import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPrompt, describeToolUse, linesFromEvent } from "../lib/claude.mjs";
import { statusForStage, watchGame } from "../lib/watch.mjs";
import { parseLink } from "../open.mjs";

test("buildPrompt names the skill, the id and the chosen template", () => {
  const p = buildPrompt({ id: "abc-123", prompt: "A coin rush", template: "ThirdPerson" });
  assert.match(p, /skill "unreal-game-builder"/);
  assert.match(p, /abc-123/);
  assert.match(p, /ThirdPerson/);
  assert.match(p, /A coin rush/);
  assert.match(buildPrompt({ id: "x", prompt: "y", template: "Auto" }), /choose the one that fits/);
  assert.match(p, /gauntlet-loop skill/);
});

test("tool uses become short readable lines", () => {
  assert.equal(
    describeToolUse({ name: "mcp__unreal__call_tool", input: { toolset_name: "editor_toolset.toolsets.blueprint.BlueprintTools", tool_name: "create" } }),
    "→ BlueprintTools.create",
  );
  assert.equal(describeToolUse({ name: "mcp__unreal__unreal_screenshot", input: { name: "02-play", view: "player" } }), "→ screenshot 02-play (player)");
  assert.equal(describeToolUse({ name: "Write", input: { file_path: "C:\\p\\GameCreator\\Design.md" } }), "→ Write GameCreator/Design.md");
});

test("stream-json events turn into log lines", () => {
  const lines = linesFromEvent({
    type: "assistant",
    message: { content: [{ type: "text", text: "Designing the game.\n\nPicking FirstPerson." }, { type: "tool_use", name: "mcp__unreal__unreal_status", input: {} }] },
  });
  assert.deepEqual(lines, ["Designing the game.", "Picking FirstPerson.", "→ unreal_status"]);
  assert.deepEqual(linesFromEvent({ type: "result", is_error: false }), ["Claude finished."]);
  assert.deepEqual(linesFromEvent({ type: "system" }), []);
});

test("skill stages map to gallery statuses", () => {
  assert.equal(statusForStage("design"), "designing");
  assert.equal(statusForStage("Building"), "building");
  assert.equal(statusForStage("testing"), "testing");
  assert.equal(statusForStage("packaging"), "packaging");
  assert.equal(statusForStage("ready"), "ready");
  assert.equal(statusForStage("nonsense"), null);
});

test("ueos links: only open/play with a plain id are accepted", () => {
  assert.deepEqual(parseLink("ueos://open?id=0f8c2a1e-aaaa-bbbb"), { action: "open", id: "0f8c2a1e-aaaa-bbbb" });
  assert.deepEqual(parseLink("ueos://play/?id=0f8c2a1e-aaaa-bbbb"), { action: "play", id: "0f8c2a1e-aaaa-bbbb" });
  assert.equal(parseLink("ueos://delete?id=0f8c2a1e-aaaa-bbbb"), null);
  assert.equal(parseLink("ueos://open?id=..%5C..%5Cwindows"), null);
  assert.equal(parseLink("https://evil.example/open?id=0f8c2a1e-aaaa"), null);
  assert.equal(parseLink("not a url"), null);
});

test("watchGame reports the project, status, design, screenshots and manifest once each", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gc-watch-"));
  const projectDir = path.join(root, "Coins");
  const dir = path.join(projectDir, "GameCreator");
  await fs.mkdir(path.join(dir, "shots"), { recursive: true });
  await fs.mkdir(path.join(root, ".game-creator"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".game-creator", "registry.json"),
    JSON.stringify({ g1: { id: "g1", projectDir, uproject: path.join(projectDir, "Coins.uproject") } }),
  );
  await fs.writeFile(path.join(dir, "status.json"), JSON.stringify({ stage: "building", note: "Coins" }));
  await fs.writeFile(path.join(dir, "Design.md"), "# Coins");
  await fs.writeFile(path.join(dir, "shots", "01.png"), "png-bytes");
  await fs.writeFile(path.join(dir, "shots", "captions.json"), JSON.stringify({ "01.png": "Wide" }));
  await fs.writeFile(path.join(dir, "game.json"), JSON.stringify({ stage: "ready", title: "Coins" }));

  const seen = [];
  const w = watchGame({ projectsRoot: root, gameId: "g1", intervalMs: 50, onChange: async (c) => seen.push(c) });
  await new Promise((r) => setTimeout(r, 1500));
  await w.stop();

  const types = seen.map((c) => c.type);
  assert.deepEqual(types.filter((t) => t === "project").length, 1);
  assert.ok(seen.find((c) => c.type === "status" && c.status === "building" && c.note === "Coins"));
  assert.equal(seen.filter((c) => c.type === "design").length, 1);
  const shots = seen.filter((c) => c.type === "screenshot");
  assert.equal(shots.length, 1);
  assert.equal(shots[0].caption, "Wide");
  assert.equal(seen.filter((c) => c.type === "manifest").length, 1);
  await fs.rm(root, { recursive: true, force: true });
});

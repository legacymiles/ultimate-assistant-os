import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareVersions, mixamoLibrary, parseBlenderVersion } from "../lib/detect.mjs";
import { buildPrompt, describeToolUse, linesFromEvent } from "../lib/claude.mjs";
import { CHUNK_BYTES, chunkRanges, contentTypeFor } from "../lib/hub.mjs";
import { jobFolderName, resolveVideo, statusForStage, watchJob } from "../lib/watch.mjs";

test("maps skill stages to hub statuses", () => {
  assert.equal(statusForStage("assets"), "building");
  assert.equal(statusForStage("Mixamo"), "animating");
  assert.equal(statusForStage("cascadeur"), "animating");
  assert.equal(statusForStage("encode"), "rendering");
  assert.equal(statusForStage("ready"), "ready");
  assert.equal(statusForStage("nonsense"), null);
});

test("parses Blender versions and picks the newest", () => {
  assert.equal(parseBlenderVersion("Blender 5.0.1\n\tbuild date: 2025-12-01"), "5.0.1");
  assert.equal(parseBlenderVersion("nope"), null);
  assert.deepEqual(["4.2", "5.0", "4.5.3"].sort(compareVersions), ["5.0", "4.5.3", "4.2"]);
});

test("job folder names are safe and unique per project", () => {
  assert.equal(jobFolderName("Tiny Robot: City Lights!", "1a2b3c4d-5e6f"), "tiny-robot-city-lights-1a2b3c4d");
  assert.equal(jobFolderName("", "abcdef12-x"), "video-abcdef12");
});

test("reads the Mixamo library", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "s3d-mixamo-"));
  await writeFile(path.join(dir, "Walking.fbx"), "x");
  await writeFile(path.join(dir, "Hip Hop Dancing.FBX"), "x");
  await writeFile(path.join(dir, "notes.txt"), "x");
  await mkdir(path.join(dir, "characters"));
  await writeFile(path.join(dir, "characters", "Hero.fbx"), "x");
  assert.deepEqual(await mixamoLibrary(dir), { clips: ["Hip Hop Dancing", "Walking"], characters: 1 });
  assert.deepEqual(await mixamoLibrary(path.join(dir, "missing")), { clips: [], characters: 0 });
});

test("summarises Blender and Cascadeur tool calls", () => {
  assert.equal(describeToolUse({ name: "mcp__blender__execute_blender_code", input: {} }), "→ Blender: execute_blender_code");
  assert.equal(describeToolUse({ name: "mcp__cascadeur__export_fbx", input: {} }), "→ Cascadeur: export_fbx");
  assert.equal(
    describeToolUse({ name: "Bash", input: { command: '"C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" -b -P "C:/job/scripts/scene_01.py" -- job.json' } }),
    "→ Blender (background): scene_01.py",
  );
  assert.deepEqual(linesFromEvent({ type: "result", is_error: false }), ["Claude finished."]);
});

test("the prompt carries the id, the job folder and what the PC has", () => {
  const prompt = buildPrompt({
    project: { id: "p-123" },
    jobDir: "C:/Studio/job",
    capabilities: { blender: { found: true, version: "5.0" }, mixamo: { clips: ["Walking"], characters: 0 }, cascadeur: { found: false }, paths: { blender: "b.exe", mixamoLibrary: "lib" } },
  });
  assert.match(prompt, /animation-director skill/);
  assert.match(prompt, /p-123/);
  assert.match(prompt, /C:\/Studio\/job/);
  assert.match(prompt, /Cascadeur: NOT INSTALLED/);
});

test("content types", () => {
  assert.equal(contentTypeFor("a/final.MP4"), "video/mp4");
  assert.equal(contentTypeFor("s.png"), "image/png");
});

test("splits large uploads into chunks under the middleware body cap", () => {
  const mb = 1024 * 1024;
  assert.deepEqual(chunkRanges(20 * mb), [[0, 8 * mb], [8 * mb, 16 * mb], [16 * mb, 20 * mb]]);
  assert.deepEqual(chunkRanges(8 * mb), [[0, 8 * mb]]);
  assert.ok(CHUNK_BYTES < 10 * mb);
});

test("watches a job folder: status, stills and report", async () => {
  const jobDir = await mkdtemp(path.join(os.tmpdir(), "s3d-job-"));
  const studio = path.join(jobDir, "studio");
  await mkdir(path.join(studio, "stills"), { recursive: true });
  await mkdir(path.join(studio, "render"), { recursive: true });
  const changes = [];
  const w = watchJob({ jobDir, intervalMs: 50, onChange: async (c) => changes.push(c) });

  await writeFile(path.join(studio, "status.json"), JSON.stringify({ stage: "animate", note: "Mixamo clips" }));
  await writeFile(path.join(studio, "stills", "s01.png"), "png-bytes");
  await writeFile(path.join(studio, "stills", "captions.json"), JSON.stringify({ "s01.png": { caption: "Opening", sceneId: "s1" } }));
  await writeFile(path.join(studio, "render", "final.mp4"), "mp4-bytes");
  await writeFile(path.join(studio, "report.json"), JSON.stringify({ stage: "ready", video: "render/final.mp4" }));
  await new Promise((r) => setTimeout(r, 1200));
  await w.stop();

  assert.ok(changes.some((c) => c.type === "status" && c.status === "animating" && c.note === "Mixamo clips"));
  const still = changes.find((c) => c.type === "still");
  assert.equal(still?.caption, "Opening");
  assert.equal(still?.sceneId, "s1");
  const report = changes.find((c) => c.type === "report")?.report;
  assert.equal(report?.stage, "ready");
  assert.equal(await resolveVideo(jobDir, report), path.join(studio, "render", "final.mp4"));
  assert.equal(await resolveVideo(jobDir, { video: "render/missing.mp4" }), path.join(studio, "render", "final.mp4"));
});

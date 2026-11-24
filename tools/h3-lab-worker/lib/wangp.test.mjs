import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { prepareSettings } from "./wangp.mjs";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("settings pass through verbatim except prompt newlines and data-URL media", async () => {
  const dir = path.join(os.tmpdir(), `h3-lab-refs-test-${process.pid}`);
  const settings = {
    model_type: "minimax_h3_ref2va_pruned",
    prompt: "Line one.\n\nLine two.\r\n  Line three.",
    resolution: "832x480",
    video_length: 121,
    seed: 42,
    activated_loras: ["turbo.safetensors"],
    image_refs: [`data:image/png;base64,${PNG_1PX}`, "C:\\already\\a-path.jpg"],
    image_start: [`data:image/jpeg;base64,${PNG_1PX}`],
    custom_settings: { nested: { keep: true } },
  };
  const before = structuredClone(settings);
  const { source, tempFiles } = await prepareSettings(settings, "gen/1", dir);
  try {
    assert.deepEqual(settings, before, "the hub's object is not mutated");
    assert.equal(source.prompt, "Line one. Line two. Line three.");
    assert.equal(source.image_refs.length, 2);
    assert.ok(path.isAbsolute(source.image_refs[0]) && source.image_refs[0].endsWith("gen_1-0.png"));
    assert.equal(source.image_refs[1], "C:\\already\\a-path.jpg");
    assert.ok(source.image_start[0].endsWith("gen_1-1.jpg"));
    assert.equal(tempFiles.length, 2);
    assert.ok(readFileSync(tempFiles[0]).subarray(1, 4).toString() === "PNG");
    for (const k of ["model_type", "resolution", "video_length", "seed", "activated_loras", "custom_settings"]) {
      assert.deepEqual(source[k], before[k], k);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(!existsSync(tempFiles[0]));
});

test("no media fields, no files", async () => {
  const { source, tempFiles } = await prepareSettings({ model_type: "x", prompt: "a" }, "g", path.join(os.tmpdir(), "unused-h3"));
  assert.deepEqual(source, { model_type: "x", prompt: "a" });
  assert.equal(tempFiles.length, 0);
});

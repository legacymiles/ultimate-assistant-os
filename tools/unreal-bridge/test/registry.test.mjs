import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findByUproject, get, list, upsert } from "../lib/registry.mjs";

let tmp;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gc-registry-"));
  process.env.GC_PROJECTS_ROOT = tmp;
});

after(async () => {
  delete process.env.GC_PROJECTS_ROOT;
  await fs.rm(tmp, { recursive: true, force: true });
});

test("get returns null before anything is written", async () => {
  assert.equal(await get("missing"), null);
});

test("upsert round-trips and merges", async () => {
  await upsert({ id: "a", name: "Alpha", createdAt: "2026-01-01T00:00:00Z", uproject: path.join(tmp, "Alpha", "Alpha.uproject") });
  await upsert({ id: "a", packagedExe: "C:\\x.exe" });
  const a = await get("a");
  assert.equal(a.name, "Alpha");
  assert.equal(a.packagedExe, "C:\\x.exe");
});

test("list is newest first", async () => {
  await upsert({ id: "b", name: "Beta", createdAt: "2026-02-01T00:00:00Z" });
  assert.deepEqual((await list()).map((e) => e.id), ["b", "a"]);
});

test("findByUproject ignores case", async () => {
  const hit = await findByUproject(path.join(tmp, "ALPHA", "alpha.uproject"));
  assert.equal(hit?.id, "a");
});

test("upsert requires an id", async () => {
  await assert.rejects(upsert({ name: "no id" }), /needs an id/);
});

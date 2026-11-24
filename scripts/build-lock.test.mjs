import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CREATING_MS, STALE_MS, isStale, lockPathFor, readOwner, release, tryAcquire } from "./build-lock.mjs";

const SCRIPT = join(process.cwd(), "scripts", "build-lock.mjs");
let base = "";
const fresh = () => (base = mkdtempSync(join(tmpdir(), "build-lock-test-")));
afterEach(() => base && rmSync(base, { recursive: true, force: true }));

describe("which lock a build takes", () => {
  it("is the same for the same checkout and build folder, whatever the path's case", () => {
    fresh();
    expect(lockPathFor("C:/dev/Repo", ".next", base)).toBe(lockPathFor("c:/dev/repo", ".next", base));
  });
  it("differs per build folder and per checkout, so they never wait on each other", () => {
    fresh();
    const a = lockPathFor("C:/dev/repo", ".next", base);
    expect(lockPathFor("C:/dev/repo", ".next-preview-3227", base)).not.toBe(a);
    expect(lockPathFor("C:/dev/other", ".next", base)).not.toBe(a);
  });
});

describe("when a lock may be taken over", () => {
  const now = 1_000_000;
  const alive = () => true;
  const dead = () => false;
  it("never from a live builder", () => {
    expect(isStale({ pid: 1, started: now - 60_000 }, now, alive)).toBe(false);
  });
  it("from a builder that died, or one far too old (pids get reused)", () => {
    expect(isStale({ pid: 1, started: now - 60_000 }, now, dead)).toBe(true);
    expect(isStale({ pid: 1, started: now - STALE_MS - 1 }, now, alive)).toBe(true);
  });
  it("not while the owner file is still being written, but yes once that's clearly abandoned", () => {
    expect(isStale(null, now, alive, CREATING_MS - 1)).toBe(false);
    expect(isStale(null, now, alive, CREATING_MS + 1)).toBe(true);
  });
  it("from a garbled owner", () => {
    expect(isStale({ pid: "x" }, now, alive)).toBe(true);
  });
});

describe("taking and releasing", () => {
  it("lets exactly one in, and tells the second who holds it", () => {
    fresh();
    const lock = join(base, "x.lock");
    expect(tryAcquire(lock, { pid: 11, started: 1 }, 2, () => true)).toEqual({ ok: true });
    const second = tryAcquire(lock, { pid: 22, started: 2 }, 3, () => true);
    expect(second.ok).toBe(false);
    expect(second.owner).toMatchObject({ pid: 11 });
  });
  it("takes over a dead builder's lock", () => {
    fresh();
    const lock = join(base, "x.lock");
    tryAcquire(lock, { pid: 11, started: 1 }, 2, () => true);
    expect(tryAcquire(lock, { pid: 22, started: 5 }, 6, () => false)).toEqual({ ok: true });
    expect(readOwner(lock)).toMatchObject({ pid: 22 });
  });
  it("only lets the owner release it", () => {
    fresh();
    const lock = join(base, "x.lock");
    tryAcquire(lock, { pid: 11, started: 1 }, 2, () => true);
    expect(release(lock, 22)).toBe(false);
    expect(existsSync(lock)).toBe(true);
    expect(release(lock, 11)).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });
  it("treats a fresh lock folder with no owner yet as held", () => {
    fresh();
    const lock = join(base, "x.lock");
    mkdirSync(lock, { recursive: true });
    expect(tryAcquire(lock, { pid: 22, started: Date.now() }, Date.now(), () => false).ok).toBe(false);
  });
});

describe("the wrapper", () => {
  it("passes the command's exit code straight through — a red build stays red", () => {
    const red = spawnSync(process.execPath, [SCRIPT, process.execPath, "-e", "process.exit(3)"], { encoding: "utf8", cwd: mkdtempSync(join(tmpdir(), "bl-cwd-")) });
    expect(red.status).toBe(3);
    const green = spawnSync(process.execPath, [SCRIPT, process.execPath, "-e", "process.exit(0)"], { encoding: "utf8", cwd: mkdtempSync(join(tmpdir(), "bl-cwd-")) });
    expect(green.status).toBe(0);
  });

  it("makes a second build in the same folder wait for the first instead of overlapping", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bl-cwd-"));
    const log = join(cwd, "log.txt");
    writeFileSync(log, "");
    // Each "build" writes start, sleeps 1.2 s, writes end. Overlap would interleave them.
    const job = (name) =>
      `const fs=require("fs");fs.appendFileSync(${JSON.stringify(log)},"${name}+\\n");setTimeout(()=>{fs.appendFileSync(${JSON.stringify(log)},"${name}-\\n")},1200)`;
    const run = (name) =>
      new Promise((done) => {
        const p = spawn(process.execPath, [SCRIPT, process.execPath, "-e", job(name)], { cwd, env: { ...process.env, NEXT_DIST_DIR: ".next-lock-test" } });
        p.on("exit", (code) => done(code));
      });
    const codes = await Promise.all([run("A"), run("B")]);
    expect(codes).toEqual([0, 0]);
    const lines = (await import("node:fs")).readFileSync(log, "utf8").trim().split("\n");
    // Whichever went first finished before the other started.
    expect(lines).toHaveLength(4);
    expect(lines[0][0]).toBe(lines[1][0]);
    expect(lines[1].endsWith("-")).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  }, 20_000);
});

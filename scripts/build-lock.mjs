#!/usr/bin/env node
// ---------------------------------------------------------------------------
// One `next build` at a time per build folder.
//
// Why. Several Claude sessions work in the same checkout, and each one's Stop
// hook runs `npm run verify`, which ends in `next build`. Two builds writing
// the same `.next` at once fail with errors that have nothing to do with the
// code — `ENOENT: rename '.next/export/500.html'`, `Unexpected end of JSON
// input` — and every session is then told its work "is not finished". Seen
// twice in one morning (2026-11-24).
//
// How. `npm run build` runs `node scripts/build-lock.mjs next build`. Before
// building, it takes a lock for THIS checkout + THIS build folder
// (NEXT_DIST_DIR, default .next): a directory under the OS temp folder, made
// with mkdir — which the OS lets exactly one process create. A second build
// waits, says once that it is waiting and for whom, and builds when the first
// is done. Builds into different folders (preview servers' .next-preview-*)
// and other checkouts never wait for each other.
//
// A lock whose builder died (crash, killed terminal) is taken over: its pid is
// gone, or it is older than STALE_MS. The takeover is an atomic rename, so two
// waiters can't both take it. If the temp folder can't be written, the build
// runs unlocked rather than not at all.
//
// The build's exit code is passed through untouched, so a red build is still
// red — the lock changes when a build runs, never whether it passes.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A lock older than this is a dead build, whatever its pid says (pids get reused). */
export const STALE_MS = 30 * 60_000;
/** Longest a build waits for another — inside the Stop hook's 15-minute timeout, with room for the rest of verify. */
export const WAIT_MS = 8 * 60_000;
/** A lock folder younger than this with no owner file is being created right now, not abandoned. */
export const CREATING_MS = 10_000;
const POLL_MS = 1500;

/** Where the lock for this checkout + build folder lives. Same folder → same lock; case-insensitive, as Windows paths are. */
export function lockPathFor(cwd, distDir, base = tmpdir()) {
  let real = resolve(cwd);
  try {
    real = realpathSync(real);
  } catch {
    /* a folder that can't be resolved still gets a stable key */
  }
  const key = createHash("sha1").update(`${real.toLowerCase()}|${distDir}`).digest("hex").slice(0, 16);
  return join(base, "jarvis-build-locks", `${key}.lock`);
}

/** Is that process still running? EPERM means it exists but isn't ours to signal. */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

export function readOwner(lockDir) {
  try {
    const o = JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8"));
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

function ageOf(lockDir, now) {
  try {
    return now - statSync(lockDir).mtimeMs;
  } catch {
    return Infinity;
  }
}

/** Can an existing lock be taken over? */
export function isStale(owner, now, alive = isAlive, folderAge = Infinity) {
  // No owner file yet: someone is between mkdir and writing it — unless that was long ago.
  if (!owner) return folderAge > CREATING_MS;
  if (typeof owner.pid !== "number" || typeof owner.started !== "number") return true;
  if (now - owner.started > STALE_MS) return true;
  return !alive(owner.pid);
}

/**
 * One attempt at the lock. { ok: true } when it's ours, otherwise who holds it.
 * `me` is { pid, started, what }.
 */
export function tryAcquire(lockDir, me, now = Date.now(), alive = isAlive) {
  mkdirSync(dirname(lockDir), { recursive: true });
  try {
    mkdirSync(lockDir);
  } catch (e) {
    if (e?.code !== "EEXIST") throw e;
    const owner = readOwner(lockDir);
    if (!isStale(owner, now, alive, ageOf(lockDir, now))) return { ok: false, owner };
    // Take it over atomically: only one process can rename the stale folder away.
    const grave = `${lockDir}.stale-${me.pid}-${now}`;
    try {
      renameSync(lockDir, grave);
    } catch {
      return { ok: false, owner: readOwner(lockDir) };
    }
    rmSync(grave, { recursive: true, force: true });
    try {
      mkdirSync(lockDir);
    } catch {
      return { ok: false, owner: readOwner(lockDir) };
    }
  }
  writeFileSync(join(lockDir, "owner.json"), JSON.stringify(me));
  return { ok: true };
}

/** Let go — only of a lock that is still ours. */
export function release(lockDir, pid) {
  const owner = readOwner(lockDir);
  if (owner && owner.pid !== pid) return false;
  rmSync(lockDir, { recursive: true, force: true });
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cmd = process.argv.slice(2);
  if (!cmd.length) {
    process.stderr.write("build-lock: give it the command to run, e.g. `node scripts/build-lock.mjs next build`\n");
    process.exit(2);
  }
  const distDir = process.env.NEXT_DIST_DIR || ".next";
  const lockDir = lockPathFor(process.cwd(), distDir);
  const me = { pid: process.pid, started: Date.now(), what: `${cmd.join(" ")} → ${distDir}` };

  let locked = false;
  try {
    const startWait = Date.now();
    let said = 0;
    for (;;) {
      me.started = Date.now();
      const got = tryAcquire(lockDir, me);
      if (got.ok) {
        locked = true;
        break;
      }
      const waited = Date.now() - startWait;
      if (waited > WAIT_MS) {
        process.stderr.write(
          `\nbuild-lock: another build in this folder (pid ${got.owner?.pid ?? "?"}) has held ${distDir} for over ${Math.round(WAIT_MS / 60_000)} minutes. ` +
            `If nothing is building, delete ${lockDir} and run the build again.\n`,
        );
        process.exit(1);
      }
      if (Date.now() - said > 30_000) {
        said = Date.now();
        const age = got.owner?.started ? Math.round((Date.now() - got.owner.started) / 1000) : "?";
        process.stdout.write(`build-lock: another build is writing ${distDir} here (pid ${got.owner?.pid ?? "?"}, ${age}s in) — waiting for it, not colliding with it.\n`);
      }
      await sleep(POLL_MS);
    }
  } catch (e) {
    // No writable temp folder: build unlocked rather than not at all.
    process.stdout.write(`build-lock: couldn't take the build lock (${e?.code ?? e}); building without it.\n`);
  }

  const done = () => {
    if (locked) {
      locked = false;
      try {
        release(lockDir, process.pid);
      } catch {
        /* a lock left behind is taken over once this pid is gone */
      }
    }
  };
  process.on("exit", done);

  // Windows needs the shell to find `next` (next.cmd on PATH) — but not for a full path, which
  // the shell would split at its spaces (like the Program Files folder).
  const shell = process.platform === "win32" && !cmd[0].includes("/") && !cmd[0].includes(String.fromCharCode(92));
  const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", shell });

  const stop = (sig) => {
    child.kill(sig);
    done();
    process.exit(130);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  child.on("error", (e) => {
    process.stderr.write(`build-lock: couldn't start "${cmd[0]}": ${e.message}\n`);
    done();
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    done();
    process.exit(code ?? (signal ? 1 : 0));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();

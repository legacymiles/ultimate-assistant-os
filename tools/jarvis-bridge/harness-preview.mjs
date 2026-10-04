// ---------------------------------------------------------------------------
// A dev server for a thread's worktree, so its work can be clicked through.
//
// A diff tells you the code changed. It does not tell you whether the thing
// looks good, and for the Redesigner's bake-off — three threads building the
// same app with three different design skills — looking good IS the result. So
// each thread can be served, on its own port, from its own worktree.
//
// Three things here are not obvious and each one was a bug first:
//
//   `child.kill()` is not enough on Windows. `npx next dev` under `shell: true`
//   is cmd.exe → node → next, and killing the shell leaves next alive holding
//   the port. The next run then fails on a port that nothing visible owns.
//   `taskkill /T` kills the tree, which is the only kill that frees the port.
//
//   A server is not ready when the process exists. Next's first compile on a
//   cold worktree is tens of seconds, and framing the port before then shows a
//   connection error that reads as a broken build. So start waits for the port
//   to actually answer, and says "still compiling" rather than lying.
//
//   The port is checked for being FREE first. Next, finding 3311 taken, quietly
//   moves to 3312 — so without this check two lanes race, both "start", and
//   both end up framed at the same build while the other is invisible.
// ---------------------------------------------------------------------------

import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** How long Next gets to answer before start reports it as still compiling. */
const READY_TIMEOUT_MS = 180_000;

/** Is anything listening on this port right now? */
function portFree(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.once("listening", () => probe.close(() => done(true)));
    probe.listen(port, "127.0.0.1");
  });
}

/** Does the server answer yet? Any HTTP reply counts — a 404 is a live Next. */
async function answers(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(4_000),
      redirect: "manual",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill the whole tree.
 *
 * Windows gets taskkill because of the shell layer described above. Everything
 * else gets a process-group kill, which is the same idea spelled differently.
 */
function killTree(pid) {
  if (!pid) return Promise.resolve();
  return new Promise((done) => {
    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => done());
      return;
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone, which is the outcome we wanted.
      }
    }
    done();
  });
}

/**
 * Serve a worktree.
 *
 * Uses the repo's own `scripts/dev-preview.mjs` rather than `next dev` directly,
 * because that script already sets the things a second server must not share:
 * its own NEXT_DIST_DIR (two servers on one `.next` corrupts it), its own data
 * directories, and no app password — so a preview can never write into the real
 * store or hold the sign-in wall up.
 */
export async function startPreview({ cwd, port }) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1024 || p > 65_535) {
    throw Object.assign(new Error(`${port} is not a port a preview can use.`), { status: 400 });
  }
  const script = join(cwd, "scripts", "dev-preview.mjs");
  if (!existsSync(script)) {
    throw Object.assign(
      new Error(`This worktree has no scripts/dev-preview.mjs, so there is nothing to serve it with.`),
      { status: 400 },
    );
  }
  if (!(await portFree(p))) {
    throw Object.assign(
      new Error(`Port ${p} is already in use. Stop whatever holds it, or pick another port.`),
      { status: 409 },
    );
  }

  const child = spawn(process.execPath, [script, String(p), "--no-auth"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  // The tail of the log is the only explanation available when a server dies
  // during its first compile, so a bounded amount of it is kept.
  let log = "";
  const keep = (chunk) => {
    log = `${log}${chunk}`.slice(-8_000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);

  let exited = null;
  child.once("exit", (code) => {
    exited = code ?? 0;
  });

  const handle = { port: p, pid: child.pid, url: `http://127.0.0.1:${p}`, child, log: () => log };

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw Object.assign(
        new Error(`The preview server exited (code ${exited}) before it answered.\n${log.slice(-1_200)}`),
        { status: 500 },
      );
    }
    if (await answers(p)) return { ...publicView(handle), ready: true, handle };
    await new Promise((r) => setTimeout(r, 1_000));
  }
  // Not an error: a big first compile can outlast this and the page can keep
  // waiting. What would be wrong is claiming it is ready.
  return { ...publicView(handle), ready: false, handle };
}

export async function stopPreview(handle) {
  if (!handle) return { ok: true };
  await killTree(handle.pid);
  return { ok: true };
}

/** What a page is told about a preview. Never the child object. */
export function publicView(handle) {
  if (!handle) return null;
  return { port: handle.port, url: handle.url, pid: handle.pid ?? 0 };
}

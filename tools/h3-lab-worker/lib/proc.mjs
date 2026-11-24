import { spawn } from "node:child_process";

/**
 * Run a program, collect stdout (as a Buffer) and stderr (as text). Never
 * throws: a missing binary or a non-zero exit comes back as { ok:false }.
 * No shell, so file names with spaces and quotes pass through untouched.
 */
export function run(bin, args, { timeoutMs = 120_000, cwd, input } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { cwd, windowsHide: true, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ ok: false, code: -1, stdout: Buffer.alloc(0), stderr: String(err?.message ?? err) });
      return;
    }
    const out = [];
    let err = "";
    let done = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          err += `\n[timed out after ${Math.round(timeoutMs / 1000)}s]`;
          child.kill();
        }, timeoutMs)
      : null;
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => {
      // stderr can be huge (ffmpeg per-frame logs); keep the tail that matters.
      err += c.toString();
      if (err.length > 2_000_000) err = err.slice(-1_000_000);
    });
    const finish = (code, extra = "") => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout: Buffer.concat(out), stderr: err + extra });
    };
    child.on("error", (e) => finish(-1, `\n${e.message}`));
    child.on("close", (code) => finish(code ?? -1));
    if (input) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}

/** Run `tasks` (functions returning promises) with at most `limit` in flight. */
export async function pool(tasks, limit = 3) {
  const results = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

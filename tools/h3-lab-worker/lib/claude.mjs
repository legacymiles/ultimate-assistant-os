// Think jobs: a reasoning prompt run through Claude Code headless (`claude -p`).
//
// Only fixed flags go on the command line: on Windows `claude` may be an npm
// .cmd shim run through the shell, which mangles quoted arguments. The prompt
// goes in on stdin. Images arrive as data URLs; they are written as files into
// the job's own folder, which is also the working directory, so the Read tool
// can open them without reaching outside the project it was started in.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { run } from "./proc.mjs";

const DATA_URL = /^data:([\w/+.-]+);base64,(.*)$/s;
const EXT = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** Path of the claude CLI, or null when it is not installed. Prefers a real .exe over an npm .cmd shim. */
export async function findClaude() {
  const r = await run(process.platform === "win32" ? "where" : "which", ["claude"], { timeoutMs: 10_000 });
  if (!r.ok) return null;
  const all = r.stdout.toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return all.find((p) => /\.exe$/i.test(p)) ?? all[0] ?? null;
}

/**
 * How to launch it. A real executable is spawned directly (no shell, no
 * quoting games). A Windows .cmd shim needs the shell, so it gets one command
 * string built only from fixed flags — the prompt never goes on the command line.
 */
function launcher(bin, args) {
  if (!bin || process.platform !== "win32" || /\.exe$/i.test(bin)) return { cmd: bin || "claude", args, shell: false };
  return { cmd: [`"${bin}"`, ...args].join(" "), args: [], shell: true };
}

/** Kill a process tree (on Windows a shell:true child is cmd.exe, not claude). */
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => {});
  } else {
    child.kill("SIGKILL");
  }
}

/**
 * Run one think job. Returns { ok, result } or { ok:false, error }.
 * `dir` is the job's scratch folder (created, and removed afterwards).
 */
export async function runThink({ prompt, images = [], dir, timeoutMs = 10 * 60_000, model = "" }) {
  await fs.mkdir(dir, { recursive: true });
  try {
    const files = [];
    for (const [i, img] of images.entries()) {
      const m = typeof img === "string" ? DATA_URL.exec(img) : null;
      if (!m) continue;
      const file = path.join(dir, `image-${i + 1}.${EXT[m[1].toLowerCase()] ?? "png"}`);
      await fs.writeFile(file, Buffer.from(m[2], "base64"));
      files.push(file);
    }
    const text = files.length
      ? `${prompt}\n\nLook at these image files (open each one with the Read tool, in this order): ${files.join(", ")}`
      : prompt;

    const args = ["-p", "--output-format", "text", "--allowedTools", "Read"];
    if (model && /^[\w.:/-]+$/.test(model)) args.push("--model", model);

    const how = launcher(await findClaude(), args);
    return await new Promise((resolve) => {
      let child;
      try {
        child = spawn(how.cmd, how.args, {
          cwd: dir,
          shell: how.shell,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (err) {
        resolve({ ok: false, error: `Could not start Claude Code: ${err.message}` });
        return;
      }
      let out = "";
      let err = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
      child.stdout.on("data", (c) => (out += c.toString()));
      child.stderr.on("data", (c) => {
        err += c.toString();
        if (err.length > 100_000) err = err.slice(-50_000);
      });
      child.stdin.on("error", () => {});
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ ok: false, error: `Could not start Claude Code: ${e.message}` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) return resolve({ ok: false, error: `Claude Code did not answer within ${Math.round(timeoutMs / 60_000)} minutes.` });
        const result = out.trim();
        if (code !== 0 || !result) {
          return resolve({ ok: false, error: (err.trim() || result || `Claude Code exited with code ${code}`).slice(-1000) });
        }
        resolve({ ok: true, result });
      });
      child.stdin.end(text);
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

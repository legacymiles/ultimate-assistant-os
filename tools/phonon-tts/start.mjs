#!/usr/bin/env node
// Start the local Phonon TTS server, setting its venv up on first run.
//
//   npm run tts:phonon
//
// Keeps the whole thing to one command: no activate step, no pip, no global
// Python packages. `uv` does the work (it is already on this machine); if it
// is missing, the error says so rather than failing somewhere deeper.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";
const venvPython = join(here, ".venv", isWindows ? "Scripts/python.exe" : "bin/python");

function run(cmd, args) {
  const out = spawnSync(cmd, args, { cwd: here, stdio: "inherit", shell: isWindows });
  if (out.error?.code === "ENOENT") {
    console.error(
      `\n[phonon] "${cmd}" is not on PATH. Install it from https://docs.astral.sh/uv/ ` +
        `and run this again.\n`,
    );
    process.exit(1);
  }
  if (out.status !== 0) process.exit(out.status ?? 1);
}

if (!existsSync(venvPython)) {
  console.log("[phonon] first run — creating .venv and installing ptts (~7 MB) ...");
  run("uv", ["venv", "--python", "3.12", ".venv"]);
  run("uv", ["pip", "install", "--python", venvPython, "ptts"]);
}

const server = spawn(venvPython, [join(here, "server.py")], {
  cwd: here,
  stdio: "inherit",
  env: process.env,
});

// Ctrl-C should stop the server, not orphan it behind a dead npm script.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 0));

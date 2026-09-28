// ---------------------------------------------------------------------------
// Fetch and build the local cobalt server.
//
// cobalt (github.com/imputnet/cobalt) is the hub's SECOND link-to-video engine.
// yt-dlp is the first. Keeping both matters because they are independent
// implementations: when a site ships a change, they rarely break on the same
// day, so whichever still works covers the other. Every app that imports from a
// pasted link — Cook Connect, Dance Studio, Smart Shot — goes through
// src/lib/social-import/videoDownload.ts, which already tries cobalt after
// yt-dlp and simply skips it when COBALT_API_URL is unset.
//
// The source is cloned into app/ rather than committed: it is somebody else's
// repository, it updates on its own schedule, and vendoring it would drag a
// second lockfile into this one. app/ and out/ are gitignored; these scripts
// are what is version-controlled.
//
// The public api.cobalt.tools is deliberately NOT an option here. It sits
// behind a Cloudflare Turnstile challenge and its own docs say hosted instances
// are "not intended to be used in other projects without explicit permission",
// so the only honest way to have cobalt is to run it.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "app");
const PORT = process.env.COBALT_PORT || "42030";

/**
 * Two constraints pull in opposite directions on Windows, so each command gets
 * only what it needs:
 *
 * A shell re-splits arguments on whitespace, and this repo lives in a path with
 * a space in it ("claude code files") — the first clone attempt died on its own
 * target directory. So git, whose arguments include that path, gets no shell.
 *
 * But pnpm is a .cmd shim, and since CVE-2024-27980 Node refuses to spawn one
 * without a shell. So pnpm gets a shell. That is safe here only because every
 * argument it is given is a literal written in this file with no spaces in it —
 * the directory travels as `cwd`, which a shell never parses. Do not pass user
 * input through this path.
 */
function run(cmd, args, cwd, label, shell = false) {
  process.stdout.write(`\n› ${label}\n`);
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit", shell });
  if (res.error) throw new Error(`${label} could not start: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${label} failed (exit ${res.status ?? "signal"}).`);
}

function has(cmd, shell = false) {
  return spawnSync(cmd, ["--version"], { stdio: "pipe", shell }).status === 0;
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 18) throw new Error(`cobalt needs Node 18.17 or newer; this is ${process.versions.node}.`);
if (!has("git")) throw new Error("git is not on PATH. Install it from https://git-scm.com and run this again.");
if (!has("pnpm", true)) {
  throw new Error(
    "pnpm is not on PATH. Install it with:  npm install -g pnpm\n" +
    "(cobalt's own build needs it; the hub itself does not.)"
  );
}

if (existsSync(path.join(APP, ".git"))) {
  console.log("Updating the existing clone…");
  run("git", ["fetch", "--depth", "1", "origin", "main"], APP, "git fetch");
  run("git", ["reset", "--hard", "origin/main"], APP, "git reset to origin/main");
} else {
  // A half-finished clone from an interrupted run would make git refuse below.
  if (existsSync(APP)) rmSync(APP, { recursive: true, force: true });
  run("git", ["clone", "--depth", "1", "https://github.com/imputnet/cobalt", APP], HERE, "cloning cobalt");
}

// cobalt pins pnpm 9.6.0 in packageManager. A newer pnpm tries to switch to it,
// fails to find a copy it never installed, and dies with ENOENT before doing any
// work — so tell it to use the pnpm that is actually here.
run(
  "pnpm",
  ["install", "--config.manage-package-manager-versions=false", "--filter", "@imput/cobalt-api"],
  APP,
  "installing cobalt's dependencies",
  true
);

// API_URL is the only variable cobalt requires. It must match what clients call,
// because cobalt signs its own tunnel URLs with it.
const envPath = path.join(APP, "api", ".env");
writeFileSync(envPath, `API_URL=http://localhost:${PORT}/\nAPI_PORT=${PORT}\n`, "utf8");
mkdirSync(path.join(HERE, "out"), { recursive: true });

console.log(`
Installed.

  start it now          tools\\cobalt\\start.cmd
  start it every login  tools\\cobalt\\install-autostart.cmd

Then put this in .env.local so every hub app can reach it:

  COBALT_API_URL=http://localhost:${PORT}/
`);

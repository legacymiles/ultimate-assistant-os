#!/usr/bin/env node
// ---------------------------------------------------------------------------
// setup.mjs — get a machine from nothing to "any link downloads".
//
//   node scripts/setup.mjs            report what is missing and how to fix it
//   node scripts/setup.mjs --install  actually install the Python side
//
// Four pieces, and only the first is strictly required:
//
//   yt-dlp     the engine. ~1,800 sites.
//   curl_cffi  yt-dlp's TLS-fingerprint impersonation. Invisible and
//              load-bearing: without it TikTok and Dailymotion fail outright
//              with errors that read like a site ban.
//   ffmpeg     needed to merge separate video+audio streams (YouTube above
//              720p) and for --audio. Without it those degrade, not break.
//   cobalt     an optional second engine, for the day an extractor breaks.
//              Not installed from here; see references/cobalt.md.
//
// Nothing is installed without --install, because installing into someone's
// Python on sight is rude and this may be running on a machine that is
// deliberately pinned.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const INSTALL = process.argv.includes("--install");

/** Each candidate is a full argv: a pip install may only have the module. */
const PYTHONS = [["python"], ["py"], ["python3"]];
const YTDLP = [
  ...(process.env.YTDLP_PATH ? [[process.env.YTDLP_PATH]] : []),
  ["yt-dlp"],
  ["yt-dlp.exe"],
  ...PYTHONS.map((p) => [...p, "-m", "yt_dlp"]),
];

function tryRun(argv, args, timeout = 60_000) {
  try {
    const res = spawnSync(argv[0], [...argv.slice(1), ...args], { stdio: "pipe", timeout, windowsHide: true });
    return res.status === 0 ? String(res.stdout) : null;
  } catch {
    return null;
  }
}

/** pip drops yt-dlp.exe into a per-user Scripts dir Windows leaves off PATH. */
function scriptDirs() {
  const out = [];
  for (const base of [path.join(homedir(), "AppData/Roaming/Python"), path.join(homedir(), ".local/bin")]) {
    if (!existsSync(base)) continue;
    try {
      for (const entry of readdirSync(base)) {
        const exe = path.join(base, entry, "Scripts", "yt-dlp.exe");
        if (existsSync(exe)) out.push([exe]);
      }
    } catch { /* unreadable, skip */ }
  }
  return out;
}

const lines = [];
const todo = [];
const ok = (label, detail) => lines.push(`  ✓ ${label.padEnd(14)} ${detail}`);
const bad = (label, detail, fix) => {
  lines.push(`  ✗ ${label.padEnd(14)} ${detail}`);
  if (fix) todo.push(fix);
};

// ── python ────────────────────────────────────────────────────────────────
const python = PYTHONS.find((p) => tryRun(p, ["--version"], 30_000));
if (python) ok("python", tryRun(python, ["--version"], 30_000).trim());
else bad("python", "not found", "Install Python 3 from https://python.org (tick 'Add to PATH').");

// ── yt-dlp ────────────────────────────────────────────────────────────────
let ytdlp = null;
for (const argv of [...YTDLP, ...scriptDirs()]) {
  const v = tryRun(argv, ["--version"], 30_000);
  if (v) {
    ytdlp = argv;
    ok("yt-dlp", `${v.trim()}   (${argv.join(" ")})`);
    break;
  }
}
if (!ytdlp) bad("yt-dlp", "not found", `${python ? python.join(" ") : "python"} -m pip install --user "yt-dlp[default,curl-cffi]"`);

// ── impersonation ─────────────────────────────────────────────────────────
if (ytdlp) {
  const targets = tryRun(ytdlp, ["--list-impersonate-targets"], 45_000);
  if (targets && /curl_cffi/.test(targets)) ok("impersonation", "available — TikTok and Dailymotion will work");
  else bad("impersonation", "MISSING — TikTok and Dailymotion will fail with errors that look like a ban",
    `${python ? python.join(" ") : "python"} -m pip install --user "yt-dlp[default,curl-cffi]"`);
}

// ── ffmpeg ────────────────────────────────────────────────────────────────
if (tryRun(["ffmpeg"], ["-version"], 30_000)) ok("ffmpeg", "available");
else bad("ffmpeg", "missing — --audio and merged high-res formats will fail",
  "Install ffmpeg: winget install Gyan.FFmpeg   (or https://ffmpeg.org/download.html)");

// ── cobalt (optional) ─────────────────────────────────────────────────────
const cobalt = process.env.COBALT_API_URL;
if (cobalt) {
  let reachable = false;
  try {
    const res = await fetch(cobalt, { signal: AbortSignal.timeout(5000) });
    reachable = res.ok;
  } catch { /* down */ }
  if (reachable) ok("cobalt", `up at ${cobalt}`);
  else lines.push(`  ~ ${"cobalt".padEnd(14)} configured at ${cobalt} but not answering — start it`);
} else {
  lines.push(`  ~ ${"cobalt".padEnd(14)} not configured (optional second engine — references/cobalt.md)`);
}

console.log(`\nlink-to-video toolchain\n\n${lines.join("\n")}\n`);

if (!todo.length) {
  console.log("Everything required is in place.\n");
  process.exit(0);
}

if (!INSTALL) {
  console.log("To fix:\n");
  for (const t of todo) console.log(`  ${t}`);
  console.log("\nOr re-run with --install to do the Python parts automatically.\n");
  process.exit(1);
}

// ── --install ─────────────────────────────────────────────────────────────
if (!python) {
  console.log("Python itself has to be installed by hand first.\n");
  process.exit(1);
}
console.log('Installing: yt-dlp[default,curl-cffi]\n');
const res = spawnSync(python[0], [...python.slice(1), "-m", "pip", "install", "--user", "--upgrade", "yt-dlp[default,curl-cffi]"], {
  stdio: "inherit",
  windowsHide: true,
});
if (res.status !== 0) {
  console.log("\npip failed. Install it by hand with the command above.\n");
  process.exit(1);
}
console.log("\nDone. Re-run without --install to confirm, and set YTDLP_PATH if yt-dlp still is not found.\n");

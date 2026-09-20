#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Sync the Claude Code setup (~/.claude) into this repo, so one repo holds
// everything: the apps, the skills that build them, and the memory of the work.
//
// ~/.claude stays the live folder Claude Code reads and writes. This only
// mirrors the durable parts into claude-home/ here, so a wipe, a new laptop or
// a bad edit can all be recovered from the same place as the code.
//
//   node scripts/sync-claude-home.mjs             sync (prints what changed)
//   node scripts/sync-claude-home.mjs --dry-run   just report
//   node scripts/sync-claude-home.mjs --commit    sync, then commit claude-home/ only
//
// What is deliberately NOT copied, because ~/.claude holds live credentials:
//   config.json          a live sk-ant-... API key
//   .credentials.json    OAuth tokens
//   projects/**/*.jsonl  conversation transcripts (bulky, and they contain
//                        anything ever pasted into a session)
//   node_modules, work, caches, logs
//
// Anything new appearing in ~/.claude is skipped unless it is under a path
// listed in SOURCES below, so a future file cannot be published by accident.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE = join(homedir(), ".claude");
const DEST = join(REPO, "claude-home");
const DRY = process.argv.includes("--dry-run");
const COMMIT = process.argv.includes("--commit");

// Never copy these, wherever they appear.
const SKIP_DIRS = new Set(["node_modules", "work", ".venv", "__pycache__", ".git", "cache", "dist"]);
const SKIP_FILES = new Set(["config.json", ".credentials.json"]);
const SKIP_EXT = [".jsonl", ".log"];

function shouldSkip(src) {
  const base = src.split(/[\\/]/).pop();
  if (SKIP_DIRS.has(base)) return true;
  if (SKIP_FILES.has(base)) return true;
  if (SKIP_EXT.some((e) => base.endsWith(e))) return true;
  return false;
}

let copied = 0;
function copyTree(from, to) {
  if (!existsSync(from)) return;
  if (shouldSkip(from)) return;
  const st = statSync(from);
  if (st.isDirectory()) {
    if (!DRY) mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) copyTree(join(from, entry), join(to, entry));
  } else {
    if (!DRY) {
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
    }
    copied++;
  }
}

// The allowlist. Only these paths are mirrored.
const SOURCES = [
  { from: join(CLAUDE, "skills"), to: join(DEST, "skills"), label: "skills" },
  { from: join(CLAUDE, "CLAUDE.md"), to: join(DEST, "CLAUDE.md"), label: "global CLAUDE.md" },
  { from: join(CLAUDE, "settings.json"), to: join(DEST, "settings.json"), label: "settings" },
];

// Memory lives per project under projects/<slug>/memory/. Mirror just those.
const projectsDir = join(CLAUDE, "projects");
if (existsSync(projectsDir)) {
  for (const slug of readdirSync(projectsDir)) {
    const mem = join(projectsDir, slug, "memory");
    if (existsSync(mem)) {
      SOURCES.push({ from: mem, to: join(DEST, "memory", slug), label: `memory/${slug}` });
    }
  }
}

// Replace rather than merge, so a skill deleted upstream also disappears here
// instead of lingering as a ghost copy nobody maintains.
if (!DRY && existsSync(DEST)) rmSync(DEST, { recursive: true, force: true });

for (const s of SOURCES) {
  const before = copied;
  copyTree(s.from, s.to);
  console.log(`  ${String(copied - before).padStart(5)} files  ${s.label}`);
}

console.log(`${DRY ? "[dry-run] would copy" : "Copied"} ${copied} files into claude-home/`);

if (COMMIT && !DRY) {
  const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" });
  git("add", "claude-home");
  const staged = git("diff", "--cached", "--name-only").trim();
  if (!staged) {
    console.log("Nothing changed, no commit.");
  } else {
    const n = staged.split("\n").length;
    git("-c", "user.name=You", "-c", "user.email=jackstaxx25@gmail.com",
        "commit", "-m", `Sync Claude setup: ${n} file(s) under claude-home/`);
    console.log(`Committed ${n} file(s). Push with: git push`);
  }
}

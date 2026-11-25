#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Projects Timeline › app edits, from git.
//
// Every commit that touches an app becomes a feature card on that app's
// project in Projects Timeline (src/lib/timeline/feature-log.json). Jarvis's
// Improvements engine reads the same file, so it learns from what was built.
//
//   node scripts/timeline-log.mjs          add commits not logged yet
//   node scripts/timeline-log.mjs --check  exit 1 if anything is missing
//
// Run it after committing app work (Claude Code does this itself — see
// CLAUDE.md). Entries already in the file are never rewritten, so hand edits
// to a title or description stick. Hand-written entries (ids that are not
// commit hashes) are kept as they are.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not `new URL(...).pathname`: on Windows the pathname is
// "/C:/dev/repo/scripts", which path.resolve reads as a rooted path and turns
// into "C:\C:\dev\repo" — a cwd that does not exist, so every git call failed
// with ENOENT as if git itself were missing. `prebuild` passes --quiet-fail,
// which is why the log simply stopped filling instead of breaking a build.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/lib/timeline/feature-log.json");

import { appsTouched } from "./lib/app-folders.mjs";

export { appsTouched };

/** "Jarvis: the thing" → "The thing". Keeps the subject when there is no prefix. */
export function featureTitle(subject) {
  const t = subject.replace(/^[^:]{1,40}:\s+/, "").trim();
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 140);
}

const NOT_FEATURES = /^(merge|revert|wip\b|chore|docs?:|claude\.md|skills?:|readme|bump|format|lint)/i;

function commits() {
  const SEP = "\u001e";
  const raw = execFileSync(
    "git",
    ["log", "--no-merges", `--format=${SEP}%h%x1f%aI%x1f%s%x1f%b%x1f`, "--name-status"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  return raw.split(SEP).filter(Boolean).map((chunk) => {
    const [hash, date, subject, body, rest] = chunk.split("\u001f");
    const lines = (rest ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const files = lines.map((l) => l.split("\t").at(-1));
    const added = lines.filter((l) => l.startsWith("A\t")).map((l) => l.split("\t")[1]);
    return { hash, date, subject: subject.trim(), body: (body ?? "").trim(), files, added };
  });
}

function detailOf(body) {
  const para = body.split(/\n\s*\n/)[0] ?? "";
  return para
    .split("\n")
    .filter((l) => !/^(co-authored-by|claude-session|signed-off-by):/i.test(l.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * In a shallow clone the oldest commit has no parent, so git shows it as
 * adding every file in the repo — which would log it as an edit to every app.
 * Those boundary commits are listed in .git/shallow; skip them.
 */
function shallowBoundary() {
  try {
    const file = execFileSync("git", ["rev-parse", "--git-path", "shallow"], { cwd: ROOT, encoding: "utf8" }).trim();
    return readFileSync(path.resolve(ROOT, file), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function build() {
  let existing = [];
  try { existing = JSON.parse(readFileSync(OUT, "utf8")); } catch { existing = []; }
  const known = new Set(existing.map((e) => e.id));
  const fresh = [];
  const boundary = shallowBoundary();
  for (const c of commits()) {
    if (boundary.some((full) => full.startsWith(c.hash))) continue;
    if (NOT_FEATURES.test(c.subject)) continue;
    // A commit that only records the log is bookkeeping, not an app edit.
    if (c.files.length && c.files.every((f) => f.endsWith("timeline/feature-log.json"))) continue;
    const apps = appsTouched(c.files);
    for (const slug of apps) {
      const id = `${c.hash}:${slug}`;
      if (known.has(id)) continue;
      const createdApp = c.added.some((f) => f === `src/app/apps/${slug}/page.tsx`);
      fresh.push({
        id,
        date: c.date.slice(0, 10),
        slug,
        title: featureTitle(c.subject),
        detail: detailOf(c.body),
        group: createdApp ? "core" : "supporting",
        source: "git",
      });
    }
  }
  const all = [...fresh, ...existing].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { all, added: fresh.length };
}

// On a build host the git history can be missing or shallow. Recording app
// edits must never be the reason a deploy fails, so --quiet-fail logs and
// moves on; whatever history is there still gets added.
let result;
try {
  result = build();
} catch (err) {
  if (process.argv.includes("--quiet-fail")) {
    console.log(`timeline-log: skipped (${err instanceof Error ? err.message.split("\n")[0] : err})`);
    process.exit(0);
  }
  throw err;
}
const { all, added } = result;
if (process.argv.includes("--check")) {
  if (added) {
    console.error(`${added} app edit(s) are not in the timeline yet. Run: node scripts/timeline-log.mjs`);
    process.exit(1);
  }
  console.log("Timeline app edits are up to date.");
} else {
  writeFileSync(OUT, JSON.stringify(all, null, 1) + "\n");
  console.log(`Logged ${added} new app edit(s); ${all.length} in the timeline.`);
}

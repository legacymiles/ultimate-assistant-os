#!/usr/bin/env node
// Split a New Dashboard "All files (one .md)" export back into its files.
//
//   node install-export.mjs <bundle.md> <target-dir> [--skip CLAUDE.md,...] [--dry]
//
// The bundle marks each file with <!-- ===== relative/path.md ===== -->.
// Existing files are backed up to <target>/archives/export-<timestamp>/ before
// being replaced (the AIS-OS rule: never delete, move to archives). Paths that
// try to escape the target dir are refused.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [bundlePath, target, ...rest] = process.argv.slice(2);
if (!bundlePath || !target) {
  console.error("usage: node install-export.mjs <bundle.md> <target-dir> [--skip a,b] [--dry]");
  process.exit(1);
}
const dry = rest.includes("--dry");
const skipAt = rest.indexOf("--skip");
const skip = new Set(skipAt >= 0 ? (rest[skipAt + 1] ?? "").split(",").filter(Boolean) : []);

const text = readFileSync(bundlePath, "utf8");
const re = /<!-- ===== (.+?) ===== -->\n/g;
const marks = [...text.matchAll(re)];
if (!marks.length) {
  console.error("No file markers found — is this a New Dashboard export bundle?");
  process.exit(1);
}

const root = path.resolve(target);
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const backupDir = path.join(root, "archives", `export-${stamp}`);

for (let n = 0; n < marks.length; n++) {
  const rel = marks[n][1].trim();
  const start = marks[n].index + marks[n][0].length;
  const end = n + 1 < marks.length ? marks[n + 1].index : text.length;
  const content = text.slice(start, end).replace(/\n+$/, "\n");
  const dest = path.resolve(root, rel);
  if (!dest.startsWith(root + path.sep)) {
    console.log(`REFUSED  ${rel} (outside target)`);
    continue;
  }
  if (skip.has(rel)) {
    console.log(`skipped  ${rel}`);
    continue;
  }
  const existed = existsSync(dest);
  if (!dry) {
    if (existed) {
      const b = path.join(backupDir, rel);
      mkdirSync(path.dirname(b), { recursive: true });
      copyFileSync(dest, b);
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  console.log(`${existed ? "replaced" : "created "} ${rel}${dry ? " (dry run)" : ""}`);
}
if (!dry && existsSync(backupDir)) console.log(`backups  ${path.relative(root, backupDir)}`);

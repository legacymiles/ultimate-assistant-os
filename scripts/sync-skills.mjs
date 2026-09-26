// Mirror the owner's Claude Code skills into this repo so the hub can show them.
//
//   node scripts/sync-skills.mjs          copy every new/changed file in
//   node scripts/sync-skills.mjs --check  list what would change, write nothing
//   node scripts/sync-skills.mjs --skills-only   SKILL.md only, the old behaviour
//
// Why this exists: the Skills tab in Jarvis reads ~/.claude/skills, which is a
// folder on the owner's PC. Deployed to Vercel there is no such folder, so the
// tab came back empty everywhere except localhost. Committing the skills fixes
// that — without dragging 678 MB of rendered examples, vendored node_modules
// and generated video into git.
//
// What comes across: every `SKILL.md`, plus the prose under `references/` that
// a SKILL.md sends you to. Those files are the other half of a skill — the
// shot-plan-storyboard SKILL.md alone is a table of contents for six of them —
// and while they lived only on this PC they were the one part of the work with
// no backup. The library still displays the SKILL.md; the rest is carried so it
// survives a laptop.
//
// What does NOT come across, and why the folder stays small: references are
// filtered to TEXT extensions (so the 68 PNGs and the font stay behind) and to
// files under MAX_BYTES (so cinematic-ui's 2.4 MB generated design-dna-db.txt
// stays behind). Roughly 3.7 MB of markdown crosses, against 678 MB if this
// copied everything. A skipped file is reported, never silently dropped.
//
// A skill that lives only in the repo (skills/unreal-game-builder) is left
// alone: this copies in, it never deletes. So a reference file deleted upstream
// lingers here until someone removes it by hand.

import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const SOURCE = process.env.CLAUDE_SKILLS_HOME
  ? path.join(process.env.CLAUDE_SKILLS_HOME, "skills")
  : path.join(homedir(), ".claude", "skills");
const DEST = path.join(process.cwd(), "skills");
const check = process.argv.includes("--check");
const skillsOnly = process.argv.includes("--skills-only");

/** Prose and data a SKILL.md can link to. Anything else is a rendered asset. */
const TEXT = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".tsv", ".html", ".css", ".js", ".mjs", ".ts", ".py"]);
const MAX_BYTES = 256 * 1024;

/** Every `<name>/SKILL.md` under the source folder. */
async function skillNames() {
  let entries;
  try {
    entries = await readdir(SOURCE, { withFileTypes: true });
  } catch {
    console.error(`No skills folder at ${SOURCE}.`);
    return [];
  }
  const names = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      await stat(path.join(SOURCE, e.name, "SKILL.md"));
      names.push(e.name);
    } catch {
      // A folder with no SKILL.md is not a skill.
    }
  }
  return names.sort();
}

/**
 * Every file this skill contributes, as paths relative to its own folder:
 * `SKILL.md`, then whatever under `references/` survives the filter.
 * Pushes anything it turns away onto `skipped`, with the reason.
 */
async function filesFor(name, skipped) {
  const out = ["SKILL.md"];
  if (skillsOnly) return out;

  const walk = async (rel) => {
    let entries;
    try {
      entries = await readdir(path.join(SOURCE, name, rel), { withFileTypes: true });
    } catch {
      return; // no references/ — most skills
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!e.isFile()) continue;
      if (!TEXT.has(path.extname(e.name).toLowerCase())) {
        skipped.push(`${name}/${child} — not text`);
        continue;
      }
      const { size } = await stat(path.join(SOURCE, name, child));
      if (size > MAX_BYTES) {
        skipped.push(`${name}/${child} — ${(size / 1024 / 1024).toFixed(1)} MB, over the cap`);
        continue;
      }
      out.push(child);
    }
  };

  await walk("references");
  return out;
}

const names = await skillNames();
const skipped = [];
let added = 0;
let changed = 0;
let same = 0;

for (const name of names) {
  for (const rel of await filesFor(name, skipped)) {
    const from = path.join(SOURCE, name, rel);
    const to = path.join(DEST, name, rel);
    const body = await readFile(from, "utf8");
    let before = null;
    try {
      before = await readFile(to, "utf8");
    } catch {
      /* new */
    }
    if (before === body) {
      same++;
      continue;
    }
    if (before === null) added++;
    else changed++;
    if (check) {
      console.log(`${before === null ? "new    " : "changed"}  ${name}/${rel}`);
      continue;
    }
    await mkdir(path.dirname(to), { recursive: true });
    await writeFile(to, body, "utf8");
  }
}

if (skipped.length) {
  console.log(`\nleft behind (${skipped.length}):`);
  for (const s of skipped) console.log(`  ${s}`);
  console.log("");
}

const verb = check ? "would be" : "";
console.log(
  `${names.length} skills in ${SOURCE}\n` +
    `  ${added} file(s) ${verb} added · ${changed} ${verb} updated · ${same} unchanged\n` +
    (check ? "  (--check: nothing written)" : `  → ${DEST}`),
);

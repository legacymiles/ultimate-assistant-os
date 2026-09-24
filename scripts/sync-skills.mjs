// Mirror the owner's Claude Code skills into this repo so the hub can show them.
//
//   node scripts/sync-skills.mjs          copy every new/changed SKILL.md in
//   node scripts/sync-skills.mjs --check  list what would change, write nothing
//
// Why this exists: the Skills tab in Jarvis reads ~/.claude/skills, which is a
// folder on the owner's PC. Deployed to Vercel there is no such folder, so the
// tab came back empty everywhere except localhost. Committing the skills fixes
// that — and committing ONLY the SKILL.md fixes it without dragging 678 MB of
// rendered examples, vendored node_modules and generated video into git. The
// SKILL.md is exactly what the library displays, so nothing is lost.
//
// A skill that lives only in the repo (skills/unreal-game-builder) is left
// alone: this copies in, it never deletes.

import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const SOURCE = process.env.CLAUDE_SKILLS_HOME
  ? path.join(process.env.CLAUDE_SKILLS_HOME, "skills")
  : path.join(homedir(), ".claude", "skills");
const DEST = path.join(process.cwd(), "skills");
const check = process.argv.includes("--check");

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

const names = await skillNames();
let added = 0;
let changed = 0;
let same = 0;

for (const name of names) {
  const from = path.join(SOURCE, name, "SKILL.md");
  const to = path.join(DEST, name, "SKILL.md");
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
    console.log(`${before === null ? "new    " : "changed"}  ${name}`);
    continue;
  }
  await mkdir(path.dirname(to), { recursive: true });
  await writeFile(to, body, "utf8");
}

const verb = check ? "would be" : "";
console.log(
  `${names.length} skills in ${SOURCE}\n` +
    `  ${added} ${verb} added · ${changed} ${verb} updated · ${same} unchanged\n` +
    (check ? "  (--check: nothing written)" : `  → ${DEST}`),
);

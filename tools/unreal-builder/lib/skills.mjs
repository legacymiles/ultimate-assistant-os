import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Which game-building skills this PC offers. A skill opts in with
// `game-creator: true` in its SKILL.md frontmatter (top level or under
// `metadata:`); `game-creator-default: true` marks the default. The builder
// reports the list to the hub, the app shows it as a drop-down, and each game
// is built with exactly one of them.

export const FALLBACK_SKILL = "unreal-game-builder";

/** The YAML frontmatter block of a SKILL.md, or "". */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ""));
  return m ? m[1] : "";
}

const flag = (fm, key) => new RegExp(`^\\s*${key}\\s*:\\s*(true|yes)\\s*$`, "im").test(fm);

/** {name, description, isDefault} for a game-creator skill, else null. */
export function parseSkill(text, folderName) {
  const fm = frontmatter(text);
  if (!fm || !flag(fm, "game-creator")) return null;
  const name = /^name\s*:\s*(.+)$/m.exec(fm)?.[1]?.trim().replace(/^["']|["']$/g, "") || folderName;
  // description may be a folded block (>- ...) — take its first sentence.
  const d = /^description\s*:\s*(?:[>|]-?\s*\r?\n)?([\s\S]*?)(?:\r?\n\S|$)/m.exec(fm)?.[1] ?? "";
  const description = d.replace(/\s+/g, " ").trim().split(/(?<=\.)\s/)[0].slice(0, 200);
  return { name, description, isDefault: flag(fm, "game-creator-default") };
}

/** Scan skill folders (each <dir>/<skill>/SKILL.md). Later dirs do not override earlier names. */
export async function findGameSkills(dirs) {
  const found = [];
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      let text;
      try {
        text = await readFile(path.join(dir, e.name, "SKILL.md"), "utf8");
      } catch {
        continue;
      }
      const skill = parseSkill(text, e.name);
      if (skill && !found.some((s) => s.name === skill.name)) found.push(skill);
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The report sent with every claim: {skills:[{name, description}], defaultSkill}.
 * Default = BUILDER_DEFAULT_SKILL if offered, else the one marked default, else
 * unreal-game-builder, else the first.
 */
export function skillReport(skills, preferred) {
  const names = skills.map((s) => s.name);
  const defaultSkill =
    (preferred && names.includes(preferred) && preferred) ||
    skills.find((s) => s.isDefault)?.name ||
    (names.includes(FALLBACK_SKILL) ? FALLBACK_SKILL : names[0] ?? null);
  return { skills: skills.map(({ name, description }) => ({ name, description })), defaultSkill };
}

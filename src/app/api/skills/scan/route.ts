import { NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseSkillFrontmatter } from "@/lib/skills/parse";
import type { ScannedSkill } from "@/lib/skills/types";

// Reads files from the machine the server runs on, so it must stay dynamic and
// on the Node runtime. On a deployed (cloud) server there is no ~/.claude, so
// the scan simply returns { available: false } and the client does nothing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Root of the Claude Code config dir. Override with CLAUDE_SKILLS_HOME. */
function claudeHome(): string {
  return process.env.CLAUDE_SKILLS_HOME || path.join(homedir(), ".claude");
}

async function readSkillFile(
  file: string,
  slug: string,
  origin: string,
): Promise<ScannedSkill | null> {
  try {
    const body = await readFile(file, "utf8");
    const parsed = parseSkillFrontmatter(body);
    const title = parsed.title || slug;
    return { slug, origin, title, overview: parsed.overview, body };
  } catch {
    return null;
  }
}

/** The user's own skills: ~/.claude/skills/<name>/SKILL.md */
async function scanPersonal(root: string): Promise<ScannedSkill[]> {
  const dir = path.join(root, "skills");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const results = await Promise.all(
    entries.map((name) =>
      readSkillFile(path.join(dir, name, "SKILL.md"), name, "Personal"),
    ),
  );
  return results.filter((s): s is ScannedSkill => s !== null);
}

/** Installed plugin skills: ~/.claude/plugins/cache/<mp>/<plugin>/<ver>/skills/<name>/SKILL.md */
async function scanPlugins(root: string): Promise<ScannedSkill[]> {
  const cache = path.join(root, "plugins", "cache");
  let rel: string[];
  try {
    rel = await readdir(cache, { recursive: true });
  } catch {
    return [];
  }
  // Keep only canonical, user-facing skills: `<plugin>/<ver>/skills/<name>/SKILL.md`.
  // Skip nested `<name>/upstream/SKILL.md` copies (not directly under skills/) and
  // plugin-internal dev skills under `.claude/skills/`.
  const files = rel
    .map((p) => p.split(/[\\/]/))
    .filter((segs) => {
      const n = segs.length;
      return (
        segs[n - 1] === "SKILL.md" &&
        segs[n - 3] === "skills" &&
        segs[n - 4] !== ".claude"
      );
    });

  const results = await Promise.all(
    files.map((segs) => {
      const plugin = segs[1] ?? "plugin"; // <marketplace>/<plugin>/...
      const name = segs[segs.length - 2];
      return readSkillFile(path.join(cache, ...segs), `${plugin}:${name}`, plugin);
    }),
  );
  return results.filter((s): s is ScannedSkill => s !== null);
}

/**
 * The skills committed into this repo: `skills/<name>/SKILL.md`.
 *
 * This is the only source that survives a deploy. `~/.claude` exists on the
 * owner's PC and nowhere else, so on Vercel the two scans above find nothing
 * and the Skills tab used to come back empty — which is the opposite of what
 * a library is for. `scripts/sync-skills.mjs` mirrors the SKILL.md of every
 * personal skill in here, so what the owner sees in the Toolbox is the same
 * list whether they opened the hub on this machine or on their phone.
 */
async function scanRepo(): Promise<ScannedSkill[]> {
  const dir = path.join(process.cwd(), "skills");
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const results = await Promise.all(
    entries.map((name) => readSkillFile(path.join(dir, name, "SKILL.md"), name, "Personal")),
  );
  return results.filter((s): s is ScannedSkill => s !== null);
}

export async function GET() {
  const root = claudeHome();
  const [personal, plugins, repo] = await Promise.all([
    scanPersonal(root),
    scanPlugins(root),
    scanRepo(),
  ]);

  // The live copy on this PC wins over the committed mirror: a skill edited
  // this morning should read as it is now, not as it was when it was last
  // synced. Plugin skills keep their `<plugin>:<name>` slug and never collide.
  const bySlug = new Map<string, ScannedSkill>();
  for (const s of [...repo, ...personal, ...plugins]) bySlug.set(s.slug, s);
  const skills = [...bySlug.values()].sort((a, b) => a.title.localeCompare(b.title));

  // "available" tells the client whether this server can see any skill files at
  // all. With the repo mirror committed it is true on the deployed hub too.
  return NextResponse.json({ available: skills.length > 0, skills });
}

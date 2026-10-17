import "server-only";

// ---------------------------------------------------------------------------
// The master Claude folder, as context Jarvis always has.
//
// Two halves, for two reasons:
//
//   repoFiles()  — CLAUDE.md and aios/* live in this repository, so they ship
//                  with the deployment and can be read on the live site. They
//                  are small (~14 KB total) and always in the system prompt.
//
//   localFiles() — ~/.claude/projects/<project>/memory/*.md and the owner's
//                  skills exist only on their PC. They are read by the sync
//                  route when Jarvis runs there, uploaded into memory, and are
//                  then reachable from anywhere. Off the PC this returns
//                  nothing rather than failing.
// ---------------------------------------------------------------------------

import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { readSkillDir, validSkillName } from "../skillFormat.mjs";

export interface FolderFile {
  /** Stable id for upserting: the path, repo-relative or home-relative. */
  externalId: string;
  title: string;
  content: string;
  /** ISO mtime when known, else "". */
  modified: string;
}

/** Files that ship with the deployment. Paths are relative to the repo root. */
const REPO_FILES = [
  "CLAUDE.md",
  "aios/README.md",
  "aios/connections.md",
  "aios/context/about-me.md",
  "aios/context/about-business.md",
  "aios/context/priorities.md",
  "aios/context/my-computer.md",
  "aios/decisions/log.md",
];

async function readIfPresent(file: string, externalId: string, title: string): Promise<FolderFile | null> {
  try {
    const [content, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    if (!content.trim()) return null;
    return { externalId, title, content, modified: info.mtime.toISOString() };
  } catch {
    return null;
  }
}

/** CLAUDE.md + aios/*, from the deployed bundle. */
export async function repoFiles(): Promise<FolderFile[]> {
  const root = process.cwd();
  const files = await Promise.all(
    REPO_FILES.map((rel) => readIfPresent(path.join(root, rel), rel, rel)),
  );
  return files.filter((f): f is FolderFile => f !== null);
}

/** Root of the Claude Code config dir. Override with CLAUDE_SKILLS_HOME. */
function claudeHome(): string {
  return process.env.CLAUDE_SKILLS_HOME || path.join(homedir(), ".claude");
}

/**
 * The owner's Claude Code memory files and skills, from the machine the server
 * runs on. Empty off their PC — not an error, just nothing to read.
 */
export async function localFiles(): Promise<FolderFile[]> {
  const out: FolderFile[] = [];
  const root = claudeHome();

  // Every project's memory folder, not just this one: a memory written while
  // working on another project is still something Jarvis should know.
  const projects = path.join(root, "projects");
  try {
    for (const project of await readdir(projects)) {
      const dir = path.join(projects, project, "memory");
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(".md")) continue;
        const rel = `~/.claude/projects/${project}/memory/${name}`;
        const file = await readIfPresent(path.join(dir, name), rel, name.replace(/\.md$/, ""));
        if (file) out.push(file);
      }
    }
  } catch {
    // No ~/.claude on this machine.
  }

  // The owner's own skills: name + description is enough for Jarvis to know
  // what he can ask Claude Code to do. The full body would bury everything else.
  const skills = path.join(root, "skills");
  try {
    for (const name of await readdir(skills)) {
      const file = path.join(skills, name, "SKILL.md");
      const md = await readIfPresent(file, `~/.claude/skills/${name}`, `Skill: ${name}`);
      if (md) out.push({ ...md, content: md.content.slice(0, 1200) });
    }
  } catch {
    // No skills folder.
  }

  return out;
}

/**
 * The owner's skills as FULL records (SKILL.md + text references), for the
 * skill store. localFiles() above keeps a 1200-char summary of each for the
 * chat digest; this is what gets saved, so a scan on the PC writes exactly the
 * same record (and hash) as skill-sync or the connector's save_skill would.
 */
export async function localSkills(): Promise<{ name: string; body: string; files: Record<string, string> }[]> {
  const dir = path.join(claudeHome(), "skills");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: { name: string; body: string; files: Record<string, string> }[] = [];
  for (const name of names) {
    if (!validSkillName(name)) continue;
    const skill = await readSkillDir(path.join(dir, name));
    if (skill) out.push({ name, body: skill.body, files: skill.files });
  }
  return out;
}

/** True when this server can see the owner's Claude folder at all. */
export async function localAvailable(): Promise<boolean> {
  try {
    await stat(claudeHome());
    return true;
  } catch {
    return false;
  }
}

/**
 * The always-loaded digest for the system prompt. Long files are trimmed from
 * the middle, keeping the head (which says what a file is) and the tail (which
 * is the most recent entry in an append-only log).
 */
export function digest(files: FolderFile[], perFile = 2600): string {
  return files
    .map((f) => {
      let body = f.content.trim();
      if (body.length > perFile) {
        const head = body.slice(0, Math.floor(perFile * 0.7));
        const tail = body.slice(-Math.floor(perFile * 0.3));
        body = `${head}\n…[trimmed]…\n${tail}`;
      }
      return `--- ${f.externalId} ---\n${body}`;
    })
    .join("\n\n");
}

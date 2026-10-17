// ---------------------------------------------------------------------------
// What a skill IS, in one place.
//
// A skill is a SKILL.md plus the text files under its references/ folder.
// Three writers store skills in Jarvis — the connector's save_skill (phone,
// claude.ai, any cloud session), scripts/skill-sync.mjs (PC and VPS), and the
// master-folder sync — and one reader lays them back onto disk. If any two of
// them disagreed about which files belong to a skill, or how its hash is
// computed, every sync would see a "change" and rewrite forever.
//
// So this module is plain ESM with no TypeScript: the Next.js server imports it
// (allowJs) and the standalone Node script imports it by relative path. Same
// rules, same hash, by construction.
//
// Server and Node only — it reads the disk. Never import it from a client
// component.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Prose and data a SKILL.md links to. Rendered assets (png, fonts, video) never travel. */
export const SKILL_TEXT_EXT = [".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".tsv", ".html", ".css", ".js", ".mjs", ".ts", ".py"];
/** One reference file larger than this stays on the machine that has it. */
export const SKILL_FILE_MAX = 256 * 1024;
/** A whole skill (body + references) larger than this is refused. */
export const SKILL_TOTAL_MAX = 1_500_000;

/**
 * A skill name becomes a folder name on every machine, so it is held to a
 * strict shape: letters, digits, dot, dash, underscore, 1–64 chars, starting
 * with a letter or digit. No slashes, no "..", nothing a path can escape with.
 */
export function validSkillName(name) {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) && !name.includes("..");
}

/**
 * A reference path is relative to the skill folder, forward slashes, and must
 * live under references/. Every segment is checked, so "references/../../x"
 * and absolute or drive-letter paths can never be written to disk.
 */
export function validRefPath(rel) {
  if (typeof rel !== "string" || !rel.startsWith("references/")) return false;
  if (rel.includes("\\") || rel.includes(":") || rel.includes("\u0000")) return false;
  const segs = rel.split("/");
  if (segs.length < 2 || segs.length > 8) return false;
  for (const s of segs) {
    if (!s || s === "." || s === ".." || !/^[A-Za-z0-9._ -]+$/.test(s)) return false;
  }
  return SKILL_TEXT_EXT.includes(path.posix.extname(rel).toLowerCase());
}

/** Keep only valid, string, size-limited reference files. Keys sorted for stable output. */
export function normalizeFiles(files) {
  const out = {};
  if (!files || typeof files !== "object") return out;
  for (const key of Object.keys(files).sort()) {
    const v = files[key];
    if (!validRefPath(key) || typeof v !== "string") continue;
    if (Buffer.byteLength(v, "utf8") > SKILL_FILE_MAX) continue;
    out[key] = v;
  }
  return out;
}

/** The one hash every writer and reader agrees on. */
export function hashSkill(body, files) {
  const h = createHash("sha256");
  h.update(String(body ?? ""));
  const norm = normalizeFiles(files);
  for (const key of Object.keys(norm)) {
    h.update("\u0000");
    h.update(key);
    h.update("\u0000");
    h.update(norm[key]);
  }
  return h.digest("hex");
}

/** Total stored size, for the SKILL_TOTAL_MAX check. */
export function skillSize(body, files) {
  let n = Buffer.byteLength(String(body ?? ""), "utf8");
  const norm = normalizeFiles(files);
  for (const k of Object.keys(norm)) n += Buffer.byteLength(norm[k], "utf8");
  return n;
}

/** The frontmatter `description:` (inline or a >- / | block), flattened to one line. */
export function skillDescription(body) {
  const fm = String(body ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return "";
  const lines = fm[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^description\s*:/i.test(l));
  if (i < 0) return "";
  const inline = lines[i].replace(/^description\s*:/i, "").trim();
  if (inline && !/^[>|]/.test(inline)) return inline.replace(/^["']|["']$/g, "");
  const out = [];
  for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) out.push(lines[j].trim());
  return out.join(" ");
}

/**
 * Read one skill folder from disk: SKILL.md plus every valid text file under
 * references/. Returns null when there is no SKILL.md. `skipped` collects what
 * was left behind and why, so nothing is dropped silently.
 */
export async function readSkillDir(dir, skipped = []) {
  let body;
  try {
    body = await readFile(path.join(dir, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  const files = {};
  const walk = async (relDir) => {
    let entries;
    try {
      entries = await readdir(path.join(dir, ...relDir.split("/")), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = `${relDir}/${e.name}`;
      if (e.isDirectory()) {
        await walk(rel);
        continue;
      }
      if (!validRefPath(rel)) {
        skipped.push(`${path.basename(dir)}/${rel} (not a text reference)`);
        continue;
      }
      const s = await stat(path.join(dir, ...rel.split("/")));
      if (s.size > SKILL_FILE_MAX) {
        skipped.push(`${path.basename(dir)}/${rel} (${Math.round(s.size / 1024)} KB, over ${SKILL_FILE_MAX / 1024} KB)`);
        continue;
      }
      files[rel] = await readFile(path.join(dir, ...rel.split("/")), "utf8");
    }
  };
  await walk("references");
  const norm = normalizeFiles(files);
  return { body, files: norm, hash: hashSkill(body, norm) };
}

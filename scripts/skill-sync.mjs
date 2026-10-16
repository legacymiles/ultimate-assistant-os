#!/usr/bin/env node
// ---------------------------------------------------------------------------
// skill-sync — one skill library, everywhere.
//
// A skill created in one Claude Code session lives in ~/.claude/skills on that
// one machine. This keeps that folder, the hub repo, and every other machine
// in step, so a skill written on the VPS is active on the PC and shown on the
// deployed Jarvis website without anyone copying files by hand.
//
//   node scripts/skill-sync.mjs push     ~/.claude/skills -> repo, commit, push
//   node scripts/skill-sync.mjs pull     repo -> ~/.claude/skills (git pull first)
//   node scripts/skill-sync.mjs sync     pull, then push (what the Stop hook runs)
//   add --check to any of them to print what would happen and change nothing
//   add --quiet to keep hook output to a single line
//
// Wire it to Claude Code hooks (see docs/skill-sync.md) so it runs itself:
//   SessionStart -> pull  (every new session starts with the latest skills)
//   Stop         -> push  (a skill written this session is committed + deployed)
//
// Safe to run on a schedule or from a hook: with nothing changed it does
// nothing and says so. It only ever ADDS or UPDATES files — it never deletes a
// skill, so a mirror can't wipe the source.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_SKILLS = path.join(REPO, "skills");
const HOME_SKILLS = process.env.CLAUDE_SKILLS_HOME
  ? path.join(process.env.CLAUDE_SKILLS_HOME, "skills")
  : path.join(homedir(), ".claude", "skills");

const args = new Set(process.argv.slice(2));
const mode = [...args].find((a) => !a.startsWith("-")) || "sync";
const CHECK = args.has("--check");
const QUIET = args.has("--quiet");

/** Prose and data a SKILL.md links to. Rendered assets (png, fonts, video) stay behind. */
const TEXT = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".tsv", ".html", ".css", ".js", ".mjs", ".ts", ".py"]);
const MAX_BYTES = 256 * 1024;

const log = (...m) => console.log(...m);
const vlog = (...m) => {
  if (!QUIET) console.log(...m);
};

function git(cwdArgs, { allowFail = false } = {}) {
  const r = spawnSync("git", cwdArgs, { cwd: REPO, encoding: "utf8" });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${cwdArgs.join(" ")} failed: ${(r.stderr || r.stdout || "").trim()}`);
  }
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

/** Every `<name>/SKILL.md` directly under a skills root. */
async function skillNames(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      await stat(path.join(root, e.name, "SKILL.md"));
      names.push(e.name);
    } catch {
      /* a folder with no SKILL.md is not a skill */
    }
  }
  return names.sort();
}

/** Files a skill contributes, relative to its folder: SKILL.md + filtered references/. */
async function filesFor(root, name, skipped) {
  const out = ["SKILL.md"];
  const walk = async (rel) => {
    let entries;
    try {
      entries = await readdir(path.join(root, name, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) {
        await walk(r);
        continue;
      }
      if (!TEXT.has(path.extname(e.name).toLowerCase())) {
        skipped.push(`${name}/${r} (binary/asset)`);
        continue;
      }
      const s = await stat(path.join(root, name, r));
      if (s.size > MAX_BYTES) {
        skipped.push(`${name}/${r} (${(s.size / 1024).toFixed(0)} KB > ${MAX_BYTES / 1024} KB)`);
        continue;
      }
      out.push(r);
    }
  };
  await walk("references");
  return out;
}

/** Copy a file only when the destination is missing or different. Returns true if it wrote. */
async function copyIfChanged(src, dst) {
  const data = await readFile(src);
  try {
    const cur = await readFile(dst);
    if (cur.equals(data)) return false;
  } catch {
    /* missing — write it */
  }
  if (!CHECK) {
    await mkdir(path.dirname(dst), { recursive: true });
    await writeFile(dst, data);
  }
  return true;
}

/** Mirror SKILL.md (+ text references) from one skills root to another. Add/update only. */
async function mirror(fromRoot, toRoot, label) {
  const names = await skillNames(fromRoot);
  if (!names.length) {
    vlog(`${label}: source ${fromRoot} has no skills — nothing to mirror.`);
    return { changed: [], skipped: [] };
  }
  const changed = [];
  const skipped = [];
  for (const name of names) {
    for (const rel of await filesFor(fromRoot, name, skipped)) {
      if (await copyIfChanged(path.join(fromRoot, name, rel), path.join(toRoot, name, rel))) {
        changed.push(`${name}/${rel}`);
      }
    }
  }
  return { changed, skipped };
}

async function doPull() {
  // Get the latest committed skills, then lay them into ~/.claude/skills.
  const up = git(["pull", "--ff-only"], { allowFail: true });
  if (!up.ok) vlog(`pull: git pull skipped (${up.err.split("\n")[0] || "no upstream / not ff"}) — mirroring what's checked out.`);
  const { changed, skipped } = await mirror(REPO_SKILLS, HOME_SKILLS, "pull");
  if (changed.length) log(`${CHECK ? "[check] would update" : "pulled"} ${changed.length} file(s) into ${HOME_SKILLS}:`, changed.slice(0, 8).join(", ") + (changed.length > 8 ? " …" : ""));
  else vlog("pull: local skills already current.");
  if (skipped.length) vlog(`pull: left ${skipped.length} asset/oversize file(s) in the repo.`);
  return changed.length;
}

async function doPush() {
  const { changed, skipped } = await mirror(HOME_SKILLS, REPO_SKILLS, "push");
  if (skipped.length) vlog(`push: left behind ${skipped.length} asset/oversize file(s): ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? " …" : ""}`);
  if (!changed.length) {
    vlog("push: repo mirror already current — nothing to commit.");
    return 0;
  }
  log(`${CHECK ? "[check] would mirror" : "mirrored"} ${changed.length} file(s) into repo skills/:`, changed.slice(0, 8).join(", ") + (changed.length > 8 ? " …" : ""));
  if (CHECK) return changed.length;

  // Commit only the skills folder, so a push never sweeps in unrelated work.
  git(["add", "--", "skills"]);
  const status = git(["status", "--porcelain", "--", "skills"]).out;
  if (!status) {
    vlog("push: nothing staged after add — done.");
    return 0;
  }
  const names = [...new Set(changed.map((c) => c.split("/")[0]))];
  const msg = `skills: sync ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` +${names.length - 6}` : ""}`;
  const author = ["-c", "user.name=skill-sync", "-c", "user.email=skill-sync@local"];
  git([...author, "commit", "-m", msg, "-m", "Auto-committed by scripts/skill-sync.mjs (Stop hook)."]);
  const push = git(["push"], { allowFail: true });
  if (push.ok) log(`pushed: ${msg} — the deployed Jarvis will pick it up on redeploy.`);
  else log(`committed locally but push failed (${push.err.split("\n")[0] || "no upstream"}). Run 'git push' when the remote is reachable.`);
  return changed.length;
}

try {
  if (mode === "pull") await doPull();
  else if (mode === "push") await doPush();
  else if (mode === "sync") {
    await doPull();
    await doPush();
  } else {
    log(`Unknown mode "${mode}". Use: push | pull | sync  [--check] [--quiet]`);
    process.exit(2);
  }
} catch (e) {
  // A hook must never block the session. Report and exit 0.
  console.error(`skill-sync: ${e instanceof Error ? e.message : e}`);
  process.exit(0);
}

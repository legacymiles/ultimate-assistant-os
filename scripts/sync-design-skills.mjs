#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Sync website design skills → Website Redesigner roster, then commit + push.
//
// Scans ~/.claude/skills/*/SKILL.md. Any skill whose description reads like a
// website design skill and isn't in src/lib/redesigner/design-skills.json yet
// is appended (existing entries are never rewritten), and ONLY that JSON is
// committed and pushed — other work in the tree is left alone.
//
// Runs from Claude Code hooks (SessionStart, and PostToolUse after a SKILL.md
// is written). Safe to run any time: a no-op when nothing is new.
//   node scripts/sync-design-skills.mjs            sync + commit + push
//   node scripts/sync-design-skills.mjs --dry-run  just print what it would add
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER = join(REPO, "src/lib/redesigner/design-skills.json");
const SKILLS_DIR = join(homedir(), ".claude/skills");
const DRY = process.argv.includes("--dry-run");

// Skills that talk about websites but aren't a design style to redesign with.
const NOT_DESIGN = new Set([
  "website-redesigner",
  "prompt-architect",
  "gauntlet-loop",
  "social-link-import",
  "ai-os-dashboard",
  // Helpers and non-style skills that happen to mention websites or frontends.
  "dom-clone",
  "output-skill",
  "imagegen-frontend-mobile",
  "higgsfield-models",
  "video-analyzer",
]);

// A website design skill talks about building/designing sites, pages or frontends.
const WEB = /\b(websites?|landing pages?|web ?design|web pages?|web ?apps?|hero sections?|scroll[- ]driven|scrollytelling|portfolio sites?|marketing pages?|frontend|front-end|interfaces?|design systems?|dashboards?|editorial sites?)\b/i;
const DESIGN = /\b(design|build|premium|cinematic|interactive|animat|motion|visual|style|layout|hero|ui)\b/i;

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    if (/^[>|][-+]?$/.test(val.trim())) {
      // Folded / literal block: gather the indented lines that follow.
      const block = [];
      while (i + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[i + 1])) block.push(lines[++i].trim());
      val = block.join(" ").trim();
    }
    out[key] = val.replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

/** First sentence (or two short ones) of a skill description, capped. */
function summarize(desc) {
  const sentences = desc.split(/(?<=[.!?])\s+/);
  let s = sentences[0] ?? desc;
  if (s.length < 80 && sentences[1]) s += " " + sentences[1];
  return s.length > 240 ? s.slice(0, 237).trimEnd() + "…" : s;
}

const roster = JSON.parse(readFileSync(ROSTER, "utf8"));
const have = new Set(roster.map((s) => s.name));
const added = [];

if (existsSync(SKILLS_DIR)) {
  for (const dir of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = join(SKILLS_DIR, dir.name, "SKILL.md");
    if (!existsSync(file)) continue;
    const fm = frontmatter(readFileSync(file, "utf8"));
    // The folder name is what Claude Code's Skill tool invokes (taste-skill's
    // frontmatter says "design-taste-frontend", but the skill is "taste-skill").
    const name = dir.name;
    const desc = fm.description || "";
    if (have.has(name) || have.has(fm.name) || NOT_DESIGN.has(name)) continue;
    if (!(WEB.test(desc) && DESIGN.test(desc))) continue;
    const entry = { name, description: summarize(desc) };
    roster.push(entry);
    have.add(name);
    added.push(entry);
  }
}

if (!added.length) {
  if (DRY) console.log("sync-design-skills: nothing new.");
  process.exit(0);
}

console.log(`sync-design-skills: adding ${added.map((a) => a.name).join(", ")} to the Website Redesigner.`);
if (DRY) process.exit(0);

writeFileSync(ROSTER, JSON.stringify(roster, null, 2) + "\n");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const path = relative(REPO, ROSTER).replace(/\\/g, "/");
const message =
  `Website Redesigner: add design skill${added.length > 1 ? "s" : ""} ${added.map((a) => a.name).join(", ")}\n\n` +
  "Auto-added by scripts/sync-design-skills.mjs after the skill was installed in ~/.claude/skills.";

// The live site deploys from main, so the roster always lands on origin/main,
// whatever branch is checked out. (Earlier runs committed onto feature branches
// with no upstream and the push failed silently, so the live Redesigner never
// saw the new skills.) A throwaway worktree on origin/main takes only the
// roster; the working tree and the checked-out branch are never touched.
const wt = join(REPO, ".git", "sync-design-skills-wt");
try {
  git(REPO, "fetch", "-q", "origin", "main");
  try { git(REPO, "worktree", "remove", "--force", wt); } catch { /* not there */ }
  git(REPO, "worktree", "add", "-q", "--detach", wt, "origin/main");
  try {
    const live = JSON.parse(readFileSync(join(wt, path), "utf8"));
    const liveNames = new Set(live.map((s) => s.name));
    for (const entry of added) if (!liveNames.has(entry.name)) live.push(entry);
    writeFileSync(join(wt, path), JSON.stringify(live, null, 2) + "\n");
    git(wt, "add", path);
    if (git(wt, "status", "--porcelain")) {
      git(wt, "commit", "-q", "-m", message);
      git(wt, "push", "-q", "origin", "HEAD:main");
      console.log("sync-design-skills: committed and pushed to main.");
    } else {
      console.log("sync-design-skills: main already has these skills.");
    }
  } finally {
    git(REPO, "worktree", "remove", "--force", wt);
  }
} catch (e) {
  console.error("sync-design-skills: saved the roster locally but could not push to main —", String(e.stderr || e.message).trim());
}

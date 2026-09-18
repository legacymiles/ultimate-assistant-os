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
]);

// A website design skill talks about building/designing sites or landing pages.
const WEB = /\b(websites?|landing pages?|web ?design|web pages?|hero sections?|scroll[- ]driven|scrollytelling|portfolio sites?|marketing pages?)\b/i;
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
    const name = fm.name || dir.name;
    const desc = fm.description || "";
    if (have.has(name) || NOT_DESIGN.has(name)) continue;
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

const git = (...args) => execFileSync("git", args, { cwd: REPO, stdio: "pipe" }).toString().trim();
const path = relative(REPO, ROSTER).replace(/\\/g, "/");
try {
  // `commit -- <path>` commits only the roster, even if other files are staged.
  git("commit", "-m",
    `Website Redesigner: add design skill${added.length > 1 ? "s" : ""} ${added.map((a) => a.name).join(", ")}\n\n` +
    "Auto-added by scripts/sync-design-skills.mjs after the skill was installed in ~/.claude/skills.",
    "--", path);
  try {
    git("push", "-q");
  } catch {
    // Behind the remote: catch up, then push again. (Only here, because an
    // autostash can drop the staged half of other in-progress work.)
    git("pull", "--rebase", "--autostash", "-q");
    git("push", "-q");
  }
  console.log("sync-design-skills: committed and pushed.");
} catch (e) {
  console.error("sync-design-skills: saved the roster but git failed —", String(e.stderr || e.message).trim());
}

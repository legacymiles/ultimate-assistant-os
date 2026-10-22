#!/usr/bin/env node
// ---------------------------------------------------------------------------
// skill-sync — every skill, on every device, from one home: Jarvis.
//
// Skills are stored in Jarvis (the same store the jarvis-memory connector's
// save_skill writes from a phone or claude.ai). This script keeps a machine's
// ~/.claude/skills in step with that store, over HTTPS with your token — no
// git, no repo access needed, so it works the same on a desktop and a VPS,
// Windows or Linux.
//
//   node scripts/skill-sync.mjs install               one-time setup for this machine
//                                                     (finds the token in your jarvis-memory
//                                                     connector; or pass --token <T>)
//   node scripts/skill-sync.mjs pull                  Jarvis -> ~/.claude/skills
//   node scripts/skill-sync.mjs push                  ~/.claude/skills -> Jarvis
//   node scripts/skill-sync.mjs sync                  push, then pull
//     --check     say what would happen, change nothing
//     --quiet     one line per run (for hooks)
//     --git       ALSO mirror into the hub repo's skills/ and commit + push (optional)
//
//   node scripts/skill-sync.mjs usage                 (hook) count one skill call — reads the hook JSON on stdin
//   node scripts/skill-sync.mjs usage-backfill        count this machine's past skill calls once
//     --force     count them again even if this machine already did
//
// The hooks `install` writes:  SessionStart -> pull,  Stop -> push,
//   PostToolUse(Skill) + UserPromptSubmit -> usage (Skills Library › Usage).
// `pull` adds the usage hooks on a machine set up before they existed, and
// starts the one-time backfill in the background, so nobody re-runs setup.
//
// Safety:
//  - It never deletes a skill anywhere. Updating a skill makes its folder match
//    Jarvis's version (a text reference the new version dropped is removed);
//    images and other assets in the folder are never touched.
//  - A local edit that hasn't been pushed yet is never overwritten by a pull,
//    and a newer remote version is never overwritten by a push: whichever side
//    changed more recently wins, the other side waits for the next sync.
//  - Names and reference paths are validated before anything touches the disk.
//  - A hook can never block a session: on any error it reports and exits 0.
// ---------------------------------------------------------------------------

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSkillDir, validRefPath, validSkillName, normalizeFiles, hashSkill } from "../src/lib/jarvis/skillFormat.mjs";

const SELF = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(SELF), "..");
const REPO_SKILLS = path.join(REPO, "skills");
const CLAUDE_HOME = process.env.CLAUDE_SKILLS_HOME || path.join(homedir(), ".claude");
const HOME_SKILLS = path.join(CLAUDE_HOME, "skills");
const CONFIG_FILE = path.join(CLAUDE_HOME, "jarvis-skill-sync.json");
/** What this machine last pushed/pulled, so an idle Stop hook makes no network call. */
const STATE_FILE = path.join(CLAUDE_HOME, "jarvis-skill-sync.state.json");
const DEFAULT_HUB = "https://ultimate-assistant-os.vercel.app";

const argv = process.argv.slice(2);
const args = new Set(argv);
const VALUE_FLAGS = new Set(["--token", "--hub"]);
const mode = argv.find((a, i) => !a.startsWith("-") && !VALUE_FLAGS.has(argv[i - 1])) || "sync";
const CHECK = args.has("--check");
const QUIET = args.has("--quiet");
const GIT = args.has("--git");
const FORCE = args.has("--force");

const log = (...m) => console.log(...m);
const vlog = (...m) => {
  if (!QUIET) console.log(...m);
};

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
const CONFIG = readJson(CONFIG_FILE);
const flagValue = (name) => {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[i + 1] : "";
};

/**
 * The token this machine already has. Anyone who set up "Same memory
 * everywhere" ran `claude mcp add … jarvis-memory <hub>/api/jarvis/memory/mcp
 * --header "Authorization: Bearer <token>"`, and Claude Code keeps that in
 * ~/.claude.json (user and per-project scopes) or a project's .mcp.json. So
 * setup reads it from there — the same command works on every machine and
 * nobody has to copy a secret around. Any server entry whose URL is the Jarvis
 * memory endpoint counts; the token comes from its Bearer header or its ?k=.
 */
function findConnector() {
  const files = [
    path.join(homedir(), ".claude.json"),
    process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : "",
    path.join(REPO, ".mcp.json"),
  ].filter(Boolean);
  for (const file of files) {
    const json = readJson(file);
    const stack = [json];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (typeof node.url === "string" && node.url.includes("/api/jarvis/memory/mcp")) {
        let token = "";
        const auth = node.headers?.Authorization ?? node.headers?.authorization;
        if (typeof auth === "string") token = auth.replace(/^Bearer\s+/i, "").trim();
        if (!token) {
          try {
            token = new URL(node.url).searchParams.get("k") ?? "";
          } catch {
            /* not a URL */
          }
        }
        if (token) {
          let hub = "";
          try {
            hub = new URL(node.url).origin;
          } catch {
            /* keep default */
          }
          return { token, hub, file };
        }
      }
      for (const v of Object.values(node)) if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

/** The hub's origin. Older configs stored the full memory URL; derive from it. */
function hubFrom(cfg) {
  const raw = process.env.JARVIS_HUB_URL || cfg.hub || (cfg.memoryUrl ? String(cfg.memoryUrl).replace(/\/api\/.*$/, "") : "") || DEFAULT_HUB;
  return raw.replace(/\/+$/, "");
}
const EXPLICIT_TOKEN = flagValue("--token") || process.env.JARVIS_MCP_TOKEN || CONFIG.token || "";
const FOUND = EXPLICIT_TOKEN ? null : findConnector();
const TOKEN = EXPLICIT_TOKEN || FOUND?.token || "";
const HUB = (
  flagValue("--hub") ||
  process.env.JARVIS_HUB_URL ||
  CONFIG.hub ||
  (CONFIG.memoryUrl ? String(CONFIG.memoryUrl).replace(/\/api\/.*$/, "") : "") ||
  FOUND?.hub ||
  hubFrom(CONFIG)
).replace(/\/+$/, "");

// ---- HTTP ------------------------------------------------------------------

const VERSION = "3";
const OS_LABEL = { win32: "Windows", darwin: "macOS", linux: "Linux" }[process.platform] || process.platform;

async function api(pathname, init = {}) {
  // These let Jarvis show this computer as set up (name, OS, last sync) — see
  // src/lib/jarvis/server/syncStatus.ts. Nothing else about the machine is sent.
  const id = {
    "x-skill-sync-host": hostname(),
    "x-skill-sync-os": OS_LABEL,
    "x-skill-sync-version": VERSION,
    "x-skill-sync-action": mode === "setup" ? "install" : mode,
    "x-skill-sync-count": String((await localNames()).length),
  };
  const res = await fetch(`${HUB}${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...id, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${pathname} -> HTTP ${res.status}${body?.error ? `: ${body.error}` : ""}`);
  return body;
}

// ---- local disk --------------------------------------------------------------

async function localNames() {
  try {
    const entries = await readdir(HOME_SKILLS, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && validSkillName(e.name)).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/** Newest mtime across a skill's SKILL.md and references (ms), 0 if missing. */
async function localMtime(name) {
  let newest = 0;
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else newest = Math.max(newest, (await stat(p)).mtimeMs);
    }
  };
  await walk(path.join(HOME_SKILLS, name));
  return newest;
}

/**
 * Write one skill to ~/.claude/skills/<name> so the folder matches Jarvis's
 * version exactly: SKILL.md, every reference it has, and no text reference it
 * dropped. Only managed files (SKILL.md and text references) are touched —
 * images and other assets in the folder stay. Any path that would land
 * outside the skill's own folder is refused.
 */
async function writeLocal(name, body, files) {
  if (!validSkillName(name)) throw new Error(`refused unsafe skill name "${name}"`);
  const root = path.resolve(HOME_SKILLS, name);
  const inside = (p) => p === root || p.startsWith(root + path.sep);
  const keep = normalizeFiles(files);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "SKILL.md"), body);
  for (const [rel, text] of Object.entries(keep)) {
    if (!validRefPath(rel)) continue;
    const target = path.resolve(root, ...rel.split("/"));
    if (!inside(target)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  // Text references the new version no longer has.
  const existing = await readSkillDir(root);
  for (const rel of Object.keys(existing?.files ?? {})) {
    if (rel in keep) continue;
    const target = path.resolve(root, ...rel.split("/"));
    if (inside(target)) await unlink(target).catch(() => {});
  }
}

// ---- state (what was last synced, per skill) ----------------------------------

const STATE = readJson(STATE_FILE);
STATE.synced ??= {};
async function saveState() {
  if (CHECK) return;
  await mkdir(CLAUDE_HOME, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(STATE, null, 2) + "\n");
}

// ---- push / pull ---------------------------------------------------------------

async function doPush() {
  if (!TOKEN) {
    vlog("push: no token on this machine — run `npm run skills:setup -- --token <TOKEN>` (Jarvis › Memory › Skills everywhere).");
    if (GIT) await gitMirror();
    return;
  }
  // Cheap path: nothing changed locally since the last sync -> no network at all.
  const local = [];
  const skipped = [];
  for (const name of await localNames()) {
    const sk = await readSkillDir(path.join(HOME_SKILLS, name), skipped);
    if (sk) local.push({ name, ...sk });
  }
  const dirty = local.filter((s) => STATE.synced[s.name] !== s.hash);
  if (!dirty.length) {
    vlog("push: no local skill changed since the last sync.");
    if (GIT) await gitMirror();
    return;
  }

  const { skills: remote = [] } = (await api("/api/jarvis/skills")) ?? {};
  const byName = new Map(remote.map((r) => [r.name, r]));
  let pushed = 0;
  const held = [];
  for (const s of dirty) {
    const r = byName.get(s.name);
    if (r && r.hash === s.hash) {
      STATE.synced[s.name] = s.hash; // already identical in Jarvis
      continue;
    }
    // A newer remote copy that this machine hasn't pulled yet wins; don't clobber it.
    if (r && r.complete && STATE.synced[s.name] && STATE.synced[s.name] !== r.hash && Date.parse(r.updatedAt) > (await localMtime(s.name))) {
      held.push(s.name);
      continue;
    }
    if (CHECK) {
      log(`[check] would push ${s.name}`);
      continue;
    }
    await api("/api/jarvis/skills", {
      method: "POST",
      body: JSON.stringify({ name: s.name, body: s.body, files: s.files, origin: `skill-sync:${hostLabel()}` }),
    });
    STATE.synced[s.name] = s.hash;
    pushed++;
  }
  await saveState();
  if (pushed) log(`push: saved ${pushed} skill(s) to Jarvis — on the website now, and on your other machines at their next session.`);
  if (held.length) log(`push: held ${held.join(", ")} — Jarvis has a newer version from another device; it will be pulled first.`);
  if (skipped.length) vlog(`push: left on this machine (assets / oversize): ${skipped.slice(0, 4).join(", ")}${skipped.length > 4 ? " …" : ""}`);
  if (GIT) await gitMirror();
}

async function doPull() {
  if (!TOKEN) {
    vlog("pull: no token on this machine — falling back to the repo's committed skills/.");
    return pullFromRepo();
  }
  const { skills: remote = [] } = (await api("/api/jarvis/skills")) ?? {};
  let pulled = 0;
  const kept = [];
  for (const r of remote) {
    if (!r.complete || !validSkillName(r.name)) continue; // summary-only rows never overwrite a real file
    const localDir = path.join(HOME_SKILLS, r.name);
    const local = await readSkillDir(localDir);
    if (local && local.hash === r.hash) {
      STATE.synced[r.name] = r.hash;
      continue;
    }
    // A local edit made after the last sync and newer than Jarvis's copy: keep it, push will send it.
    if (local && STATE.synced[r.name] !== local.hash && (await localMtime(r.name)) > Date.parse(r.updatedAt)) {
      kept.push(r.name);
      continue;
    }
    if (CHECK) {
      log(`[check] would pull ${r.name}${local ? " (update)" : " (new)"}`);
      continue;
    }
    const { skill } = await api(`/api/jarvis/skills?name=${encodeURIComponent(r.name)}`);
    if (!skill?.body) continue;
    await writeLocal(r.name, skill.body, skill.files);
    STATE.synced[r.name] = hashSkill(skill.body, skill.files);
    pulled++;
  }
  await saveState();
  if (pulled) log(`pull: ${pulled} skill(s) from Jarvis are now in ${HOME_SKILLS}.`);
  else vlog("pull: this machine already has every skill in Jarvis.");
  if (kept.length) log(`pull: kept your newer local edit of ${kept.join(", ")} — it will be pushed.`);
  await ensureUsageTracking();
}

function hostLabel() {
  return (hostname() || process.env.COMPUTERNAME || "machine").toLowerCase();
}

// ---- optional: the repo mirror (old behaviour, still handy for backups) ---------

function git(gargs, { allowFail = false } = {}) {
  const r = spawnSync("git", gargs, { cwd: REPO, encoding: "utf8" });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${gargs.join(" ")} failed: ${(r.stderr || r.stdout || "").trim()}`);
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

async function copyTree(fromRoot, toRoot) {
  const changed = [];
  let names = [];
  try {
    names = (await readdir(fromRoot, { withFileTypes: true })).filter((e) => e.isDirectory() && validSkillName(e.name)).map((e) => e.name);
  } catch {
    return changed;
  }
  for (const name of names) {
    const sk = await readSkillDir(path.join(fromRoot, name));
    if (!sk) continue;
    const existing = await readSkillDir(path.join(toRoot, name));
    if (existing && existing.hash === sk.hash) continue;
    changed.push(name);
    if (CHECK) continue;
    const root = path.resolve(toRoot, name);
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "SKILL.md"), sk.body);
    for (const [rel, text] of Object.entries(sk.files)) {
      const target = path.resolve(root, ...rel.split("/"));
      if (!target.startsWith(root + path.sep)) continue;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text);
    }
  }
  return changed;
}

async function gitMirror() {
  const changed = await copyTree(HOME_SKILLS, REPO_SKILLS);
  if (!changed.length) return vlog("git: repo mirror already current.");
  if (CHECK) return log(`[check] would commit ${changed.length} skill(s) to the repo mirror`);
  git(["add", "--", "skills"]);
  if (!git(["status", "--porcelain", "--", "skills"]).out) return;
  const msg = `skills: sync ${changed.slice(0, 6).join(", ")}${changed.length > 6 ? ` +${changed.length - 6}` : ""}`;
  git(["-c", "user.name=skill-sync", "-c", "user.email=skill-sync@local", "commit", "-m", msg]);
  const p = git(["push"], { allowFail: true });
  log(p.ok ? `git: ${msg}` : `git: committed, push failed (${p.err.split("\n")[0]})`);
}

async function pullFromRepo() {
  git(["pull", "--ff-only"], { allowFail: true });
  const changed = await copyTree(REPO_SKILLS, HOME_SKILLS);
  if (changed.length) log(`${CHECK ? "[check] would pull" : "pulled"} ${changed.length} skill(s) from the repo mirror.`);
  else vlog("pull: repo mirror has nothing new.");
}

/**
 * First-run adoption: skills committed in the hub repo's skills/ folder that
 * Jarvis doesn't have yet are uploaded once, so everything the owner already
 * had lands in the one home. Skills Jarvis already has are never overwritten.
 */
async function adoptRepoSkills() {
  if (!TOKEN) return;
  let names = [];
  try {
    names = (await readdir(REPO_SKILLS, { withFileTypes: true })).filter((e) => e.isDirectory() && validSkillName(e.name)).map((e) => e.name);
  } catch {
    return;
  }
  const { skills: remote = [] } = (await api("/api/jarvis/skills")) ?? {};
  const have = new Set(remote.filter((r) => r.complete).map((r) => r.name));
  let adopted = 0;
  for (const name of names) {
    if (have.has(name)) continue;
    const sk = await readSkillDir(path.join(REPO_SKILLS, name));
    if (!sk) continue;
    if (CHECK) {
      log(`[check] would add ${name} from the repo`);
      continue;
    }
    try {
      await api("/api/jarvis/skills", { method: "POST", body: JSON.stringify({ name, body: sk.body, files: sk.files, origin: "hub-repo" }) });
      adopted++;
    } catch (e) {
      vlog(`adopt: ${name} skipped (${e instanceof Error ? e.message : e})`);
    }
  }
  if (adopted) log(`Added ${adopted} skill(s) from the hub repo to Jarvis.`);
}

// ---- skill usage (Skills Library › Usage) ------------------------------------------
//
// Every time Claude Code runs a skill on this machine, one tiny POST tells
// Jarvis "<skill> was called". Only the skill's name, a time and an id leave
// the machine — never the prompt or anything in the session.

const isUsageHook = (h) => typeof h?.command === "string" && h.command.includes("skill-sync.mjs") && /\susage(\s|$)/.test(h.command);

/** Put (or replace) the two usage hooks in a settings object. */
function addUsageHooks(settings, command) {
  settings.hooks ??= {};
  const strip = (arr) => (Array.isArray(arr) ? arr : []).filter((g) => !(g?.hooks ?? []).some(isUsageHook));
  // async: a skill call never waits on the network.
  const hook = { type: "command", command, async: true, timeout: 20 };
  settings.hooks.PostToolUse = [...strip(settings.hooks.PostToolUse), { matcher: "Skill", hooks: [hook] }];
  settings.hooks.UserPromptSubmit = [...strip(settings.hooks.UserPromptSubmit), { hooks: [hook] }];
}

/**
 * Run from every `pull` (the SessionStart hook): on a machine set up before
 * usage counting existed, add its hooks next to the pull/push ones, and count
 * this machine's past calls once in the background. Never blocks the session.
 */
async function ensureUsageTracking() {
  if (CHECK || !TOKEN) return;
  try {
    const settingsFile = path.join(CLAUDE_HOME, "settings.json");
    const settings = readJson(settingsFile);
    const groups = Object.values(settings.hooks ?? {}).flat();
    const pullHook = groups.flatMap((g) => g?.hooks ?? []).find((h) => typeof h?.command === "string" && h.command.includes("skill-sync.mjs") && /\spull(\s|$)/.test(h.command));
    const hasUsage = groups.some((g) => (g?.hooks ?? []).some(isUsageHook));
    if (pullHook && !hasUsage) {
      addUsageHooks(settings, pullHook.command.replace(/\spull(\s|$)/, " usage$1"));
      await writeFile(settingsFile, JSON.stringify(settings, null, 2) + "\n");
      vlog("usage: skill calls on this machine are now counted in Jarvis › Skills.");
    }
  } catch (e) {
    vlog(`usage: could not add the hooks (${e instanceof Error ? e.message : e})`);
  }
  // `install` runs the backfill itself, in the foreground, right after this.
  if (mode !== "install" && mode !== "setup" && !readJson(STATE_FILE).usageBackfilled) {
    try {
      const child = spawn(process.execPath, [SELF, "usage-backfill", "--quiet"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        // Same token and hub this run used, however it found them.
        env: { ...process.env, JARVIS_MCP_TOKEN: TOKEN, JARVIS_HUB_URL: HUB },
      });
      child.unref();
    } catch {
      /* next session tries again */
    }
  }
}

const BUILTIN_COMMANDS = new Set([
  "add-dir", "agents", "bug", "clear", "compact", "config", "context", "cost", "doctor", "exit", "export", "help",
  "hooks", "ide", "init", "install-github-app", "login", "logout", "mcp", "memory", "model", "permissions",
  "plugin", "plugins", "pr-comments", "privacy-settings", "release-notes", "resume", "review", "rewind", "status",
  "statusline", "terminal-setup", "todos", "upgrade", "usage", "vim", "skills", "output-style", "security-review",
]);

let pluginSkillNames = null;
/** Names of the installed plugin skills (`<plugin>/<ver>/skills/<name>/SKILL.md`). */
async function pluginSkills() {
  if (pluginSkillNames) return pluginSkillNames;
  pluginSkillNames = new Set();
  try {
    const rel = await readdir(path.join(CLAUDE_HOME, "plugins", "cache"), { recursive: true });
    for (const p of rel) {
      const segs = String(p).split(/[\\/]/);
      const n = segs.length;
      if (segs[n - 1] === "SKILL.md" && segs[n - 3] === "skills") pluginSkillNames.add(segs[n - 2].toLowerCase());
    }
  } catch {
    /* no plugins */
  }
  return pluginSkillNames;
}

/** Whether a typed /command is a skill (not /clear, /model, a plain command…). */
async function isSkillCommand(name, cwd) {
  const n = String(name || "").toLowerCase();
  if (!n || BUILTIN_COMMANDS.has(n)) return false;
  if (n.includes(":")) return true; // plugin:skill
  if (existsSync(path.join(HOME_SKILLS, n, "SKILL.md"))) return true;
  if (cwd && existsSync(path.join(cwd, ".claude", "skills", n, "SKILL.md"))) return true;
  return (await pluginSkills()).has(n);
}

/** The skill a Skill tool call ran. */
const skillOfTool = (input) => String(input?.skill ?? input?.command ?? input?.name ?? "").trim().replace(/^\//, "");

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let out = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) out += chunk;
  return out;
}

/** The hook: one skill call -> Jarvis. Prints nothing (a prompt hook's output would reach Claude). */
async function doUsage() {
  if (!TOKEN) return;
  let input = {};
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch {
    return;
  }
  let skill = "";
  let id = "";
  if (input.tool_name === "Skill") {
    skill = skillOfTool(input.tool_input);
    id = String(input.tool_use_id ?? "");
  } else if (typeof input.prompt === "string") {
    const m = /^\s*\/([\w.:-]+)/.exec(input.prompt);
    if (m && (await isSkillCommand(m[1], input.cwd))) skill = m[1];
  }
  if (!skill) return;
  await api("/api/jarvis/skills/usage", {
    method: "POST",
    body: JSON.stringify({ events: [{ skill, source: "claude-code", at: new Date().toISOString(), ...(id ? { id } : {}) }] }),
  });
}

/** Every *.jsonl session transcript under ~/.claude/projects. */
async function transcriptFiles() {
  const root = path.join(CLAUDE_HOME, "projects");
  try {
    const rel = await readdir(root, { recursive: true });
    return rel.filter((p) => String(p).endsWith(".jsonl")).map((p) => path.join(root, String(p)));
  } catch {
    return [];
  }
}

/**
 * Count this machine's past skill calls from its session transcripts, once.
 * Only the totals per skill name are sent. Resumed sessions repeat earlier
 * messages, so every call is counted once by its id.
 */
async function doBackfill() {
  if (!TOKEN) return vlog("usage-backfill: no token on this machine.");
  if (readJson(STATE_FILE).usageBackfilled && !FORCE) return vlog("usage-backfill: this machine was already counted.");
  const seen = new Set();
  const counts = {};
  const add = (name, at) => {
    const k = String(name || "").trim().replace(/^\//, "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/.test(k)) return;
    const t = typeof at === "string" && Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : "";
    const c = (counts[k] ??= { count: 0, first: t, last: t });
    c.count++;
    if (t && (!c.first || t < c.first)) c.first = t;
    if (t && t > c.last) c.last = t;
  };
  for (const file of await transcriptFiles()) {
    const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      const tool = line.includes('"Skill"');
      const cmd = line.includes("<command-name>");
      if (!tool && !cmd) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const content = row?.message?.content;
      if (tool && row.type === "assistant" && Array.isArray(content)) {
        for (const part of content) {
          if (part?.type !== "tool_use" || part.name !== "Skill") continue;
          const key = `t:${part.id ?? ""}`;
          if (part.id && seen.has(key)) continue;
          seen.add(key);
          add(skillOfTool(part.input), row.timestamp);
        }
      }
      if (cmd && row.type === "user") {
        const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p?.text ?? "").join("\n") : "";
        const m = /<command-name>\/?([\w.:-]+)<\/command-name>/.exec(text);
        if (!m) continue;
        const key = `u:${row.uuid ?? ""}`;
        if (row.uuid && seen.has(key)) continue;
        seen.add(key);
        if (await isSkillCommand(m[1], row.cwd)) add(m[1], row.timestamp);
      }
    }
  }
  const total = Object.values(counts).reduce((n, c) => n + c.count, 0);
  if (CHECK) return log(`[check] would count ${total} past skill call(s) across ${Object.keys(counts).length} skill(s).`);
  const r = await api("/api/jarvis/skills/usage", {
    method: "POST",
    body: JSON.stringify({ backfill: { host: hostLabel(), counts }, force: FORCE }),
  });
  // Re-read before writing: a pull may have saved the state file meanwhile.
  const fresh = readJson(STATE_FILE);
  fresh.usageBackfilled = new Date().toISOString();
  await mkdir(CLAUDE_HOME, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(fresh, null, 2) + "\n");
  if (r?.already) vlog("usage-backfill: Jarvis already had this machine's past calls.");
  else log(`usage-backfill: counted ${total} past skill call(s) from this machine in Jarvis › Skills.`);
}

// ---- install ---------------------------------------------------------------------

/**
 * One-time setup, identical on a desktop or a VPS: saves the token + hub URL
 * for this machine and merges the SessionStart (pull) / Stop (push) hooks into
 * ~/.claude/settings.json with THIS machine's own node + script paths. Re-run
 * any time — it replaces only its own hooks and keeps everything else.
 */
async function doInstall() {
  const token = TOKEN;
  const hub = HUB;
  const cfg = { ...CONFIG, hub, repo: REPO };
  delete cfg.memoryUrl;
  if (token) cfg.token = token;

  const node = process.execPath;
  const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
  const cmd = (m) => `${q(node)} ${q(SELF)} ${m} --quiet`;
  const settingsFile = path.join(CLAUDE_HOME, "settings.json");
  const settings = readJson(settingsFile);
  settings.hooks ??= {};
  const keepOthers = (arr) =>
    (Array.isArray(arr) ? arr : []).filter((g) => !(g?.hooks ?? []).some((h) => typeof h?.command === "string" && h.command.includes("skill-sync.mjs")));
  settings.hooks.SessionStart = [...keepOthers(settings.hooks.SessionStart), { hooks: [{ type: "command", command: cmd("pull") }] }];
  settings.hooks.Stop = [...keepOthers(settings.hooks.Stop), { hooks: [{ type: "command", command: cmd("push") }] }];
  addUsageHooks(settings, cmd("usage"));

  if (CHECK) {
    log(`[check] would write ${CONFIG_FILE} (hub ${hub}, ${token ? "token set" : "no token"}) and merge hooks into ${settingsFile}`);
    return;
  }
  await mkdir(CLAUDE_HOME, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
  await writeFile(settingsFile, JSON.stringify(settings, null, 2) + "\n");
  if (FOUND) log(`Using the token from your jarvis-memory connector (${FOUND.file}) — nothing to paste.`);
  log(`Saved this machine's settings to ${CONFIG_FILE}`);
  log(`Merged hooks into ${settingsFile} (SessionStart -> pull, Stop -> push, skill calls -> usage)`);

  if (!token) {
    log("No token found on this machine (no jarvis-memory connector in Claude Code's config).");
    log("Either add the connector (Jarvis > Memory > Same memory everywhere), or run: npm run skills:setup -- --token <TOKEN>");
    return;
  }
  // Check the token works, then bring this machine and Jarvis level right now.
  try {
    await api("/api/jarvis/skills");
  } catch (e) {
    log(`Saved, but Jarvis refused the token: ${e instanceof Error ? e.message : e}`);
    log("Check JARVIS_MCP_TOKEN in Vercel matches the one you used here, then re-run.");
    return;
  }
  await doPush();
  await adoptRepoSkills();
  await doPull();
  await doBackfill();
  log("Done. This machine now syncs skills with Jarvis on its own — including skills you create from your phone.");
}

// ---- main ---------------------------------------------------------------------------

try {
  if (mode === "install" || mode === "setup") await doInstall();
  else if (mode === "pull") await doPull();
  else if (mode === "push") await doPush();
  else if (mode === "usage") await doUsage();
  else if (mode === "usage-backfill") await doBackfill();
  else if (mode === "sync") {
    await doPush();
    await doPull();
  } else {
    log(`Unknown mode "${mode}". Use: install | pull | push | sync | usage | usage-backfill  [--check] [--quiet] [--git] [--force]`);
    process.exit(2);
  }
} catch (e) {
  // The usage hook stays silent: its output would land in Claude's context.
  if (mode !== "usage") console.error(`skill-sync: ${e instanceof Error ? e.message : e}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// One set of keys for the harness. The owner enters a key once.
//
// The PC helper's own repo `.env.local` is the one key file on this PC — the
// Connections page saves there (Onboarding.tsx `ENV_PATH`), worktrees copy it,
// and harness-models.mjs reads it. Two things used to break that promise:
//
//   1. The keys were pasted while the helper ran from an older checkout, so
//      they sat in THAT checkout's .env.local. When the helper moved, the new
//      folder had none, every harness run started keyless, and the owner was
//      asked to paste the same key again. `fillFromCheckouts` closes that: on
//      start, a key this file is missing is copied in from any other checkout
//      of the same repo on this PC. It only fills blanks — a key the owner set
//      here is never overwritten.
//
//   2. Only worktrees saw the file. A thread's child process, the brain and
//      the 24/7 runner did not. `loadIntoEnv` puts the keys in the helper's
//      own environment, which every child inherits, and is re-run before each
//      thread so a key saved a minute ago reaches the next run with no restart.
//
// Never loaded: Claude Code's own login variables. server.mjs strips them on
// purpose — an inherited ANTHROPIC_AUTH_TOKEN overrides the owner's
// subscription and fails every thread once it expires — and a key file must
// not be a way to put them back. The OpenRouter route sets its own, per child.
//
// Nothing here prints a value. Logs and the health check carry NAMES only.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/** Names that are never read out of a key file into the helper. */
const NEVER = /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDECODE$|CLAUDE_AGENT_SDK_|CLAUDE_PID$|NODE_|NEXT_DIST_DIR$|PORT$|PATH$|JARVIS_BRIDGE_)/i;
const NAME = /^[A-Z][A-Z0-9_]{1,80}$/;

/** `KEY=value` lines → Map. Comments, blanks, `export ` and quotes handled. */
export function parseEnv(text) {
  const out = new Map();
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).replace(/\\"/g, '"');
    } else {
      v = v.replace(/\s+#.*$/, "").trim();
    }
    out.set(m[1], v);
  }
  return out;
}

/** A key worth sharing: a sane name, not a login variable, and a real value. */
export function shareable(name, value) {
  return NAME.test(name) && !NEVER.test(name) && typeof value === "string" && value.trim().length > 0;
}

function readEnvFile(file) {
  try {
    return parseEnv(readFileSync(file, "utf8"));
  } catch {
    return new Map();
  }
}

function packageName(dir) {
  try {
    return String(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name || "");
  } catch {
    return "";
  }
}

/** "github.com/legacymiles/ultimate-assistant-os" from any form of the origin URL, or "". */
export function normalizeRemote(url) {
  return String(url ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z+]+:\/\//, "")
    .replace(/^[^@/]+@/, "")
    .replace(/^([^/:]+):(?!\d)/, "$1/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

function originOf(dir) {
  try {
    return normalizeRemote(
      execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return "";
  }
}

/**
 * Is `dir` a checkout of the same product?
 *
 * The GitHub origin first: the package was renamed on main (projects-timeline
 * → ultimate-assistant-os), so the older checkouts that hold the owner's keys
 * no longer share a package name with the current one. The package name is the
 * fallback for a folder with no remote.
 */
function sameRepo(dir, self) {
  if (self.origin) {
    const o = originOf(dir);
    if (o) return o === self.origin;
  }
  return Boolean(self.name) && packageName(dir) === self.name;
}

/**
 * Other checkouts of THIS repo on this PC that hold a .env.local.
 *
 * Found by package name, one level under the usual places, rather than from a
 * hard-coded list — the owner's folders have moved before (out of OneDrive,
 * into C:\dev) and a list would have pointed at the dead ones.
 */
export function otherCheckouts(repo, { roots } = {}) {
  const self = resolve(repo).toLowerCase();
  const me = { origin: originOf(repo), name: packageName(repo) };
  if (!me.origin && !me.name) return [];
  const places = roots ?? [join(homedir(), "Projects"), "C:\\dev", dirname(resolve(repo))];
  const seen = new Set();
  const found = [];
  for (const place of places) {
    let entries = [];
    try {
      entries = readdirSync(place, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = join(place, e.name);
      const key = resolve(dir).toLowerCase();
      if (key === self || seen.has(key)) continue;
      seen.add(key);
      const file = join(dir, ".env.local");
      if (!existsSync(file) || !sameRepo(dir, me)) continue;
      let mtime = 0;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        /* unreadable — skipped below by an empty parse */
      }
      found.push({ dir, file, mtime });
    }
  }
  // Newest first: when two checkouts disagree, the more recently saved key wins.
  return found.sort((a, b) => b.mtime - a.mtime);
}

/**
 * What this repo's .env.local is missing that another checkout has.
 * Pure over its inputs, so it can be tested without touching the disk.
 */
export function missingFrom(own, others) {
  const add = new Map();
  for (const { vars, from } of others) {
    for (const [k, v] of vars) {
      if (!shareable(k, v)) continue;
      if (shareable(k, own.get(k) ?? "") || add.has(k)) continue;
      add.set(k, { value: v, from });
    }
  }
  return add;
}

function envLine(name, value) {
  const v = /[\s#"'=]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  return `${name}=${v}`;
}

/**
 * Fill this repo's .env.local from the other checkouts. Returns the NAMES it
 * added and the folders they came from — never values.
 */
export function fillFromCheckouts(repo, { roots, now = new Date() } = {}) {
  const file = join(repo, ".env.local");
  const own = readEnvFile(file);
  const others = otherCheckouts(repo, { roots }).map((c) => ({ vars: readEnvFile(c.file), from: c.dir }));
  const add = missingFrom(own, others);
  if (!add.size) return { added: [], from: [], file };

  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    /* no file yet — it is created */
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text ? text.split(/\r?\n/) : [];
  // An empty `NAME=` line already in the file is filled in place, so the file
  // keeps its order and its comments; anything else is appended under a note.
  const tail = [];
  for (const [k, { value }] of add) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*(?:export\\s+)?${k}\\s*=`).test(l));
    if (i >= 0) lines[i] = envLine(k, value);
    else tail.push(envLine(k, value));
  }
  if (tail.length) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length) lines.push("");
    lines.push(
      `# Filled in by the Jarvis PC helper on ${now.toISOString().slice(0, 10)} from your other checkouts,`,
      "# so a key is entered once. Edit or replace any of these freely; they are never overwritten.",
      ...tail,
    );
  }
  writeFileSync(file, lines.join(eol) + eol, { encoding: "utf8", mode: 0o600 });
  return { added: [...add.keys()], from: [...new Set([...add.values()].map((a) => basename(a.from)))], file };
}

/** Names this helper took from the key file, so a later edit can update them. */
const fromFile = new Set();

/**
 * Put the key file into this process's environment, which every harness
 * thread, the brain and the 24/7 runner inherit.
 *
 * A variable that was already set by the real environment is left alone; one
 * that came from the file is refreshed, so a key replaced in Connections
 * reaches the next run. Returns the names now available.
 */
export function loadIntoEnv(repo, env = process.env) {
  const vars = readEnvFile(join(repo, ".env.local"));
  for (const [k, v] of vars) {
    if (!shareable(k, v)) continue;
    if (env[k] !== undefined && !fromFile.has(k)) continue;
    env[k] = v;
    fromFile.add(k);
  }
  return keyNames(env);
}

/** The key-shaped names present — for the health check and logs. */
export function keyNames(env = process.env) {
  return Object.keys(env)
    .filter((k) => /(_KEY|_TOKEN|_SECRET)$/.test(k) && !NEVER.test(k) && String(env[k] ?? "").trim())
    .sort();
}

/** Both steps, as the helper and the 24/7 runner do on start. Never throws. */
export function shareKeys(repo, { log = () => {}, roots } = {}) {
  try {
    const filled = fillFromCheckouts(repo, { roots });
    if (filled.added.length) {
      log(`keys: copied ${filled.added.length} you'd already entered (${filled.added.join(", ")}) from ${filled.from.join(", ")} into ${filled.file}`);
    }
  } catch (e) {
    log(`keys: couldn't fill .env.local from your other checkouts (${e?.message ?? e})`);
  }
  try {
    return loadIntoEnv(repo);
  } catch {
    return keyNames();
  }
}

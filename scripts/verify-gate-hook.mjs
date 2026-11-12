#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The Stop hook: a session may not end on a red `npm run verify`.
//
// Why a hook and not a skill. Skills that say "verify before you finish"
// already exist and are already installed, and the failure they are meant to
// prevent happened anyway — twice in one day — because a skill needs the agent
// to choose it and the agent had already concluded it was finished. A hook
// does not ask. `exit 2` with a reason on stderr is Claude Code's "keep going,
// here is why", so the session is handed its own failure instead of handing it
// to the owner.
//
// Deliberately NOT the harness's gate. `docs/superpowers/specs/harness-verify-
// gate.md` rejected the Stop hook for harness builds, and was right to: it
// exists only on the Claude adapter, it dies with the SDK child on a bridge
// restart, and DeepSeek has no equivalent. None of that is true of an
// interactive session, which is the one place that gate does not reach.
//
// What it runs is the repository's own gate and nothing of its own: the same
// `npm run verify` the clean-clone workflow runs, so it can never disagree
// with CI about whether the work is finished.
//
// Three ways out, because a hook that cannot be escaped is a hook that gets
// deleted:
//
//   Nothing to check. No tracked file under src/, tools/, scripts/ or
//   package.json differs from HEAD, so a session that only read, or only
//   touched docs, ends immediately.
//   Already checked. A pass is stamped against the exact tree hash, so the
//   second Stop in a row costs nothing.
//   Told not to. `.claude/verify-off` in the repo, or VERIFY_HOOK=off.
// ---------------------------------------------------------------------------

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STAMP = join(ROOT, "node_modules", ".cache", "verify-gate", "passed");

/** The paths a change to which makes the gate worth running. */
const MATTERS = /^(src\/|tools\/|scripts\/|package\.json|package-lock\.json|tsconfig|next\.config|vitest\.config)/;

function git(args) {
  try {
    return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** Allow the session to end, saying nothing. */
function pass() {
  process.exit(0);
}

/**
 * Refuse, and tell the session what to do about it.
 *
 * stderr + exit 2 is the contract: the text comes back to Claude, not to the
 * owner, which is the whole point — the owner should not be the one who finds
 * out the work is red.
 */
function block(why) {
  process.stderr.write(why);
  process.exit(2);
}

if (process.env.VERIFY_HOOK === "off" || existsSync(join(ROOT, ".claude", "verify-off"))) pass();

// Changed, staged or untracked — all three, because work that is committed but
// never built is exactly the case this exists for.
const changed = git(["status", "--porcelain=v1", "--untracked-files=all"])
  .split(/\r?\n/)
  .map((line) => line.slice(3).split(" -> ").pop() ?? "")
  .filter((f) => f && MATTERS.test(f));

// Committed-but-unpushed counts too: a red commit on a branch is still red.
const ahead = git(["diff", "--name-only", "@{upstream}", "HEAD"])
  .split(/\r?\n/)
  .filter((f) => f && MATTERS.test(f));

if (!changed.length && !ahead.length) pass();

// Stamped against the tree, so it is the CONTENT that was checked, not a
// moment in time. One more edit invalidates it; a second Stop does not.
const tree = git(["stash", "create"]) || git(["rev-parse", "HEAD^{tree}"]);
const key = `${tree}:${[...changed, ...ahead].sort().join(",")}`;
if (existsSync(STAMP)) {
  try {
    if (readFileSync(STAMP, "utf8").trim() === key) pass();
  } catch {
    /* an unreadable stamp just means run it */
  }
}

const ran = spawnSync("npm", ["run", "verify"], {
  cwd: ROOT,
  encoding: "utf8",
  shell: process.platform === "win32",
  env: { ...process.env, VERIFY_HOOK: "off", NEXT_TELEMETRY_DISABLED: "1" },
});

if (ran.status === 0) {
  try {
    mkdirSync(dirname(STAMP), { recursive: true });
    writeFileSync(STAMP, key);
  } catch {
    /* no stamp means the next Stop runs it again; correct, just slower */
  }
  pass();
}

// The tail only. The full output is thousands of lines and the useful part is
// always at the end, where the failing step says what it was.
const said = `${ran.stdout ?? ""}\n${ran.stderr ?? ""}`
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .slice(-40)
  .join("\n");

block(
  [
    "`npm run verify` is failing, so this work is not finished. Do not report it as done.",
    "",
    "That command is this repository's own gate and it is exactly what the clean-clone",
    "workflow runs on a pull request: check:apps, check:fonts, tsc --noEmit, npm test,",
    "npm run build. Two of its steps catch what nothing else does:",
    "",
    "  check:apps  fails whenever a catalog entry was added without regenerating",
    "              docs/apps/README.md. Run `npm run apps:index` and commit it.",
    "  npm run build  is the only check that sees an App Router mistake. A route.ts may",
    "              export nothing but route handlers; move any helper a test imports",
    "              into src/lib/<slug>/. tsc --noEmit passes while this fails.",
    "",
    "Fix the cause, run `npm run verify` again, and only then finish. If this is genuinely",
    "not yours to fix, say so to the owner in your own words and explain what is red --",
    "do not silently stop.",
    "",
    "The last of what it said:",
    said || "(it produced no output)",
  ].join("\n"),
);

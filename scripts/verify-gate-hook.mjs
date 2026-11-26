#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The Stop hook: a session may not end having COMMITTED a red `npm run verify`.
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
// ---------------------------------------------------------------------------
// It checks HEAD, not the working tree (changed 2026-11-25)
// ---------------------------------------------------------------------------
//
// It used to run `npm run verify` right here in the checkout. That made it
// race the 24/7 agents, which write to this same folder every few seconds
// (tools/jarvis-bridge/agents-wake.mjs). In one afternoon it went red six
// times at a session that had nothing to do with any of them:
//
//   check:records stale, because an agent had just rewritten docs/apps/*.md
//   4 failing tests, because an agent was mid-TDD on baby-no-scroll
//   TS2305 no exported member 'legFill', same agent, same red phase
//   build ENOENT src/app/favorites/page.tsx, an agent mid-refactor
//   TS2304 Cannot find name 'closeFace', in a file written 15 seconds earlier
//
// Only one of the six was real, and none of them belonged to the session being
// blocked. A gate that stops the wrong person five times out of six is a gate
// that gets switched off.
//
// So it now verifies a throwaway checkout of HEAD. That is the same thing CI
// measures — a clean tree at a commit — so the two can still never disagree,
// and no other process can touch it while it runs.
//
// The trade, stated plainly: uncommitted work is no longer checked. That is
// deliberate. You can only ship what you commit, committing is what arms this
// gate, and the alternative — checking a tree three other processes are
// writing to — is what we are fixing. If you want your edits checked, commit
// them.
//
// Three ways out, because a hook that cannot be escaped is a hook that gets
// deleted:
//
//   Nothing to check. HEAD holds no unpushed commit touching src/, tools/,
//   scripts/, docs/apps/ or package.json, so a session that only read, only
//   touched docs, or already pushed ends immediately.
//   Already checked. A pass is stamped against the HEAD sha, so the second
//   Stop in a row costs nothing — and, unlike the old tree-hash stamp, an
//   agent's edit no longer invalidates it.
//   Told not to. `.claude/verify-off` in the repo, or VERIFY_HOOK=off.
// ---------------------------------------------------------------------------

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STAMP = join(ROOT, "node_modules", ".cache", "verify-gate", "passed");
const WIN = process.platform === "win32";

/** The paths a change to which makes the gate worth running. */
const MATTERS = /^(src\/|tools\/|scripts\/|docs\/apps\/|package\.json|package-lock\.json|tsconfig|next\.config|vitest\.config)/;

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

const head = git(["rev-parse", "HEAD"]);
if (!head) pass(); // not a git repo, or no commits yet: nothing to measure

// What this session would push. An upstream is the honest baseline; without
// one, fall back to the default branch, and failing that verify HEAD anyway
// rather than silently waving a new branch through.
const base =
  git(["rev-parse", "--verify", "--quiet", "@{upstream}"]) ||
  git(["rev-parse", "--verify", "--quiet", "origin/main"]) ||
  "";

const unpushed = base
  ? git(["diff", "--name-only", base, "HEAD"])
      .split(/\r?\n/)
      .filter((f) => f && MATTERS.test(f))
  : ["(no upstream)"];

if (!unpushed.length) pass();

// Stamped against the COMMIT, not a tree hash. The old stamp keyed on
// `git stash create`, so any edit by anyone — including an agent three
// directories away — threw the stamp away and made the next Stop pay for a
// full verify again. A sha only changes when this session commits.
if (existsSync(STAMP)) {
  try {
    if (readFileSync(STAMP, "utf8").trim() === head) pass();
  } catch {
    /* an unreadable stamp just means run it */
  }
}

// ---------------------------------------------------------------------------
// Run the gate on a throwaway checkout of HEAD.
// ---------------------------------------------------------------------------

// The pid is in the name because two of these can run at once — a session's
// own Stop hook fires while a run started by hand is still going, and two
// sessions on one checkout do it too. Sharing a path meant one run's opening
// teardown() deleted the other's worktree mid-verify, which produced a leaked
// worktree and a pass stamp for a commit that had actually failed.
const wt = join(tmpdir(), `verify-gate-${basename(ROOT)}-${head.slice(0, 12)}-${process.pid}`);
const wtModules = join(wt, "node_modules");

/**
 * Take the worktree down.
 *
 * ORDER MATTERS AND IS NOT COSMETIC. node_modules inside the worktree is a
 * junction (Windows) or symlink (POSIX) pointing at the REAL one. Deleting the
 * worktree while that link is in place walks through it and destroys the real
 * node_modules. So the link is unlinked first, by a call that removes the link
 * and never follows it, and only then does the worktree go.
 */
function teardown() {
  // Only a LINK is dangerous. A real directory there is the worktree's own
  // copy and may be deleted with it; a link points at the real node_modules
  // and must be unlinked first. Node reports a Windows junction as a symlink.
  let link = false;
  try {
    link = lstatSync(wtModules).isSymbolicLink();
  } catch {
    /* nothing there */
  }
  if (link) {
    if (WIN) spawnSync("cmd", ["/c", "rmdir", wtModules], { stdio: "ignore" });
    else spawnSync("rm", [wtModules], { stdio: "ignore" }); // no -r, no -f: unlink only
    // Still a link? Then stop. Deleting the worktree now would follow it and
    // take the real node_modules with it. A stray worktree is the lesser evil.
    try {
      if (lstatSync(wtModules).isSymbolicLink()) return;
    } catch {
      /* gone, as intended */
    }
  }
  spawnSync("git", ["-C", ROOT, "worktree", "remove", "--force", wt], { stdio: "ignore" });
  try {
    rmSync(wt, { recursive: true, force: true });
  } catch {
    /* already gone */
  }
  spawnSync("git", ["-C", ROOT, "worktree", "prune"], { stdio: "ignore" });
}

let ran;
try {
  teardown(); // a worktree left behind by a killed run
  const made = spawnSync("git", ["-C", ROOT, "worktree", "add", "--detach", "--quiet", wt, head], {
    encoding: "utf8",
  });
  if (made.status !== 0) throw new Error(made.stderr || "worktree add failed");

  // node_modules is not in git, and installing it per run would cost minutes.
  if (WIN) {
    const linked = spawnSync("cmd", ["/c", "mklink", "/J", wtModules, join(ROOT, "node_modules")], { stdio: "ignore" });
    if (linked.status !== 0) throw new Error("could not link node_modules");
  } else {
    symlinkSync(join(ROOT, "node_modules"), wtModules, "dir");
  }

  ran = spawnSync("npm", ["run", "verify"], {
    cwd: wt,
    encoding: "utf8",
    shell: WIN,
    env: { ...process.env, VERIFY_HOOK: "off", NEXT_TELEMETRY_DISABLED: "1" },
  });
} catch (err) {
  // Never let a broken worktree silently disable the gate. Fall back to the
  // old in-place run and say so, so a red is still a red.
  ran = spawnSync("npm", ["run", "verify"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: WIN,
    env: { ...process.env, VERIFY_HOOK: "off", NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (ran.status !== 0) {
    ran.stdout = `${ran.stdout ?? ""}\n(ran in the working tree, not a clean HEAD: ${err.message})`;
  }
} finally {
  teardown();
}

if (ran.status === 0) {
  try {
    mkdirSync(dirname(STAMP), { recursive: true });
    writeFileSync(STAMP, head);
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
    "`npm run verify` is failing on the commits you are about to push, so this work is not",
    "finished. Do not report it as done.",
    "",
    "It ran on a clean checkout of HEAD, not this working tree, so nothing another session",
    "or a 24/7 agent is editing can be the cause: every failure below is in a commit.",
    "",
    "That command is this repository's own gate and it is exactly what the clean-clone",
    "workflow runs on a pull request: check:apps, check:records, check:fonts, tsc --noEmit,",
    "npm test, npm run build. Three of its steps catch what nothing else does:",
    "",
    "  check:apps  fails whenever a catalog entry was added without regenerating",
    "              docs/apps/README.md. Run `npm run apps:index` and commit it.",
    "  check:records  fails when an app's record (docs/apps/<slug>.md) no longer matches",
    "              its code — a new route, key, table, policy or test. Run",
    "              `npm run apps:records`, update the record's Features / Must keep",
    "              working if the app changed, and commit it.",
    "  npm run build  is the only check that sees an App Router mistake. A route.ts may",
    "              export nothing but route handlers; move any helper a test imports",
    "              into src/lib/<slug>/. tsc --noEmit passes while this fails.",
    "",
    "Fix the cause, commit the fix, and only then finish. Uncommitted edits are not",
    "checked by this gate and will not clear it — the commit is what it measures.",
    "",
    "The last of what it said:",
    said || "(it produced no output)",
  ].join("\n"),
);

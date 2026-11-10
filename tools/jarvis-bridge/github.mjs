// ---------------------------------------------------------------------------
// One-click shipping: commit, push, PR, merge.
//
// The build already happened on this PC in a worktree. What used to be left to
// the owner — open GitHub, read the PR, find the merge button — is three git
// calls and one `gh` call. `gh` gets the same credential git already uses,
// handed over by server.mjs at startup.
//
// When the merge cannot happen because the branch is behind main, the merge
// is attempted first and the conflict files are returned. The calling app can
// hand that sentence to the same build agent, which is already standing in
// this worktree with full context, and retry. That is the "see the error and
// fix it" half; this file is the "do the git part" half.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const RUN_TIMEOUT = 180_000;
const ROOT = resolve(homedir(), ".jarvis-harness", "worktrees");

function exec(command, args, cwd, timeout = RUN_TIMEOUT) {
  return new Promise((done) => {
    execFile(
      command,
      args,
      { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (error, stdout, stderr) => {
        const out = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
        done({ ok: !error, code: typeof error?.code === "number" ? error.code : 0, out, error: error?.message ?? "" });
      },
    );
  });
}

const git = (cwd, args, timeout) => exec("git", ["-C", cwd, ...args], cwd, timeout);
const gh = (cwd, args, timeout) => exec("gh", args, cwd, timeout);

function firstLine(text) {
  return String(text ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
}

function conflictFiles(text) {
  const files = [];
  for (const m of String(text ?? "").matchAll(/CONFLICT \([^)]+\):\s+(?:Merge conflict in\s+)?(\S+)/g)) files.push(m[1]);
  return [...new Set(files)];
}

function insideRoot(path) {
  const p = resolve(path).toLowerCase();
  const root = ROOT.toLowerCase();
  return p === root || p.startsWith(root + "\\") || p.startsWith(root + "/");
}

function prNumber(value) {
  const m = String(value ?? "").match(/(\d+)\s*$/) || String(value ?? "").match(/\/pull\/(\d+)/);
  return m ? Number(m[1]) : 0;
}

/** What GitHub says about this PR, for the app's poll. */
export async function status({ path, pr }) {
  if (!path || !existsSync(path) || !insideRoot(path)) return { ok: false, message: "That worktree is gone." };
  const number = prNumber(pr);
  if (!number) return { ok: false, message: "No pull request to read." };
  const out = await gh(path, ["pr", "view", String(number), "--json", "state,mergedAt,mergeable,mergeStateStatus,url,statusCheckRollup"]);
  if (!out.ok) return { ok: false, message: firstLine(out.out) || "GitHub did not answer." };
  try {
    return { ok: true, pr: JSON.parse(out.out) };
  } catch {
    return { ok: false, message: "GitHub answered with something that was not a pull request." };
  }
}

/**
 * Bring main into the build, push the branch, and merge the PR.
 *
 * Returns `conflict: true` with the files when git needs a human (or the build
 * agent) to resolve — the caller sends that to the agent rather than guessing.
 */
export async function ship({ path, branch, pr, message = "" }) {
  if (!path || !existsSync(path)) return { ok: false, message: "That build's worktree is gone." };
  if (!insideRoot(path)) return { ok: false, message: "That path is not a harness worktree." };

  const number = prNumber(pr);
  if (!number) return { ok: false, message: "There is no pull request to merge." };

  // A dirty worktree means the agent left something uncommitted; merging on
  // top of it would either fail or bury it.
  const dirty = await git(path, ["status", "--porcelain"]);
  if (dirty.ok && dirty.out.trim()) {
    return { ok: false, message: "The build left uncommitted changes in its worktree, so it isn't safe to merge yet." };
  }

  const fetched = await git(path, ["fetch", "origin", "main"]);
  if (!fetched.ok) return { ok: false, message: `Could not fetch main: ${firstLine(fetched.out)}` };

  // main must be an ancestor before we can merge cleanly; this also brings in
  // a newer vercel.json / branch rule that the build may need.
  const merged = await git(path, ["merge", "origin/main", "--no-edit"]);
  if (!merged.ok) {
    const files = conflictFiles(merged.out);
    return {
      ok: false,
      conflict: files.length > 0,
      files,
      message: files.length
        ? `The build conflicts with main in ${files.length} file${files.length === 1 ? "" : "s"}: ${files.slice(0, 6).join(", ")}${files.length > 6 ? "…" : ""}`
        : `Could not bring main into the build: ${firstLine(merged.out)}`,
    };
  }

  const pushed = await git(path, ["push", "origin", `HEAD:${branch}`]);
  if (!pushed.ok) return { ok: false, message: `Could not push the branch: ${firstLine(pushed.out)}` };

  const before = await gh(path, ["pr", "view", String(number), "--json", "state,url"]);
  if (before.ok) {
    try {
      const state = JSON.parse(before.out);
      if (state.state === "MERGED") return { ok: true, merged: true, message: `PR #${number} is already merged.` };
    } catch {
      /* fall through to merge */
    }
  }

  // Merge. If checks are still running, GitHub may accept an auto-merge; if
  // not, `gh` says why and the caller can hand that to the agent.
  const squash = await gh(path, ["pr", "merge", String(number), "--squash", "--delete-branch"], 120_000);
  if (squash.ok) return { ok: true, merged: true, message: `PR #${number} merged into main.` };

  const auto = await gh(path, ["pr", "merge", String(number), "--squash", "--delete-branch", "--auto"], 120_000);
  if (auto.ok) {
    return { ok: true, queued: true, message: `PR #${number} will merge as soon as its checks pass.` };
  }

  return {
    ok: false,
    message: `GitHub refused the merge: ${firstLine(squash.out) || firstLine(auto.out) || "no reason given"}`,
  };
}

// ---------------------------------------------------------------------------
// A git worktree per harness thread.
//
// A coding harness driven from a web page is a second pair of hands on a
// repository that already has hands on it — this folder routinely has two or
// three Claude Code sessions open on it, and a blanket `git add` from any one
// of them sweeps the others' work into its commit. So a thread never works in
// the checkout the owner is looking at. It gets its own worktree, its own
// branch, and a landing step that refuses rather than guesses.
//
// Three details are the whole file:
//
//   The worktrees live OUTSIDE the repository, under the home directory. The
//   repo's own Desktop path is redirected into OneDrive, so a worktree placed
//   inside it hands OneDrive a second full copy of the tree plus whatever the
//   harness builds in it, and the sync client then fights the compiler for
//   the files. ~/.jarvis-harness is not synced by anything.
//
//   node_modules is a DIRECTORY JUNCTION back to the main checkout, not a
//   copy and not an install. A fresh `npm install` here is two minutes and a
//   gigabyte per thread, which turns "start a thread" into something you avoid
//   — and without it `npx tsc` and `npx vitest` do not run at all, so the
//   harness cannot check its own work. `.next` is NOT shared: it stays inside
//   the worktree, which is exactly the separation the repo's own rule about
//   two dev servers demands.
//
//   Landing never merges into a dirty base. It commits on the branch, and
//   merges only when the base checkout has nothing of its own to lose. When it
//   stops, it says which files stopped it.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, copyFileSync, rmdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Where threads live. Outside the repo, and outside OneDrive. */
export const WORKTREE_ROOT =
  process.env.JARVIS_WORKTREE_ROOT || join(homedir(), ".jarvis-harness", "worktrees");

/** The repo a thread works on when the page does not name one. */
export const DEFAULT_REPO =
  process.env.JARVIS_REPO || resolve(homedir(), "OneDrive", "Desktop", "claude code files");

/**
 * Files copied into a new worktree although git does not track them.
 *
 * `.env.local` is the only one that matters and it is COPIED, never junctioned:
 * a harness that writes a key into a junctioned env file has edited the
 * owner's real one, and a harness that truncates it has deleted every key on
 * the machine. A copy means a key it adds is lost with the worktree, which is
 * the right way round.
 */
const CARRIED = [".env.local", ".env"];

function git(args, cwd, timeoutMs = 120_000) {
  return new Promise((done, fail) => {
    execFile(
      "git",
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 24 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || stdout || err.message).trim();
          return fail(Object.assign(new Error(msg || `git ${args[0]} failed`), { status: 400 }));
        }
        done(String(stdout));
      },
    );
  });
}

/** A branch-and-folder-safe stem from whatever the owner typed. */
export function slugify(text, fallback = "thread") {
  const s = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/g, "");
  return s || fallback;
}

/** Is this path a git repository we can work in? */
export async function repoInfo(repo) {
  const top = (await git(["rev-parse", "--show-toplevel"], repo)).trim();
  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], repo)).trim();
  return { root: top, branch };
}

/**
 * Windows directory junction, so the worktree can resolve the repo's packages.
 *
 * A junction rather than a symlink because it needs no elevation, and
 * `cmd /c mklink /J` rather than fs.symlink because Node's "junction" type
 * silently produces a reparse point Node resolves but some tools do not.
 *
 * Failure here is not fatal: the thread still works, it just cannot run the
 * repo's own tooling, so the reason is reported and the thread opens anyway.
 */
function junction(link, target) {
  return new Promise((done) => {
    if (process.platform !== "win32") {
      try {
        symlinkSync(target, link, "dir");
        done("");
      } catch (e) {
        done(String(e?.message ?? e));
      }
      return;
    }
    execFile(
      "cmd",
      ["/c", "mklink", "/J", link, target],
      { timeout: 30_000, windowsHide: true },
      (err, _out, stderr) => done(err ? String(stderr || err.message).trim() : ""),
    );
  });
}

/**
 * Make a worktree for one thread.
 *
 * Returns everything the page needs to describe it: where it is, what branch it
 * is on, what it was cut from, and whether its tooling is usable.
 */
export async function createWorktree({ id, repo = DEFAULT_REPO, title = "" }) {
  if (!existsSync(repo)) {
    throw Object.assign(new Error(`No repository at ${repo}.`), { status: 400 });
  }
  const { root, branch: base } = await repoInfo(repo);

  mkdirSync(WORKTREE_ROOT, { recursive: true });
  const stem = slugify(title, "thread");
  const short = id.slice(-6);
  const path = join(WORKTREE_ROOT, `${stem}-${short}`);
  // Flat, not `jarvis/<stem>`. Git stores refs as paths, so a repository that
  // already has a branch called `jarvis` makes every `jarvis/...` ref
  // impossible to create — "cannot lock ref: 'refs/heads/jarvis' exists" — and
  // this repository has exactly that branch. A single segment cannot collide
  // with a directory, whatever the owner has named their branches.
  const branch = `jarvis-${stem}-${short}`;

  // -B rather than -b: a retried start with the same id should reuse its own
  // branch instead of failing on "already exists", which is otherwise the
  // first thing that happens after a bridge restart.
  await git(["worktree", "add", "-B", branch, path, "HEAD"], root, 180_000);

  const notes = [];
  const modules = join(root, "node_modules");
  if (existsSync(modules)) {
    const why = await junction(join(path, "node_modules"), modules);
    if (why) notes.push(`node_modules is not linked (${why}) — npm scripts will not run in this thread.`);
  } else {
    notes.push("The repo has no node_modules, so this thread has none either.");
  }

  for (const name of CARRIED) {
    const from = join(root, name);
    if (existsSync(from)) {
      try {
        copyFileSync(from, join(path, name));
      } catch (e) {
        notes.push(`${name} was not carried over (${String(e?.message ?? e)}).`);
      }
    }
  }

  return { path, branch, base, repo: root, notes };
}

/** `git status --porcelain`, parsed into the rows a panel can draw. */
export async function worktreeStatus(path) {
  if (!path || !existsSync(path)) return { exists: false, files: [], added: 0, removed: 0, dirty: false };
  const porcelain = await git(["status", "--porcelain=v1", "--untracked-files=all"], path);
  const files = porcelain
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((l) => ({ state: l.slice(0, 2).trim() || "?", file: l.slice(3) }));

  // Numstat only counts what the index knows about, so a brand new file is
  // worth zero lines until it is intent-added. Without this the panel reports
  // "+0/-0" for a thread whose whole output is new files — and it did, until
  // the counts were compared against the diff panel beside them.
  await git(["add", "-A", "-N"], path).catch(() => "");
  let added = 0;
  let removed = 0;
  const numstat = await git(["diff", "HEAD", "--numstat"], path).catch(() => "");
  for (const line of numstat.split("\n")) {
    const [a, r] = line.split("\t");
    if (a && a !== "-") added += Number(a) || 0;
    if (r && r !== "-") removed += Number(r) || 0;
  }
  return { exists: true, files, added, removed, dirty: files.length > 0 };
}

/** The patch itself, capped, because a page is not a pager. */
export async function worktreeDiff(path, { maxChars = 180_000 } = {}) {
  if (!path || !existsSync(path)) return { diff: "", truncated: false };
  // Untracked files are added to the INDEX ONLY (-N), never committed, so they
  // appear in the diff. Without this a thread that only created files shows an
  // empty patch, which is the exact moment the owner stops trusting the panel.
  await git(["add", "-A", "-N"], path).catch(() => "");
  const diff = await git(["diff", "HEAD"], path).catch(() => "");
  return {
    diff: diff.length > maxChars ? diff.slice(0, maxChars) : diff,
    truncated: diff.length > maxChars,
  };
}

/**
 * Commit the thread, and merge it only if that is safe.
 *
 * The refusal is the feature. This checkout has several sessions working in it
 * and is almost never clean; merging into it on a button press is how a
 * harness thread eats somebody else's afternoon. So: always commit on the
 * branch, merge only into a clean base, and when it stops, name the files.
 */
export async function landWorktree({ path, repo, base, message, merge = true, attribution = "" }) {
  const status = await worktreeStatus(path);
  const out = { committed: false, merged: false, sha: "", why: "" };

  if (status.dirty) {
    await git(["add", "-A"], path);
    const body = (message || "Harness thread").trim() + (attribution ? `\n\n${attribution}` : "");
    await git(["commit", "-m", body], path, 180_000);
    out.committed = true;
  }
  out.sha = (await git(["rev-parse", "--short", "HEAD"], path)).trim();

  if (!merge) {
    out.why = "Committed on its branch. Nothing merged, because you did not ask for it.";
    return out;
  }

  // NOT trimmed before splitting. A porcelain line is two status characters
  // then a space then the path, and an unstaged edit's first character IS a
  // space — so trimming the whole output shifts the first line left by one
  // and the refusal names "LAUDE.md". Rows are trimmed individually instead.
  const baseRows = (await git(["status", "--porcelain"], repo))
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (baseRows.length) {
    const names = baseRows.slice(0, 6).map((l) => l.slice(3)).join(", ");
    const more = baseRows.length > 6 ? ", …" : "";
    out.why =
      `Committed on its branch, but ${base} was not merged: that checkout has uncommitted work ` +
      `(${names}${more}). Merging would mix this thread into it. Commit or stash there first, ` +
      `then land again.`;
    return out;
  }

  const current = (await git(["rev-parse", "--abbrev-ref", "HEAD"], repo)).trim();
  if (current !== base) {
    out.why = `Committed on its branch. ${base} was not merged, because that checkout is on ${current}.`;
    return out;
  }

  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], path)).trim();
  await git(["merge", "--no-ff", "-m", `Land ${branch}`, branch], repo, 180_000);
  out.merged = true;
  out.why = `Merged into ${base}. Nothing is pushed — that is still yours to do.`;
  return out;
}

/**
 * Unlink the node_modules junction WITHOUT touching what it points at.
 *
 * This function exists because of a real accident. `git worktree remove
 * --force` deletes the worktree's directory tree, and on Windows it recursed
 * INTO the junction instead of unlinking it — so it started deleting the main
 * checkout's packages, emptied `node_modules/.bin` (alphabetically first) and
 * stopped. Every npm binary in the repo went with it.
 *
 * `rmdirSync` on a reparse point removes the link only, which is why the
 * junction must be gone before git is allowed anywhere near the folder.
 */
function unlinkModules(path) {
  const link = join(path, "node_modules");
  try {
    if (!existsSync(link)) return;
    const st = lstatSync(link);
    if (!st.isSymbolicLink() && !st.isDirectory()) return;
    rmdirSync(link);
  } catch {
    // If it cannot be unlinked, the worktree must NOT be force-removed: that
    // is exactly the case that eats the real node_modules. Left in place, the
    // worst outcome is a stale folder the owner can delete by hand.
    throw Object.assign(
      new Error(
        `Could not unlink ${link}. The worktree was left in place rather than risk deleting ` +
        `the repository's own node_modules through it. Remove the folder by hand.`,
      ),
      { status: 409 },
    );
  }
}

/** Throw the thread away: the worktree, and the branch if nothing was kept. */
export async function removeWorktree({ path, repo, branch, deleteBranch = true }) {
  unlinkModules(path);
  await git(["worktree", "remove", "--force", path], repo, 120_000).catch(() => {
    // A worktree whose folder is already gone still leaves an entry behind,
    // and that entry blocks the next thread that wants the same name.
    try {
      rmSync(path, { recursive: true, force: true });
    } catch { /* nothing more to try. */ }
  });
  await git(["worktree", "prune"], repo).catch(() => "");
  if (deleteBranch && branch) await git(["branch", "-D", branch], repo).catch(() => "");
  return { removed: true };
}

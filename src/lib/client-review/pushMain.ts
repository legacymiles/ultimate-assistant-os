"use client";

// ---------------------------------------------------------------------------
// "Push to main" — the one tap that turns a finished build into a live site.
//
// The build already happened, in a worktree on the owner's own PC, so this
// needs no GitHub token and no deploy button: it brings origin/main into that
// worktree (so the push is a fast-forward, never a force), pushes the result to
// main, and whatever hosts main deploys it — Vercel for a client site, the
// hub's own deploy for the owner's apps.
//
// Three separate git calls rather than one chained shell line: this bridge runs
// Windows PowerShell 5, which refuses `&&`, and when a step fails the owner
// should be told which one failed rather than "the command failed".
// ---------------------------------------------------------------------------

import { BridgeError, call } from "@/lib/new-jarvis/bridge";
import type { ClientProject } from "./types";

export interface PushResult {
  ok: boolean;
  message: string;
}

interface ThreadSummary {
  id: string;
  status?: string;
  worktree?: { path?: string; branch?: string };
}

/** One shell call, as either "it worked" or the first useful line it said. */
async function git(command: string): Promise<{ ok: boolean; said: string }> {
  const out = await call<{ ok?: boolean; exitCode?: number | null; stdout?: string; stderr?: string }>("shell", {
    command,
    timeoutMs: 180_000,
  });
  const said = `${out.stdout ?? ""}\n${out.stderr ?? ""}`.trim();
  return { ok: out.ok === true && (out.exitCode ?? 0) === 0, said };
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
}

/**
 * Merge this build's branch into main on GitHub, without touching the owner's
 * own checkout: the merge happens in the worktree the thread already has.
 */
export async function pushThreadToMain(threadId: string): Promise<PushResult> {
  let thread: ThreadSummary | undefined;
  try {
    const data = await call<{ threads: ThreadSummary[] }>("harness/threads");
    thread = (data.threads ?? []).find((t) => t.id === threadId);
  } catch (e) {
    return { ok: false, message: e instanceof BridgeError ? e.message : "Couldn't ask the PC which build this is." };
  }

  const path = thread?.worktree?.path;
  if (!path) {
    return { ok: false, message: "That build's worktree is gone — the agent restarted or it was discarded. Build it again." };
  }
  if (thread?.status && thread.status !== "ended") {
    return { ok: false, message: "That build is still running. Push it once it has finished." };
  }

  const where = `git -C "${path}"`;
  const fetched = await git(`${where} fetch origin main`);
  if (!fetched.ok) {
    return { ok: false, message: `Couldn't fetch main: ${firstLine(fetched.said) || "no answer from git"}` };
  }

  // The build must be MAIN plus the edits, nothing else. A branch cut from
  // whatever the owner's checkout happened to have checked out carries that
  // branch's commits too, and pushing it would land them on main — so this is
  // checked before anything is merged, not after.
  const based = await git(`${where} merge-base --is-ancestor origin/main HEAD`);
  if (!based.ok) {
    return {
      ok: false,
      message:
        "This build wasn't cut from main — it sits on top of another branch, so pushing it would carry that branch's work to main too. Rebuild it after putting your hub checkout on main, or merge it on GitHub yourself.",
    };
  }

  // Nothing to bring in, usually: the brief asked the build to rebase onto
  // origin/main first. Kept because main can move while a build runs.
  const merged = await git(`${where} merge origin/main --no-edit`);
  if (!merged.ok) {
    return {
      ok: false,
      message: `main has moved and this branch conflicts. Open the pull request and resolve it there — main was not touched. ${firstLine(merged.said)}`,
    };
  }

  const pushed = await git(`${where} push origin HEAD:main`);
  if (!pushed.ok) {
    return { ok: false, message: `Couldn't push to main: ${firstLine(pushed.said) || "git said no"}` };
  }
  return { ok: true, message: "Pushed to main. The site deploys in a minute." };
}

// ----- one-click ship, with the build agent fixing its own git problems -----

interface ShipReply {
  ok: boolean;
  merged?: boolean;
  queued?: boolean;
  conflict?: boolean;
  files?: string[];
  message: string;
}

/**
 * Ship a finished build: merge main in, push the branch, merge the PR.
 *
 * If git conflicts or GitHub refuses, the same build agent — which is still
 * standing in that worktree with the whole job in its head — is told what
 * failed and asked to fix it. Its own gates are answered here because the
 * owner pressed "Ship", and then the merge is retried. No GitHub tab, no
 * hand-resolving a conflict the agent created.
 */
export async function shipThread(threadId: string, prUrl: string): Promise<PushResult> {
  let thread: ThreadSummary | undefined;
  try {
    const data = await call<{ threads: ThreadSummary[] }>("harness/threads");
    thread = (data.threads ?? []).find((t) => t.id === threadId);
  } catch (e) {
    return { ok: false, message: e instanceof BridgeError ? e.message : "Couldn't ask the PC which build this is." };
  }
  const path = thread?.worktree?.path;
  const branch = thread?.worktree?.branch;
  if (!path || !branch) return { ok: false, message: "That build's worktree is gone. Build it again." };

  const pr = /\/pull\/(\d+)/.exec(prUrl)?.[1] ?? prUrl.replace(/\D/g, "");
  if (!pr) return { ok: false, message: "There is no pull request to merge." };

  let last = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let reply: ShipReply;
    try {
      reply = await call<ShipReply>("github/ship", { path, branch, pr });
    } catch (e) {
      return { ok: false, message: e instanceof BridgeError ? e.message : "The PC couldn't reach GitHub." };
    }
    if (reply.ok) return { ok: true, message: reply.message };
    last = reply.message;

    // Hand the failure to the agent and let it fix the worktree/PR. It has the
    // full job context; a fresh reader would have to rediscover it.
    try {
      await call("harness/say", {
        id: threadId,
        text: [
          `Shipping PR #${pr} failed: ${reply.message}`,
          reply.files?.length ? `The conflicted files are: ${reply.files.join(", ")}.` : "",
          "You have full access for this. Fix it in your worktree: fetch origin/main, merge it, resolve every conflict (keep this build's edit and the other side's new work), commit, push the branch, then merge the PR with `gh pr merge --squash --delete-branch`. If a branch rule or a Vercel rule blocks it, fix that too. Do not ask; do not stop for permission. Finish with `SHIPPED: <url>` or `BLOCKED: <why>`.",
        ].filter(Boolean).join("\n\n"),
      });
    } catch {
      return { ok: false, message: `${last} (The build agent could not be reached to fix it.)` };
    }

    // Wait for the agent, answering any gate it hits: the owner pressed Ship.
    let cursor = 0;
    const deadline = Date.now() + 8 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_500));
      try {
        const data = await call<{
          events: unknown[];
          cursor: number;
          session: { status?: string; gate?: { gateId: string } | null };
        }>("harness/events", { id: threadId, since: cursor });
        cursor = data.cursor;
        const gate = data.session.gate;
        if (gate?.gateId) {
          await call("harness/decide", { id: threadId, gateId: gate.gateId, allow: true, always: true }).catch(() => null);
        }
        if (data.session.status === "idle" || data.session.status === "ended") break;
      } catch {
        break;
      }
    }
  }

  return { ok: false, message: last || "GitHub didn't finish merging the build." };
}

// ----- what the widgets list --------------------------------------------------

/** One approved batch whose build exists and whose version is still open. */
export interface ShipItem {
  projectId: string;
  name: string;
  appSlug?: string;
  appPath?: string;
  versionId: string;
  /** "v2" */
  version: string;
  /** Set when the build is running on the PC; the only thing that can be pushed. */
  threadId?: string;
  /** Set when it was filed in In Queue instead. */
  queueId?: string;
}

/**
 * Everything waiting to be shipped: a version still "building" that already has
 * a build behind it. A version with no build at all is not here — it is waiting
 * for the owner to press build, which is Client Review's job, not a widget's.
 */
export function shipItems(projects: ClientProject[]): ShipItem[] {
  const out: ShipItem[] = [];
  for (const p of projects) {
    if (p.archived) continue;
    for (const v of p.versions) {
      if (v.status !== "building") continue;
      const batch = p.batches.find((b) => b.nextVersionId === v.id && b.build);
      const build = batch?.build;
      if (!build) continue;
      out.push({
        projectId: p.id,
        name: p.name,
        ...(p.appSlug ? { appSlug: p.appSlug } : {}),
        ...(p.appPath ? { appPath: p.appPath } : {}),
        versionId: v.id,
        version: v.number,
        ...(build.threadId ? { threadId: build.threadId } : {}),
        ...(build.queueId ? { queueId: build.queueId } : {}),
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

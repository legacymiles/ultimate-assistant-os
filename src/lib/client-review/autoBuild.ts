"use client";

// ---------------------------------------------------------------------------
// Approve & build → a REAL build, on the owner's own PC.
//
// This is Client Review catching up with App Builder. App Builder's Build it no
// longer files a request and stops (see src/lib/app-builder/build.ts): it starts
// a harness thread on the PC and the bridge runs Claude Code in a worktree. The
// client-edit path never got that upgrade — it still posted to In Queue, where
// nothing runs until the owner tells Claude Code to work the queue — so an
// approved batch sat on "building" with no build behind it.
//
// So: the approved batch becomes the same App Builder edit project it always
// became, and then this starts a thread on it directly. Worktree of the repo,
// its own branch, Claude Code writes the edits. The owner ships the preview
// themselves, which is why the prompt ends with a `Preview:` line instead of
// calling the review connector.
//
// The queue stays as the fallback, not the default: a phone can approve while
// the PC is shut, and a request that waits is better than a button that lies.
// ---------------------------------------------------------------------------

import { clientEditProject, editMasterPrompt } from "@/lib/app-builder/clientEdit";
import type { BuilderProject } from "@/lib/app-builder/types";
import { readStore, writeStore } from "@/lib/app-builder/useAppBuilder";
import { BridgeError, call, knownFolder, probe } from "@/lib/new-jarvis/bridge";
import { HUB_REPO } from "./apps";
import type { ClientProject } from "./types";

/**
 * Why this PC can't build it. Every one of these has a queue fallback, so they
 * are values rather than exceptions the caller has to parse out of a message.
 */
export type CannotBuildReason = "pc-off" | "not-paired" | "repo-not-here";

export class CannotBuildHere extends Error {
  constructor(
    readonly reason: CannotBuildReason,
    message: string,
  ) {
    super(message);
    this.name = "CannotBuildHere";
  }
}

export interface StartedBuild {
  /** The bridge's thread — what the console follows to show progress. */
  threadId: string;
  /** The App Builder project the edits live in, so the panel can open it. */
  builderId: string;
}

/** The App Builder project for this batch: the one that exists, or a fresh one. */
function builderFor(review: ClientProject, batchId: string): BuilderProject {
  const named = review.batches.find((b) => b.id === batchId)?.build?.builderId;
  const store = readStore();
  const existing =
    (named ? store.projects.find((p) => p.id === named) : undefined) ??
    store.projects.find((p) => p.edit?.batchId === batchId) ??
    null;
  // A stored copy can predate the approval (stage "features" with nothing
  // accepted); rebuilding it from the approved batch is the honest source.
  return existing?.edit ? existing : clientEditProject(review, batchId);
}

/**
 * The checkout on this PC the worktree is cut from.
 *
 * The bridge's own folder resolves to the hub's git toplevel, which is exactly
 * right for the owner's own apps. A client's own repo is not cloned here, and
 * guessing a path would be worse than saying so.
 */
function checkoutFor(review: ClientProject): string {
  const folder = knownFolder();
  if (!folder) {
    throw new CannotBuildHere("pc-off", "This browser hasn't heard from your PC yet, so there is no checkout to build in.");
  }
  const repo = (review.repo ?? "").trim().toLowerCase();
  if (repo && repo !== HUB_REPO.toLowerCase()) {
    throw new CannotBuildHere(
      "repo-not-here",
      `${review.repo} isn't checked out on this PC, so it can only be built from In Queue.`,
    );
  }
  return folder;
}

/**
 * What the thread is told.
 *
 * `editMasterPrompt` already carries the edits in the owner's words, the pins,
 * the skills, the checklist and the "never merge" rule. Two things are added:
 * where it is standing (a worktree, not a new folder), and how to finish here —
 * step 4 of its own <finish> assumes the Jarvis connector, which a harness
 * thread does not have, so it is replaced with printing the two links.
 */
export function harnessBrief(p: BuilderProject): string {
  const app = p.edit?.appPath ?? "";
  return [
    editMasterPrompt(p),
    "<where_you_are>\nYou are in a git worktree of the repository, on its own branch, cut for this job. The owner's own checkout is untouched. Work only inside this folder. The <context> line names a branch to create — you are already on the branch cut for this job, so ignore that name and push the one you are on.\n\nBEFORE you change anything: run `git fetch origin main`. If `git merge-base --is-ancestor origin/main HEAD` fails, the worktree was cut from another branch — rebase onto main then (`git rebase origin/main`). If that rebase is not trivial, stop, change nothing, and say so in one sentence: a build that carries someone else's branch cannot be pushed to main.\n</where_you_are>",
    [
      "<how_to_finish_here>",
      "Ignore step 4 of <finish>: this session has no Jarvis connector, so nobody else will post anything for you. Finish like this:",
      "1. Commit and push your branch.",
      "2. Open a pull request into main. Never merge it — the owner merges to go live.",
      `3. Wait for the Vercel preview of the branch. Check it opens without a login.${app ? ` The app is at ${app} on that preview.` : ""}`,
      "4. End your final message with exactly two lines, each on its own line and nothing after them:",
      "PR: <the pull request url>",
      `Preview: <the preview url${app ? ` + ${app}` : ""}>`,
      "If a link does not exist, write `Preview: none` and one sentence saying why. Never invent a URL.",
      "</how_to_finish_here>",
    ].join("\n"),
  ].join("\n\n");
}

/**
 * The two lines the thread is told to end on.
 *
 * Parsed here rather than by App Builder's `resultLinks`, which reads
 * `Repo:`/`Live:` — a client edit has no new repository, and the pull request
 * is the thing worth linking. Only http(s) is accepted, so a half-written
 * sentence never becomes a link the owner clicks.
 */
export function buildLinks(text: string): { pr?: string; preview?: string } {
  const pick = (label: string) => {
    const matches = [...text.matchAll(new RegExp(`^\\s*${label}:\\s*(\\S+)\\s*$`, "gim"))];
    const last = matches.at(-1)?.[1];
    if (!last) return undefined;
    const clean = last.replace(/[)\].,;]+$/, "");
    return /^https?:\/\/\S+$/i.test(clean) ? clean : undefined;
  };
  return { pr: pick("PR"), preview: pick("Preview") };
}

/**
 * Start the build. Throws `CannotBuildHere` when this PC can't do it (the
 * caller falls back to In Queue) and a plain Error when something else broke.
 */
export async function startClientEditBuild(review: ClientProject, batchId: string): Promise<StartedBuild> {
  const bucket = builderFor(review, batchId);

  // The probe comes first: it is what tells this browser where the PC's
  // checkout is, so a browser that has never met the bridge can still build.
  const health = await probe();
  if (!health.up) {
    throw new CannotBuildHere("pc-off", "Jarvis's PC helper isn't running, so nothing can be built here.");
  }
  if (!health.paired) {
    throw new CannotBuildHere("not-paired", "This browser isn't paired with the PC helper, so it can't start a build.");
  }
  const repo = checkoutFor(review);

  let threadId: string;
  try {
    const { session } = await call<{ session: { id: string } }>("harness/start", {
      harness: "claude",
      title: `${review.name} ${bucket.edit?.version ?? ""}`.trim() + " client edits",
      // A worktree, not a project folder: these edits belong to a repo that
      // already exists.
      repo,
      laneWrites: true,
      // Same reasoning as App Builder's build: a thread stands in its own
      // worktree, so writes there are the job. Anything outside it, and
      // anything grave, still stops and asks.
      trust: "trusted",
    });
    threadId = session.id;
    await call("harness/say", { id: threadId, text: harnessBrief(bucket) });
  } catch (e) {
    if (e instanceof BridgeError && e.status === 0) {
      throw new CannotBuildHere("pc-off", "The PC helper stopped answering while the build was starting.");
    }
    throw new Error(e instanceof Error ? e.message : "The build didn't start.");
  }

  // Keep the project, so the console can open it and a reload still finds it.
  const store = readStore();
  writeStore({
    projects: [bucket, ...store.projects.filter((p) => p.id !== bucket.id)],
    currentId: store.currentId,
  });

  return { threadId, builderId: bucket.id };
}

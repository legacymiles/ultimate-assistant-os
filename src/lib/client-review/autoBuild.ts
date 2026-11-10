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
// Nothing is filed anywhere. There is no queue behind this button: it either
// starts a real build on this PC or it says, in one sentence, which of the
// three things is missing. A request parked in a list nobody works is not a
// build, and pretending otherwise is what left an approved batch sitting at
// "building" with nothing behind it.
//
// The base is the other half of the fix. A worktree is cut from whatever branch
// the bridge's own checkout happens to be standing on, and that checkout is
// routinely months behind `main` with work of its own on top. A build cut from
// there cannot be pushed to main (it would carry that branch with it), so the
// brief used to tell the agent to rebase and stop if it could not — which is
// exactly what it did every time, changing nothing. So the worktree is reset
// onto `origin/main` before the agent is told anything: HEAD is the shipped
// site and nothing else, whatever the owner's checkout is doing.
// ---------------------------------------------------------------------------

import { clientEditProject, editMasterPrompt } from "@/lib/app-builder/clientEdit";
import type { BuilderProject } from "@/lib/app-builder/types";
import { readStore, writeStore } from "@/lib/app-builder/useAppBuilder";
import { BridgeError, call, knownFolder, probe } from "@/lib/new-jarvis/bridge";
import { buildHarness } from "@/lib/new-jarvis/harness/choice";
import { HUB_REPO } from "./apps";
import { buildModelFor, buildsWithPick, pickValue } from "./models";
import { readTrust } from "@/lib/new-jarvis/trust";
import { readChatModel } from "@/lib/new-jarvis/useChatModel";
import type { ClientProject } from "./types";

/**
 * Why this PC can't build it. Values rather than a message the caller has to
 * parse, so each one can be shown with the right thing to do next. There is no
 * fallback behind any of them: the batch stays approved and build is pressed
 * again once the PC is there.
 */
export type CannotBuildReason = "pc-off" | "not-paired" | "repo-not-here" | "blocked-by-browser";

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
  /** The Claude Code model it is actually running on, from the project's pick. */
  model: string;
  /** The commit the worktree was stood on, short. Always shipped main. */
  base: string;
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
 * where it is standing (a worktree, not a new folder), and how to finish here.
 *
 * Both additions override the shared prompt rather than editing it, because
 * App Builder's own engine uses the same function. Its <finish> step 4 and its
 * <constraints> both assume the Jarvis connector and the owner's queue — a
 * harness thread has neither, and a build that "queue_notes the owner" when a
 * check fails is a build whose failure nobody ever reads. So everything it has
 * to say, it says in its own final message.
 */
export function harnessBrief(p: BuilderProject): string {
  const app = p.edit?.appPath ?? "";
  return [
    editMasterPrompt(p),
    [
      "<where_you_are>",
      "You are in a git worktree of the repository, on its own branch, cut for this job and ALREADY reset to `origin/main`: HEAD is the shipped site plus nothing. The owner's own checkout is untouched. Work only inside this folder. The <context> line names a branch to create; you are already on the branch cut for this job, so ignore that name and push the one you are on.",
      "Do not rebase, reset, merge or fetch anything before you start. The base is already correct, and moving it is how a build ends up carrying someone else's branch onto main.",
      "`node_modules` here is a link to another checkout of this same repo, so it may be older than this branch. Use it for `npx tsc` and `npx vitest`. If a package is genuinely missing, say so in your final message, and never run `npm install` in this folder: it writes into that other checkout's packages.",
      "</where_you_are>",
    ].join("\n\n"),
    [
      "<how_to_finish_here>",
      "Ignore step 4 of <finish>, and ignore the `queue_note` in <constraints>: this session has no Jarvis connector and no queue, so nobody else will post or read anything for you. If a check fails, say so in your final message — that is the only place it will be seen. Finish like this:",
      "1. Commit and push your branch.",
      "2. Open a pull request into main, and merge it yourself with `gh pr merge <number> --squash --delete-branch` once its checks pass. You have full access for this: do not stop for permission, and do not leave the merge to the owner. If it conflicts, fetch origin/main, merge it, resolve the conflicts, push, and merge.",
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

/** One git command in the thread's own worktree, through the PC helper. */
async function git(where: string, args: string): Promise<{ ok: boolean; said: string }> {
  const out = await call<{ ok?: boolean; exitCode?: number | null; stdout?: string; stderr?: string }>("shell", {
    command: `git -C "${where}" ${args}`,
    timeoutMs: 180_000,
  });
  const said = `${out.stdout ?? ""}\n${out.stderr ?? ""}`.trim();
  return { ok: out.ok === true && (out.exitCode ?? 0) === 0, said };
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
}

/**
 * Stand the fresh worktree exactly on shipped main, and say which commit.
 *
 * This is the whole reason client edits now land. The bridge cuts a worktree
 * from its own checkout's HEAD, and that checkout lives on a long-running
 * branch hundreds of commits behind `origin/main` with work of its own on top,
 * so every build either refused to start (the brief told it to) or produced
 * a branch that could never be pushed to main. A worktree seconds old has
 * nothing of its own to lose, so resetting it is free and exact.
 *
 * Three separate calls, not one chained line: this bridge runs Windows
 * PowerShell 5, which refuses `&&`, and the owner should be told which step
 * failed rather than "the command failed".
 */
async function standOnMain(where: string): Promise<string> {
  const fetched = await git(where, "fetch origin main");
  if (!fetched.ok) {
    throw new Error(`The build couldn't fetch main, so it wasn't started: ${firstLine(fetched.said) || "git gave no answer"}`);
  }
  const reset = await git(where, "reset --hard FETCH_HEAD");
  if (!reset.ok) {
    throw new Error(`The build couldn't stand on main, so it wasn't started: ${firstLine(reset.said) || "git gave no answer"}`);
  }
  const at = await git(where, "rev-parse --short HEAD");
  return at.ok ? firstLine(at.said) : "";
}

/**
 * Start the build, here, now, on this PC.
 *
 * Throws `CannotBuildHere` when this PC cannot do it and a plain Error when
 * something else broke. Either way nothing is filed and nothing is queued: the
 * batch stays approved, the caller shows the sentence, and pressing build again
 * is the retry.
 */
export async function startClientEditBuild(review: ClientProject, batchId: string): Promise<StartedBuild> {
  const bucket = builderFor(review, batchId);
  // The Chat's model pick is the harness pick too. Claude Code can only run a
  // Claude model, so a Claude pick is honoured and anything else leaves the
  // project's own choice (which is also Claude) in place.
  const chosen = readChatModel();
  const projectPick = pickValue(review);
  const pick = chosen && (buildsWithPick(chosen) || chosen === "claude-subscription") ? chosen : projectPick;
  const model = buildModelFor(pick);

  // The probe comes first: it is what tells this browser where the PC's
  // checkout is, so a browser that has never met the bridge can still build.
  const health = await probe();
  if (!health.up) {
    // Two different failures that used to read as one. Telling someone to
    // start a helper that is already running is worse than saying nothing.
    if (health.needsLocalNetwork) {
      throw new CannotBuildHere(
        "blocked-by-browser",
        `${health.problem ?? "This browser is blocking this site from reaching your PC."} Your PC helper may well be running — this is the browser, not the helper.`,
      );
    }
    throw new CannotBuildHere("pc-off", "Jarvis's PC helper isn't running, so nothing can be built here. Start it on that PC and press build again.");
  }
  if (!health.paired) {
    throw new CannotBuildHere("not-paired", "This browser isn't paired with the PC helper, so it can't start a build. Pair it in Jarvis on that PC and press build again.");
  }
  const repo = checkoutFor(review);

  let threadId = "";
  let base = "";
  try {
    const { session } = await call<{ session: { id: string; worktree?: { path?: string } } }>("harness/start", {
      harness: buildHarness(),
      title: `${review.name} ${bucket.edit?.version ?? ""}`.trim() + " client edits",
      // A worktree, not a project folder: these edits belong to a repo that
      // already exists.
      repo,
      laneWrites: true,
      // Same reasoning as App Builder's build: a thread stands in its own
      // worktree, so writes there are the job. Anything outside it, and
      // anything grave, still stops and asks.
      trust: readTrust(),
      // The owner's pick, honoured. Empty would silently use whatever Claude
      // Code defaults to, which is not what the menu promised.
      model,
      // A build belongs to the PC, not to the tab that pressed the button.
      // The bridge writes this down and resumes it after a restart; the brief
      // is recorded now, before `standOnMain` and before the agent is told
      // anything, so a closed tab cannot lose the instructions either.
      durable: true,
      brief: harnessBrief(bucket),
    });
    threadId = session.id;
    const where = session.worktree?.path ?? "";
    if (!where) {
      throw new Error("The PC helper started a thread without a worktree, so there is nowhere to build.");
    }
    // Before the agent is told anything, so it never sees the wrong base.
    base = await standOnMain(where);
    await call("harness/say", { id: threadId, text: harnessBrief(bucket) });
  } catch (e) {
    // A thread that was started but cannot be based correctly is stopped rather
    // than left running on the wrong tree with no brief.
    if (threadId) await call("harness/stop", { id: threadId }).catch(() => {});
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

  return { threadId, builderId: bucket.id, model, base };
}

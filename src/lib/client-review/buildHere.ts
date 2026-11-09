"use client";

// ---------------------------------------------------------------------------
// Build it from the page you are editing.
//
// The owner never leaves the app they are looking at: Send & build approves
// the edits and starts Claude Code on the PC, the Chat Intake narrates it, and
// the finished preview is put on the version from the same page. Admin is for
// shipping to clients — their own repo and Vercel — not for babysitting a
// build.
//
// Approving and starting are one action. If the start fails, the approval is
// undone (the version is removed, the edits go back to waiting), because half
// of that action is what used to leave a version saying "building" with
// nothing behind it.
// ---------------------------------------------------------------------------

import { admin } from "./client";
import { CannotBuildHere, startClientEditBuild } from "./autoBuild";
import type { ClientProject, ReviewVersion } from "./types";

export interface BuildStarted {
  state: "working" | "failed";
  /** "v3" once a version was opened. */
  version?: string;
  message: string;
}

/** Edits waiting on the owner, on any version: what Build would build. */
export function waitingBatch(project: ClientProject) {
  return project.batches.find((b) => b.status === "pending") ?? null;
}

/**
 * Approve whatever is waiting and start building it on this PC.
 *
 * `versionId` narrows it to edits on that version (Send & build passes the one
 * it just sent); without it, the first waiting batch is built — a client's
 * requests, or edits a failed start handed back.
 */
export async function approveAndStart(token: string, versionId?: string): Promise<BuildStarted> {
  const { project } = await admin.byToken(token);
  const batch = versionId
    ? project.batches.filter((b) => b.versionId === versionId && b.status === "pending").at(-1)
    : waitingBatch(project);
  if (!batch) return { state: "failed", message: "There are no edits waiting to be built." };
  if (!project.repo) {
    return {
      state: "failed",
      message: "This site has no GitHub repo yet, so there's nothing to build in. Add it under Ship › Where the site lives.",
    };
  }

  const out = await admin.act<{ project: ClientProject; version: ReviewVersion }>({
    action: "approve",
    id: project.id,
    batchId: batch.id,
  });
  try {
    const started = await startClientEditBuild(out.project, batch.id);
    await admin.act({
      action: "buildQueued",
      id: out.project.id,
      batchId: batch.id,
      builderId: started.builderId,
      threadId: started.threadId,
    });
    return { state: "working", version: out.version.number, message: `Claude Code is building ${out.version.number} with ${started.model}.` };
  } catch (e) {
    const why =
      e instanceof CannotBuildHere || e instanceof Error ? e.message : "The build didn't start.";
    await admin.act({ action: "buildFailed", id: out.project.id, batchId: batch.id, message: why }).catch(() => null);
    const undone = await admin
      .act({ action: "cancelBuild", id: out.project.id, versionId: out.version.id })
      .then(() => true)
      .catch(() => false);
    return {
      state: "failed",
      message: undone
        ? `${why} Your edits are still waiting — press Build when that's sorted.`
        : `${why} ${out.version.number} is stuck on building; stop it from the chat and try again.`,
    };
  }
}

/** The finished build's preview becomes what this page shows. */
export function publishBuilt(projectId: string, versionId: string, url: string) {
  return admin.act({ action: "ready", id: projectId, versionId, siteUrl: url });
}

/** Stop a build and hand its edits back. The thread is killed by the caller first. */
export function removeBuild(projectId: string, versionId: string) {
  return admin.act({ action: "cancelBuild", id: projectId, versionId });
}

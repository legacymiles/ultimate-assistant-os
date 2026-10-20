"use client";

// ---------------------------------------------------------------------------
// Client Review → App Builder.
//
// "Approve & build" (or "Build in App Builder" on a version that's building)
// in the owner's Client Review console calls this, in the owner's tab: the
// approved batch becomes an App Builder project in edit mode (synced, so it is
// on every device), it is queued for Claude Code straight away, and Client
// Review records where it went. The owner doesn't have to open App Builder at
// all — it's there to look at or tweak, and re-queue if they change the list.
// ---------------------------------------------------------------------------

import { chatMsg } from "./engine";
import { clientEditProject } from "./clientEdit";
import { noteBuildInReview, postToQueue } from "./queue";
import { readStore, writeStore } from "./useAppBuilder";
import type { ClientProject } from "../client-review/types";
import type { BuilderProject } from "./types";

export interface ClientEditHandOff {
  project: BuilderProject;
  queueId?: string;
  /** "/apps/app-builder?p=<id>" */
  url: string;
}

/** The App Builder project already made for this batch, on this device's copy of the store. */
export function builderFor(batchId: string): BuilderProject | null {
  return readStore().projects.find((p) => p.edit?.batchId === batchId) ?? null;
}

/**
 * Make (or reuse) the batch's App Builder project and queue it. `note: false`
 * when the caller records the build in Client Review itself (the console does,
 * so its own state updates from the answer).
 */
export async function buildClientEdit(
  review: ClientProject,
  batchId: string,
  { note = true }: { note?: boolean } = {},
): Promise<ClientEditHandOff> {
  // A batch is only ever one project: re-queue the one that exists.
  const existing = builderFor(batchId) ?? (() => {
    const id = review.batches.find((b) => b.id === batchId)?.build?.builderId;
    return id ? readStore().projects.find((p) => p.id === id) ?? null : null;
  })();
  const p = existing ?? clientEditProject(review, batchId);

  const queueId = await postToQueue(p);
  if (note) await noteBuildInReview(p, queueId);

  const at = new Date().toISOString();
  const queued: BuilderProject = {
    ...p,
    updatedAt: at,
    handoff: { ...p.handoff, at, queueId: queueId ?? p.handoff?.queueId },
    chat: [
      ...p.chat,
      chatMsg(
        "agent",
        queueId
          ? `Queued as ${queueId} from Client Review. Claude Code builds it on ${p.edit!.branch}, opens a pull request for you to merge, and posts the preview to ${p.edit!.clientName || "the client"}'s link as ${p.edit!.version}.`
          : "That exact build is already in the queue.",
      ),
    ],
  };
  const s = readStore();
  writeStore({ projects: [queued, ...s.projects.filter((x) => x.id !== queued.id)], currentId: s.currentId });
  return { project: queued, queueId, url: `/apps/app-builder?p=${encodeURIComponent(queued.id)}` };
}

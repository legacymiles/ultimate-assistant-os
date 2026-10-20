"use client";

// ---------------------------------------------------------------------------
// App Builder → In Queue, and (for a client edit) the note back to Client
// Review saying which App Builder project and queue request carry the batch.
// One place, used by App Builder's Build it and by Client Review's
// "Approve & build", so both hand off the same way.
// ---------------------------------------------------------------------------

import { queueText } from "./engine";
import type { BuilderProject } from "./types";

export const QUEUE_FOLDER = "app:app-builder";

/** Queue the build. Returns the request id, or undefined when that exact build is already queued. */
export async function postToQueue(p: BuilderProject): Promise<string | undefined> {
  const res = await fetch("/api/new-jarvis/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "add",
      folder: QUEUE_FOLDER,
      text: queueText(p),
      images: (p.keyframes ?? []).slice(0, 4),
      from: p.edit ? "client-review" : "app-builder",
    }),
  }).catch(() => null);
  const data = (await res?.json().catch(() => ({}))) as { added?: { id: string }[]; error?: string } | undefined;
  if (!res || !res.ok) throw new Error(data?.error || "In Queue didn't take it. Sign in to Jarvis and try again.");
  return data?.added?.[0]?.id;
}

/** Tell Client Review the batch is on its way. Best-effort: the build is queued either way. */
export async function noteBuildInReview(p: BuilderProject, queueId: string | undefined): Promise<boolean> {
  if (!p.edit) return false;
  const res = await fetch("/api/client-review/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "buildQueued", id: p.edit.reviewId, batchId: p.edit.batchId, builderId: p.id, queueId }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

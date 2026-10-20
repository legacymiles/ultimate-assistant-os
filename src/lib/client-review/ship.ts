// ---------------------------------------------------------------------------
// Client Review — telling the client, and posting a finished build.
//
// `tell` pushes the newest notice to the client's devices (the owner's console
// uses it after approve / reject / ready). `shipPreviewNow` is the other end of
// the App Builder hand-off: when Claude Code has built an approved batch and
// Vercel has deployed its preview, the jarvis-memory connector's
// `client_review_preview` tool lands here. The preview becomes the version on
// the client's screen, the client is told, and the owner's feed says so — with
// nobody pasting a URL by hand.
// ---------------------------------------------------------------------------

import "server-only";

import { dropPushSubs, pushEvent, ReviewError, shipPreview, upsertIndex } from "./logic";
import { pushToClient } from "./push";
import { readProject, updateIndex, updateProject, writeProject } from "./store";
import type { ClientNotice, ClientProject, ReviewVersion } from "./types";

/** Push the newest notice to the client's devices, and forget any that are gone. */
export async function tell(p: ClientProject, notice: ClientNotice | undefined, origin: string): Promise<ClientProject> {
  if (!notice) return p;
  const { gone } = await pushToClient(p, {
    title: notice.title,
    body: notice.body,
    url: `${origin}/apps/client-review?site=${p.token}`,
    tag: `client-review-${p.id}`,
  });
  if (!gone.length) return p;
  const next = dropPushSubs(p, gone);
  await writeProject(next).catch(() => {});
  return next;
}

export interface ShipInput {
  reviewId: string;
  versionId: string;
  siteUrl: string;
  prUrl?: string;
  branch?: string;
  summary?: string;
}

export async function shipPreviewNow(
  input: ShipInput,
  origin: string,
): Promise<{ project: ClientProject; version: ReviewVersion; already: boolean }> {
  if (!input.reviewId) throw new ReviewError("Give review_id (it's in the queue request).");
  if (!(await readProject(input.reviewId))) throw new ReviewError("No Client Review project with that review_id.", 404);
  const { project, result } = await updateProject(input.reviewId, (p) => {
    const out = shipPreview(p, input);
    return { project: out.project, result: { version: out.version, already: out.already } };
  });
  if (result.already) return { project, version: result.version, already: true };

  const told = await tell(project, project.notices.at(-1), origin);
  await updateIndex((i) =>
    pushEvent(
      upsertIndex(i, told),
      told,
      "preview_sent",
      `${result.version.number} built by Claude Code and sent to ${told.clientName || "the client"}`,
    ),
  );
  return { project: told, version: result.version, already: false };
}

"use client";

// ---------------------------------------------------------------------------
// App Builder → Client Review.
//
// Client Review already fed App Builder (a client's approved edits become an
// App Builder project — ../client-review/autoBuild.ts). This is the other half, and it
// is what makes the loop a loop: the moment a build is handed off, a review
// link is opened for it, and the queue brief tells Claude Code to post the
// deployed app to that link as its last step.
//
// So the owner never pastes a URL anywhere. The app appears on a private link,
// anyone they send it to can tap the page and ask for a change in their own
// words, and the change comes back here as an App Builder edit. Checklist C6.
// ---------------------------------------------------------------------------

import type { BuilderProject, ReviewLink } from "./types";

/** The private link the owner shares. Also what Client Review opens itself at. */
export function reviewHref(token: string): string {
  return `/apps/client-review?site=${token}`;
}

/** What the reviewer reads under the version: one plain line per feature. */
export function reviewSummary(p: BuilderProject): string {
  const accepted = p.features.filter((f) => f.status === "accepted");
  const head = p.understanding ? `${p.understanding.name} — ${p.understanding.oneLiner}` : p.idea;
  return [head, "", ...accepted.map((f) => `• ${f.title}`)].join("\n").slice(0, 4000);
}

/**
 * Open the review link for this build, or add the next version to the one it
 * already has. Returns the link, or throws a sentence worth showing.
 */
export async function openReview(p: BuilderProject, clientName?: string): Promise<ReviewLink> {
  const had = p.handoff?.review;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch("/api/client-review/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        action: "fromBuilder",
        ...(had ? { id: had.id } : {}),
        name: p.understanding?.name ?? p.idea.slice(0, 60),
        clientName: clientName ?? had?.clientName ?? "",
        summary: reviewSummary(p),
      }),
    });
  } catch (e) {
    throw new Error(
      e instanceof DOMException && e.name === "AbortError"
        ? "Client Review didn't answer in time, so no review link was opened. The build is still queued."
        : "Couldn't reach Client Review, so no review link was opened. The build is still queued.",
    );
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as {
    project?: { id: string; token: string; clientName?: string };
    version?: { id: string; number: string };
    error?: string;
  };
  if (!res.ok || !data.project || !data.version) {
    throw new Error(data.error || "Client Review couldn't open a link for this build. The build is still queued.");
  }
  return {
    id: data.project.id,
    versionId: data.version.id,
    token: data.project.token,
    number: data.version.number,
    clientName: data.project.clientName || undefined,
    at: new Date().toISOString(),
  };
}

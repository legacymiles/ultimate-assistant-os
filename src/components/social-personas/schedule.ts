"use client";

// Keeping the server's posting queue in step with a draft. Called whenever a
// draft's time, accounts or content changes: accounts with auto-post get a
// queue job (replacing any earlier one — never a second post), the rest get
// a reminder when the time comes. Returns the draft with fresh results.

import { captionFor, withResult } from "@/lib/social-personas/studio";
import { isConnectable, type Draft, type Persona } from "@/lib/social-personas/types";
import { api, type PublicJob, type ScheduleRequest } from "./api";

export function autoAccounts(p: Persona, d: Draft) {
  return p.accounts.filter((a) => d.accountIds.includes(a.id) && a.connectionId && a.canPost && isConnectable(a.platform));
}

/** Why an account in this draft can't auto-post yet, or null when it can. */
export function blocker(p: Persona, d: Draft, accountId: string): string | null {
  const a = p.accounts.find((x) => x.id === accountId);
  if (!a) return "account removed";
  if (!isConnectable(a.platform)) return "reminder";
  if (!a.connectionId) return "connect to auto-post";
  if (!a.canPost) return "turn on auto-post";
  if (!d.media && a.platform !== "facebook") return "add a video";
  return null;
}

export async function pushSchedule(
  p: Persona,
  d: Draft,
  opts: { now?: boolean; applyJobs: (jobs: PublicJob[]) => void },
): Promise<{ draft: Draft; error?: string }> {
  const done = new Set(d.results.filter((r) => r.status === "posted" || r.status === "inbox" || r.status === "manual").map((r) => r.accountId));
  const wanted = Boolean(d.scheduledAt || opts.now);
  const targets = wanted ? autoAccounts(p, d).filter((a) => !blocker(p, d, a.id) && !done.has(a.id)) : [];
  const targetIds = new Set(targets.map((a) => a.id));
  let draft = d;

  // Jobs that shouldn't exist any more (taken off the calendar, account
  // unticked, video removed): cancel them on the server and here.
  const stale = d.results.filter((r) => (r.status === "queued" || r.status === "failed") && !targetIds.has(r.accountId)).map((r) => r.accountId);
  if (stale.length) {
    await api.unschedule(d.id, stale);
    draft = { ...draft, results: draft.results.filter((r) => !stale.includes(r.accountId)) };
  }

  let error: string | undefined;
  if (targets.length) {
    const reqs: ScheduleRequest[] = targets.map((a) => ({
      personaId: p.id,
      draftId: d.id,
      accountId: a.id,
      connectionId: a.connectionId!,
      platform: a.platform as ScheduleRequest["platform"],
      title: d.title,
      caption: captionFor(d, a.platform),
      media: d.media,
      runAt: d.scheduledAt ?? new Date().toISOString(),
    }));
    const r = await api.schedule(reqs, opts.now);
    if (!r.ok) error = r.error;
    else {
      for (const j of r.data.jobs) {
        if (j.status === "cancelled") continue;
        draft = withResult(draft, { accountId: j.accountId, status: j.status, url: j.url, error: j.error ?? j.note, at: j.updatedAt });
      }
      opts.applyJobs(r.data.jobs);
    }
  }

  if (draft.stage !== "posted") {
    const queued = draft.results.some((x) => x.status === "queued" || x.status === "publishing");
    draft = { ...draft, stage: queued || draft.scheduledAt ? "scheduled" : draft.stage === "scheduled" ? "ready" : draft.stage };
  }
  return { draft, error };
}

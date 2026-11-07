# Vercel Pro — keeping the bill small and the site up

Written 2026-11-07, when the hub moved from Hobby to Pro after hitting the
deployments-per-day cap.

## What changed by moving to Pro

Hobby used **hard caps**: cross a limit and the project stops serving until the
cycle resets. That is why the site was not reliably up.

Pro **bills overage instead of cutting you off**. It includes a $20 monthly
usage credit and 1 TB of Fast Data Transfer, and charges beyond that. So the
uptime problem is solved, and the new risk is a surprise bill rather than
downtime. Everything below is about managing that new risk.

---

## 1. The deployment cap — fixed in code

`vercel.json` now restricts which branches deploy automatically:

```json
{
  "git": {
    "deploymentEnabled": { "**": false, "main": true, "jarvis/*": true }
  }
}
```

**Why this was the real problem.** The repo had **39 remote branches** and 60
commits to `main` in a single week, with several worktrees and parallel Claude
sessions all pushing. *Every push to any branch created a preview deployment.*
The daily cap was being eaten by branch previews, not by actual work on the
site.

- `main` still deploys production, as before.
- `jarvis/*` still deploys previews, because Client Review's "Approve & build"
  flow posts a Vercel preview URL back to the client from those branches
  (`src/lib/client-review/ship.ts`). Breaking that would break the product.
- Everything else no longer deploys. To deploy a branch deliberately, use
  `vercel deploy` from the CLI, or open a PR and merge it.

**A trap worth knowing:** the "Ignored Build Step" project setting does *not*
help with the deployment cap. Vercel's docs are explicit: "Canceled builds are
counted as full deployments... any canceled builds initiated using the ignore
build step will still count towards your deployment quotas." It saves build
minutes, not deployments. Only *not deploying* saves a deployment.

## 2. Function invocations — the slow leak

The hub is full of polling hooks. Most are harmless: they tick local state
(a clock, a vibration pattern, a localStorage queue) and never reach a server.
A poll only costs money when it calls a route.

Audited 2026-11-07:

- `useRequests.ts` (15s) — already checks `document.visibilityState`. Fine.
- `useUpdates.ts` (60s) — already visibility-aware. Fine.
- `YourPc.tsx` (5s, `/api/mp3-download/bridge`) — **was not gated.** A single
  forgotten background tab was ~17,000 billed calls a day. Now it only polls
  while the tab is in front, and reads immediately on focus, so the UX is
  unchanged.

**The rule when adding a poll:** if the callback touches `fetch`, gate it on
`document.visibilityState === "visible"` and re-read on `visibilitychange` and
`focus`. A poll that only moves local state does not need it.

### What was deliberately left alone

131 API routes declare a `maxDuration`, 27 of them at the 300s maximum. That
looks alarming and is not. `maxDuration` is a **ceiling, not consumption** —
and Vercel bills **Active CPU**, not wall-clock time. These are AI and video
routes that spend almost all of their time waiting on a model or an upstream
API, which is idle time, not CPU. Lowering the ceilings would buy nothing and
would start truncating long generations.

Relatedly, keep **Fluid Compute** on (it is the default). It reuses function
instances across concurrent requests, so waiting-heavy routes like these share
an instance instead of each paying a cold start.

## 3. Spend management — do this in the dashboard

Claude cannot change billing settings, so this part is yours.

1. **Vercel dashboard → your team → Settings → Billing → Spend Management.**
2. Set an **on-demand budget**. New teams default to $200, which is far more
   than this project should ever reach. Something like **$30–50** gives real
   headroom over the included $20 without room for a nasty surprise.
3. Turn **notifications on** at 50% / 75% / 100%.
4. **Leave "pause projects at 100%" OFF** — unless a hard stop matters more to
   you than uptime. Turning it on recreates exactly the Hobby behaviour you
   left: the site goes dark when the number is hit. Alerts give you the
   warning without the outage.

Be aware the cap reacts on a delay — Vercel evaluates spend every few minutes,
so it is a safety net, not a hard wall. The protections in sections 1, 2 and 4
are what actually keep the number low.

## 4. Firewall — the public routes

Most of the hub sits behind the Supabase login wall, so random traffic cannot
reach it. But `src/middleware.ts` deliberately exempts some routes, because
their callers are not browsers and have no session — the iPhone Shortcuts, the
PC Game Creator builder, and the public crash-report ingest.

Those routes are reachable by anyone on the internet. They verify a token and
reject bad callers, **but rejecting a request still costs an invocation.**

In **Project → Firewall**, add a rate-limit rule on those paths (a few requests
per minute per IP is generous for a Shortcut), and keep **Attack Challenge
Mode** in mind as the switch to flip if traffic ever spikes.

## 5. Worth checking once

- **Settings → Git → "Automatically cancel outdated builds"** should be on, so
  pushing twice quickly doesn't build twice.
- The GitHub Action `.github/workflows/personas-tick.yml` runs every 15 minutes
  (96 calls/day). That is deliberate and cheap, but it is the one scheduled
  thing that runs whether or not anyone is using the site.

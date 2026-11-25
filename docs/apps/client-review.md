# Client Review

Route: `/apps/client-review` · Category: AI · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- client-review "what to change"`.

## What it does

Send each website client a private link: their site fills the screen with a draggable Chat Intake on top, where they type as many edit requests as they like, point at the exact spot they mean, and press Send to Jarvis. The batch lands with you to approve, reword or reject; Improve with AI turns it into a build brief (Claude first, an uncensored model when a site's content is off-limits for Claude). Approving opens the next version in the Projects Timeline, and posting its URL notifies the client by push.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Send clients their site, collect edit requests, ship v2** — /review/<code>: private client link (no account). Site fills the screen (desktop/phone preview), with a draggable, resizable Chat Intake that shrinks to an orb (bottom sheet on phones). Clients add m…
- **Plans now say how you'll know each feature works** — Planning was the weak link: a feature was a title, what it does and why, and nothing in it said how anyone would know it works. So every board card got the same generic acceptance criteria, the build…
- **"Take it live anyway" works when nothing checked it** — Marking the verify report accepted was the whole of that button, and it does nothing in the state it is most likely to be pressed in: when the gate never ran there is no report to accept, so the pres…
- **Ship takes a move live on one press, if the checks pass** — One press now means the press and nothing else. The panel records the pull request the moment Claude says `PR:`, and then, if the PC's own gate passed, lands it with `shipThread` — main merged in, br…
- **One press moves an app in, and the press is followed** — Moving BuildFlip 2 into the hub took a press and then an hour by hand. Four separate things made that happen, and each is fixed here rather than worked around:
- **A move needs a site in the repo, and lands on App plugins**
- **Connect to this PC connects, and Move it into the hub starts**
- **Built only after your PC has checked it, with the failing checks on screen**
- **Ship hands a site over in two presses, and the picker is one A-Z list** — Ship was a screen of controls that shipped nothing. Everything that only configures a project - the repo and Vercel fields, the brief model, the timeline link, New link, Release, Archive, Delete - is…
- **The live line shows the newest thing, once**
- **One live line while the coding harness works**
- **Keep going when the tab closes, the bridge restarts, or a limit hits** — A build was a harness thread in the bridge and a row on the server, but nothing on the PC remembered it. Closing the tab left the thread running invisibly; a bridge restart (an update, a wake, a rein…
- **The building stage tells the truth when a build stops**
- **Watch it build opens the app's own building stage**
- **Capture only the version on screen**

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/client-review` — public
- `src/app/api/client-review/`
- `src/components/client-review/`
- `src/lib/client-review/`

### Sign-in & who can use it

- Google sign-in — one tap + button (src/lib/auth/google.ts) — `src/components/client-review/SignInGate.tsx`
- Needs a signed-in user (requireUser / auth.getUser) — `src/lib/client-review/viewer.ts`
- Owner-only check (requireOwner / isOwner) — `src/lib/client-review/viewer.ts`

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET POST | `/api/client-review/admin` | owner's sign-in |
| GET POST | `/api/client-review/portal/[token]` | public |
| GET | `/api/client-review/portal/building` | public |
| GET | `/api/client-review/portal/me` | public |
| GET | `/api/client-review/portal/mine` | public |

### Data & database rules

- Server docs (server_docs via readDoc/writeDoc) — `src/lib/client-review/push.ts`, `src/lib/client-review/store.ts`

### Keys & outside services

- `CLIENT_REVIEW_STANDARD_MODELS` — `src/app/api/client-review/admin/route.ts`, `src/lib/client-review/brief.ts`
- `CLIENT_REVIEW_UNCENSORED_MODELS` — `src/app/api/client-review/admin/route.ts`, `src/lib/client-review/brief.ts`
- `CLIENT_REVIEW_VAPID_PRIVATE_KEY` — `src/lib/client-review/push.ts`
- `CLIENT_REVIEW_VAPID_PUBLIC_KEY` — `src/lib/client-review/push.ts`
- `CLIENT_REVIEW_VAPID_SUBJECT` — `src/lib/client-review/push.ts`
- `GITHUB_TOKEN` — `src/lib/client-review/github.ts`
- `HUB_OWNER_EMAILS` — `src/lib/client-review/viewer.ts`
- `JARVIS_GITHUB_TOKEN` — `src/lib/client-review/github.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/client-review/admin/route.ts`, `src/lib/client-review/brief.ts`

### Tests

- `src/lib/client-review/apps.test.ts`
- `src/lib/client-review/autoBuild.test.ts`
- `src/lib/client-review/build.test.ts`
- `src/lib/client-review/building.test.ts`
- `src/lib/client-review/contentCheck.test.ts`
- `src/lib/client-review/fromBuilder.test.ts`
- `src/lib/client-review/handover.test.ts`
- `src/lib/client-review/handoverPc.test.ts`
- `src/lib/client-review/list.test.ts`
- `src/lib/client-review/liveBuild.test.ts`
- `src/lib/client-review/logic.test.ts`
- `src/lib/client-review/look.test.ts`
- `src/lib/client-review/mockups.test.ts`
- `src/lib/client-review/models.test.ts`
- `src/lib/client-review/pushMain.test.ts`
- `src/lib/client-review/ship.test.ts`
<!-- code:end -->

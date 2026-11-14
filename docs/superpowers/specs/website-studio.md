# Website Studio — one home for building, redesigning and editing websites

Status: **in progress** (started 2026-11-13). Replaces App Builder, Website Redesigner and Client
Review as three places with one. Nothing old is deleted until the last section's checks pass.

Depth: `commercial`, Foundation **inherited and verified** (hub sign-in, Client Review's owner /
client boundary, `portalView` stripping) rather than rebuilt. Named bar: **Lovable's project
workspace** — prompt home, chat on the left, the live site on the right, a library of projects.

## 1. What was found (2026-11-13, `main` at `e05e17b`)

| | App Builder | Website Redesigner | Client Review |
|---|---|---|---|
| Size | ~11,900 lines | ~6,600 lines | ~13,400 lines |
| Entry | `/apps/app-builder` | redirects into App Builder `?section=redesign` | `/apps/client-review` (public, clients sign in) |
| Data | `app-builder:v1` synced blob (≤ 60 projects) | none of its own | one `server_docs` document per site + an index |
| Starts a build | `useBuild` → bridge `harness/start` | hands the site to App Builder | `autoBuild.ts` → bridge `harness/start` |
| Mockups | `MockupBakeOff`, one screen, three lanes | `EditStudio` (same component) | `LookPass` (same component) |

**"Super Harness"** is not a name in the code. It is the Jarvis harness: `tools/jarvis-bridge`
(`http://127.0.0.1:42020`), threads in git worktrees, polled with `harness/events`, gates answered
with `harness/decide`. No harness code knows about skills — **the stage order is prose in the
brief**, and before this work that prose ran Software Factory *before* the first site was live.

### Already shared
`MockupBakeOff` + `src/lib/mockup`, `useBuild` + `reduceEvents`, `ModelPicker`, the design
intelligence block.

### Duplicated — what consolidation removes
- **Thread followers ×4**: `BuildStatus` (App Builder), `BuildFeed`, `BuildThread`, `MoveThread`
  (Client Review). One side panel replaces them.
- **Design-skill lists ×6**: `design-skills.json` (34), `DESIGN_GUIDE` (33), `CANDIDATES` (12),
  `DESIGN_SKILLS` (9), blueprint `RULES` (5), the skins. None says which skills combine.
- **Stage order ×5**: `pipeline()`, `queueText`, the Blueprint strip, a chat sentence, board tickets.
- **Two start screens** (App Builder's composer, the Redesigner's URL box) and **two site lists**
  (Client Review's picker, App Builder's project select).
- **Two build paths for a client edit** whose prompts contradict (never merge / merge your own PR).

### Dead or fragile, to fix on the way through
- `/api/redesign` and the three-direction cards have no caller since the Redesigner hands off.
- `buildBrief` has no edit branch: "Build edits" inside App Builder starts an empty project.
- Picked mockup *pictures* and look-mode tweaks never reach the brief — only the skill name does.
- `readIndex` is non-strict: a database error during a write can replace the index with one
  project. Three archived test projects are already missing from it (harmless, but the same hole).
- Pins are viewport fractions with no page or scroll position.
- Claude threads emit no task list and no per-edit diffs; `verify_*` events are dropped by the page.
- `harness/preview` (a live local preview per worktree) exists but only the bake-off uses it, and
  it refuses new-app project threads.

## 2. The data that must survive

Live store, read 2026-11-13: **14 project documents, 11 in the index** — 10 hub apps and 1 client
site (BuildFlip 2). The 3 outside the index are archived tests. Baby No Scroll carries the most
history: 2 versions, 1 request, 1 approved batch, 7 notices, a screenshot.

Everything a site has lives **inside its own document**: versions, requests (with rewording and
notes), batches (brief, decision, build record), notices, mockups, push subscriptions. There is no
separate conversation table. Build narration lives in the PC bridge thread and is not stored.

Addresses in the wild that must keep working: `/apps/client-review?site=<token>`, `?app=<slug>`,
`?tab=admin`, `/review/<token>`, `/apps/client-review/manifest.webmanifest`,
`/client-review-sw.js` (scope `/apps/client-review`), `/api/client-review/admin` and `/portal/*`,
the connector tool `client_review_preview` (queued briefs already carry `crp_…` / `ver_…` ids),
`/apps/app-builder?p=<id>`, `?idea=`, `?section=`, and App Builder framed inside Jarvis.

## 3. The design

**Re-home, do not copy.** No document is rewritten, no id or link secret changes, no table is
added. The library reads Client Review's documents where they are; App Builder's blob stays the
store for a site that has not been built yet.

```
/apps/website-studio            owner's home: start + My Websites
/apps/website-studio?site=…     the workspace on a website        (owner)
/apps/website-studio?app=…      the workspace on a hub app        (owner)
/apps/website-studio?p=…        the workspace on a draft          (owner)
/apps/client-review?site=…      the SAME workspace, client mode   (unchanged address)
```

The client address does not move, because push subscriptions, iPhone Home Screen installs and the
service worker are scoped to it.

| Layer | Where | State |
|---|---|---|
| Stage order, ship-first, the after-live message | `src/lib/website-studio/pipeline.ts` | **built**, 13 tests |
| Design skills from the real roster, combination rules | `src/lib/website-studio/skills.ts` | **built**, 15 tests |
| My Websites: one list from three sources, search, filter | `src/lib/website-studio/library.ts` | **built**, 15 tests |
| Supporting pages and clickable flows (mockup stage 2) | `src/lib/website-studio/flows.ts` | **built**, 20 tests |
| Home, library, workspace, side panel | `src/components/website-studio/` | **built** (direction: Studio dark) |
| Page + catalog entry | `src/app/apps/website-studio/`, `catalog.ts` | **built**, record written |

### The eight stages, and when they run
Felix → Prompt Enhancer → **Mockups** (main design, then pages and flows) → Commercial → Design
Skill → Impeccable → **security check → site live** → Software Factory → Claude Security (deep).

How "after it is live" is made true, not just said:
1. The brief's skill order and a `<ship_first>` block tell the build to stop at a live address.
2. When the workspace sees the `Live:` / `Preview:` line it publishes the site, then says
   `factoryBrief()` into the **same thread** (`harness/say`), once (`shouldStartFactory`).
3. That turn ends on `Factory: done`. Each merged PR redeploys; the preview refreshes itself.
4. PC off: the queue line carries the same order in words.

### One workspace
Full-screen preview; a collapsible panel on the left with Chat (requests, notices, harness turns),
Activity (stage strip, live line, tool log, gates), Changes (`harness/status` + `harness/diff`),
Versions and Requests. It mounts `useBuild` and `reduceEvents` — no second reducer, no second
orchestrator. Clients get the same panel with the owner-only tabs removed.

Needs two small bridge changes to be complete: emit Claude's task list as a `plan` event, and let
`harness/preview` serve a new-app project thread. Until then the panel shows the tool log as tasks
and the preview shows the deployed address.

### Mockups in two stages
Stage 1 is today's bake-off (three lanes, pick one). Stage 2 is new: a `FlowPlan` — screens and the
journeys between them, derived from the accepted features — drawn in the picked look, each screen a
document whose links switch screens through the parent, with loading / empty / success / error
states and a note box per screen. The approved plan goes into the brief as the routes to build.

## 4. Migration, in order — each step verified before the next

1. **Shared logic** (done): order, skills, library; every existing suite still green.
2. **Add** `/apps/website-studio` beside the old apps. Nothing redirects yet.
3. **Verify the library against the live store**: 11 cards, same ids and tokens as the index;
   Baby No Scroll opens with its 2 versions, request, batch and 7 notices.
4. **Workspace replaces the popup chat** at `/apps/client-review?site=`, old screen kept behind
   `?classic=1`. Verify a client link signed out, as a client and as the owner; push still arrives.
5. **Starts**: prompt (+ reference images), URL redesign, skills — each creates the same
   `BuilderProject` App Builder made, so `?p=` links and Jarvis's `app_builder` tool keep working.
6. **Redirect** `/apps/app-builder` (not when framed inside Jarvis), `/apps/website-redesigner` and
   the owner's bare `/apps/client-review` into the Studio; add them to `MERGED_INTO`.
7. **Only then** delete: the four thread followers, the Redesigner V1 shell, `/api/redesign`, the
   old Chat Intake, the five extra skill lists.

Rollback at any step before 7 is removing a redirect.

Done so far: 1, 2 and 4. Step 4 kept the old screen behind `?classic=1`. Steps 3, 5 and 6 are
next; nothing from section 7 has been deleted, and every old route still stands on its own.

## 5. Design engines for stage two — why Google Stitch is not wired in

`FlowPlan.engine` is `"offline" | "ai" | "stitch"` so the screens can come from anywhere. Today
they come from the offline planner, which needs no key, no account and no PC.

Google Stitch (`github.com/google-labs-code/stitch-skills`, Apache-2.0, "not an officially
supported Google product") was inspected before anything was installed. It is **not** wired in,
for three reasons, each of which would have to change first:

1. **It is a quota-metered Google cloud service.** The MCP is remote — `https://stitch.googleapis.com/mcp`
   over HTTP with an `X-Goog-Api-Key` header minted from a Google account, or an OAuth path that
   needs the gcloud SDK and overwrites `.env`. Every generated screen is a Gemini-backed call on
   Google's servers against a per-account quota, and the prompt and any uploaded screenshot leave
   the machine. That is the opposite of the standing rule that generation is free and local
   (WanGP/Flux), so it belongs with `higgsfield-models`: opt-in by name only.
2. **Its build half fights this repo.** `stitch::react-components` emits Vite + React Router
   components, rewrites `href="#"` into `<Link>`, and merges the Stitch HTML's `tailwind.config`
   into the project theme. This hub is Next 15 App Router with Tailwind v4 (CSS-first, no config
   object).
3. **Its output is the shape the owner explicitly ruled out.** `generate-design` returns a static
   HTML page plus a PNG, with placeholder links; `react-components` adds `src/data/mockData.ts`.
   No routes, no state. `flows.ts` already enforces the opposite: a graph whose links must resolve,
   whose screens must be reachable, and whose brief says a screenshot is not the deliverable.

Worth taking, free and with no setup: the `enhance-prompt` convention (a one-line vibe
description, a required design-system block, a numbered page structure) — which is the shape
`flowsBrief` already writes — and `stitch-loop`'s SITE.md sitemap idea, which is what `FlowPlan`
is. The owner already has `taste-design` locally as `stitch-skill` (MIT, third-party author);
Google ships the same file under Apache-2.0. Note one collision if Stitch is ever switched on:
its design-system font list is a server-side enum of nine families **including Inter**, which the
owner's own `stitch-skill` bans.

Unverified and worth checking before any Stitch output reaches a paying client: Google states no
Stitch-specific commercial-use terms in the repo or the MCP docs, and the quota figures in
circulation come from third parties, not a Google page.

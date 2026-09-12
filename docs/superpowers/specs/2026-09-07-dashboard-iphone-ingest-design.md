# Dashboard — iPhone ingestion and the destination registry

**Date:** 2026-09-07
**Status:** approved, not yet implemented
**Scope decided:** all four phases (0, A, B, C) in one pass.
**Provider decided:** Vercel AI Gateway only; the OpenRouter fallback was declined.
**Supersedes:** nothing. Extends the Recall photos pipeline described in
`src/lib/seed-content/recall.ts`.

---

## Problem

Four things, shippable independently and in this order:

- **0.** The assistant cannot perform actions it is already fully built to perform,
  because no model is ever called. Highest priority — it makes the app feel broken.
- **A.** Recall is called Recall. The user thinks of it as their dashboard.
- **B.** Getting photos off an iPhone and into the app is manual and one-at-a-time.
  The user wants a quick "grab my recent photos" button and a hands-off sync.
- **C.** The photo triage can file into exactly three places (photo folders, the
  knowledge base, the calendar). The user wants it to file into *other hub apps* —
  first among them AI Rankings, where a screenshot of a GitHub repo should become a
  record named after the repo.

## What already exists (and is therefore not being rebuilt)

The Recall photos pipeline already implements the shape of C:

- One vision call per photo answers route + faces + filing fields together
  (`src/app/api/recall/photos/route.ts`). Splitting it would double cost and let
  the passes disagree.
- The review queue groups pending photos **by destination** and approves a whole
  group in one click (`src/components/recall/photos/ReviewQueue.tsx`).
- Nothing is written until the user approves.

Server-side storage also exists and is reused verbatim:
`src/lib/server/blobStore.ts` and `src/lib/server/docStore.ts` — private Supabase
bucket via the service role in the route layer, with a filesystem fallback for
local development.

So this design is two additions (an ingestion path, a pluggable destination) and
one rename. It introduces no new dependency.

---

## 0. The assistant never runs (highest priority)

### Diagnosis

Reported symptom: *"can u move my vps 2026 folder into a trading fx subfolder"*
returned `I found one relevant note: • coinexx — Website (in trading fx › coinexx
broker logins)`.

The cause is not model quality. **No model was called.**

- `src/app/api/recall/route.ts:103` — `if (!apiKey || !body.question) return
  NextResponse.json({ reply: null })`.
- `AI_GATEWAY_API_KEY` is unset, so the route returns `null` before reasoning.
- The client falls back to `heuristicAnswer` (`src/lib/recall/agent.ts:45`), a
  keyword search. `"I found one relevant note:"` is a hardcoded string there. It
  matched the words *trading fx* and printed the login that lives in that folder.

Meanwhile the requested capability **already exists end to end**:

| Layer | Location |
|---|---|
| Action type | `src/lib/recall/types.ts:193` |
| Validation | `src/lib/recall/agent.ts:238` |
| Execution (with cycle protection) | `src/lib/recall/store.ts:464`, `:586` |
| Confirmation UI | `src/components/recall/AgentChat.tsx:69` |

So the task was always performable. Only the translation from sentence to action
was missing.

Separately confirmed: `moveFolder` is called from **no UI component** — the
assistant is currently the only way to move a folder at all.

### Fixes

**0.1 — Provider: Vercel AI Gateway.** Decided 2026-09-07. The route keeps
`AI_GATEWAY_API_KEY` against `https://ai-gateway.vercel.sh/v1/chat/completions`,
the path the code was written for. An OpenRouter fallback was offered and
**declined**, so no provider-abstraction layer is added — `callGateway` stays as
it is.

The consequence, accepted knowingly: **the assistant does not work until the user
creates the key**, and it must also be set in Vercel project settings for the
deployed hub. `AI_MODEL` defaults to `anthropic/claude-sonnet-4-6`, which the
route already falls back to. This makes 0.2 the piece carrying the user until the
key exists, and raises its priority from polish to essential.

**0.2 — Degradation must be visible.** A missing key currently degrades silently
into keyword search, which reads to the user as a stupid AI rather than an absent
one. The assistant must state its mode: when no key resolves, the reply is
prefixed with a plain notice that AI filing/reasoning is off and that this is a
search result, plus a link to the setting. **A silent fallback that impersonates a
working feature is the actual bug here** — the missing key is only its trigger.

**0.3 — Folder move in the UI.** Expose the existing `moveFolder` from the folder
menu ("Move to…" with a parent picker, excluding descendants of the folder being
moved, since `wouldCycle` already rejects those). The assistant should not be the
only path to a basic structural edit.

**0.4 — Multi-step action quality.** The prompt should reliably resolve
*"move X into a Y subfolder"* to `move_folder` when Y exists, and to
`create_folder` + `move_folder` when it does not. Regression cases are listed
under Testing.

### Out of scope for phase 0

Rewriting the agent architecture. The 13 actions, the validation-drops-unknown-ids
rule, and the confirm-before-write UI all stay exactly as they are.

---

## A. Rename Recall → Dashboard

User-facing only.

**Changes:** the route `/apps/recall` → `/apps/dashboard`, a permanent redirect
from the old path, the `catalog.ts` entry (`slug`, `title`, blurb), and every
visible "Recall" string in components.

**Deliberately unchanged**, because renaming them destroys or orphans data:

| Thing | Stays | Why |
|---|---|---|
| localStorage keys (`recall:v1`, `recall-photos:v1`, `recall-photo-queue:v1`) | `recall` | Renaming orphans every existing note, photo, list and login. |
| `app_state` remote keys | `recall` | Rows are keyed by `(user_id, key)`; a new key reads as a fresh empty account. |
| Module paths (`src/lib/recall/*`, `src/components/recall/*`) | `recall` | Same precedent as Prompt Architect, whose code still lives under `blueprint`. |
| Existing API routes (`/api/recall/*`) | `recall` | `/api/recall/lists/join` is embedded in invite links family members already hold. Renaming it breaks them. |
| `RECALL_PASSWORD`, `RECALL_DATA_DIR` | `RECALL_*` | Already set in deployed environments. |

**New** endpoints are added under `/api/dashboard/*`, because the inbox URL is
pasted into an iOS Shortcut by hand and is therefore user-facing. This produces a
deliberate split — old internal routes say `recall`, new user-visible ones say
`dashboard` — accepted as cheaper than breaking live invite links.

`UNPREVIEWABLE` in `catalog.ts` and `LEGACY_APP_KEYS` in `sync/identity.ts` both
reference `recall` and must keep doing so.

---

## B. iPhone ingestion

### The constraint that shapes this

A web page cannot read an iPhone camera roll. iOS exposes no such API, iCloud has
no public API, and Google Photos restricted library-read access to picker-only in
2025. Therefore the phone must **push**; the app cannot **pull**. The only
mechanism on iOS that can push on a schedule is the Shortcuts app.

This has a consequence that must be visible in the UI rather than smoothed over:
**the photo picker cannot auto-select "the last 50".** Only the Shortcut can.

### UI: a Sources strip at the top of the Photos tab

Sits above the existing review queue. Three parts:

**1. Import from iPhone** — a count preset (5 / 20 / 50 / 100) then the iOS photo
picker (`<input type="file" accept="image/*" multiple>`). The preset is a **cap**:
the label reads "select up to 50 — newest first", and selecting more than the cap
keeps the first N by capture date and reports what it dropped. Works immediately,
needs no setup, no server, and no token.

**2. Autopilot (iPhone sync)** — connection status, last sync time, the per-user
device token with a copy button, the inbox URL, and step-by-step Shortcut setup:
*Get Latest Photos (limit N) → Get Contents of URL (POST, `X-Dashboard-Token`
header, photos as multipart)*. States plainly that tapping the Shortcut is a quick
pull and attaching it to a personal automation (nightly, on charge, on arriving
home) is the hands-off version.

**3. Inbox badge** — "12 photos waiting from your iPhone → Analyze". Claiming
moves them into the existing local review queue.

### Endpoints

All under `/api/dashboard/inbox`, `runtime = "nodejs"`.

| Method | Auth | Behaviour |
|---|---|---|
| `POST /api/dashboard/inbox` | `X-Dashboard-Token` header | Accepts multipart images. Resolves token → `uid`. Writes each blob via `putBlob`, appends a manifest entry via `docStore`. Returns `{ accepted, skipped }`. |
| `GET /api/dashboard/inbox` | signed-in session cookie | Lists that uid's pending manifest entries with thumbnails. |
| `POST /api/dashboard/inbox/claim` | signed-in session cookie | Returns blob bytes for the given ids and deletes them server-side. |
| `POST /api/dashboard/inbox/token` | signed-in session cookie | Mints (or rotates) that user's device token. |

**Token model.** Random 32-byte token, stored **hashed** in `docStore` against the
uid, shown to the user exactly once at mint time and thereafter only as a masked
value with a "rotate" action. Per-user, minted from the signed-in session — this
is what lets every hub user set up their own iPhone rather than sharing the
owner's.

**Deduplication is required, not optional.** The Shortcut sends each photo's local
identifier and creation date alongside the bytes. The server keeps the last ~500
seen identifiers per user and skips repeats. Without this, a nightly "last 50"
automation re-imports 45 photos it already sent on its second run and the queue
floods. This is the single easiest part of the feature to omit and the one that
makes autopilot unusable if omitted.

**Retention.** Claimed blobs are deleted immediately. Unclaimed blobs and their
manifest entries are swept after 7 days, checked lazily on `GET`. The inbox is a
transit buffer, never a library.

**Limits.** 25 MB per image and 100 images per request, matching `/api/ingest`.
Oversized requests are rejected with a message the Shortcut surfaces.

### Why the inbox is separate from the photo queue

`recall-photo-queue:v1` is deliberately **not synced**: each pending photo points
at an IndexedDB blob that exists on one device only, so syncing the queue would
show a laptop entries whose pixels aren't there. The server inbox does not change
that. It is a short-lived, server-side transit buffer that a device *drains into*
its local queue. The two are different things and stay different.

---

## C. The destination registry

### Shape

New module `src/lib/recall/routing/registry.ts`. Today's route union
(`people | info | event`) becomes a registry of destinations, each one file:

```ts
interface Destination<F> {
  id: string;              // "ai-rankings"
  label: string;           // "AI Rankings"
  appSlug: string;         // links the review queue to the target app
  hint: string;            // what the vision model is told this is for
  /** Field names + descriptions, used to BUILD the prompt (not just validate). */
  fields: FieldSpec[];
  /** Hand validation, returning null to drop. Mirrors agent.ts:200-253. */
  parse(raw: unknown): F | null;
  preview(fields: F): { title: string; where: string; lines: string[] };
  commit(fields: F, ctx: CommitContext): Promise<void>;
}
```

**No `zod`.** The repo does not depend on it, and `agent.ts` already validates
LLM output by hand with a switch that drops anything naming an unknown id. The
registry follows that existing convention rather than introducing a schema
library for one feature.

**The vision prompt is generated from the registry** — each destination
contributes its `hint` and its field list. Adding a destination is adding a file;
it is never prompt surgery. That is the property that makes "other hub apps too"
affordable, and it is the reason for the indirection.

`commit` runs **client-side on approve**, in the same browser and same origin as
the target app, so it writes through that app's own store module
(e.g. `ai-rankings/store.ts`) rather than duplicating its persistence rules. It
must never write storage keys directly.

### First destinations

1. `photos-people`, `photos-info`, `photos-event` — the three existing routes,
   re-expressed as registry entries. Behaviour is unchanged; this is a refactor
   that must not alter what today's photos do.
2. `ai-rankings` — new.

Then, as separate follow-on files once 1–2 are proven: EA Feature List, Skills
Library, Cookbook Genie.

### AI Rankings extraction

Produces a `Tool` for `src/lib/ai-rankings/store.ts` with `name`, `url`,
`summary`, `group`, `category`, `tags`, `access`, `openSource`, `hosting`,
`apiKey`.

**Naming rule.** When the screenshot shows a GitHub repo, `name` is the identifier
as displayed — `comfyanonymous/ComfyUI`. When only a product or landing page is
visible, `name` is the product name and the repo identifier is left empty rather
than guessed.

The model returns `confidence` and `nameSource` (`"seen"` vs `"inferred"`). An
inferred name renders flagged in the review queue. A guessed identifier written
silently is worse than an obviously unconfirmed one, because the user cannot tell
the board is wrong by looking at it.

`contentRating` defaults to `"unknown"` — the honest default the type already
documents. Vision does not set it.

### Review queue changes

Grouping already exists; it now groups by registry destination and shows each
group as `→ AI Rankings › Dev › Open Source (4 records)` with a link to the target
app. Adds a per-photo **re-route** control so a misfiled photo is moved before
approval instead of rejected and redone. Approve group / approve all / reject are
unchanged. Nothing writes until approve.

---

## Invariants this work must not break

1. A section holding items always renders; a non-empty section cannot be removed.
2. Credentials are filtered out of `retrieveForQuestion` and never reach the AI
   Gateway.
3. Saved passwords stay plaintext by explicit decision. No encryption, no vault.
4. File blobs live in IndexedDB, never localStorage.
5. `recall-photo-queue:v1` stays unsynced.

## Degradation

| Missing | Result |
|---|---|
| `AI_GATEWAY_API_KEY` (**currently unset**) | Vision returns `null`; the existing deliberately-unconfident heuristic files photos instead. Import still works. The Sources panel states that AI filing is off. |
| `SUPABASE_SERVICE_ROLE_KEY` (**currently unset**) | Inbox falls back to the filesystem under `RECALL_DATA_DIR`. Correct locally; **fails on Vercel**, whose filesystem is read-only. Autopilot on the deployed hub requires this variable. The Autopilot panel detects and says so rather than failing silently at 3am. |
| Invalid/rotated token | `401` with a message body the Shortcut displays. |
| `AI_GATEWAY_API_KEY`, for the **assistant** | Reply carries the degraded-mode notice from 0.2 and is labelled a search result. It must never read as an answer the assistant reasoned its way to. |
| Neither key set | Picker path still works end to end with heuristic filing. |

## Testing

**The repo has no test *runner*** — no `test` script and no framework in
`package.json`. There is one pre-existing test file,
`src/lib/auteur/director/director.test.ts`, written against `node:test`; it does
not run, because Node's ESM loader rejects the extensionless relative imports
this codebase uses throughout.

Phase 0 adds `vitest` as a single dev dependency in the node environment,
because the regression cases below are the evidence that the reported bug is
fixed and there is nowhere else to put them. Pinned to `^2`: vitest 5 requires
`@types/node >=22` and this repo pins `^20`, and bumping that to satisfy a test
runner risks the Next build. No component/DOM library is added — the logic under
test (action validation, cycle safety, destination parsing, dedup) is all pure.

The auteur file is **excluded**, not converted: making it run would mean adding
`.ts` extensions to imports in production source, which is a large edit to app
code in service of a test runner.

Phase 0 regression cases, run against a fixture tree containing `vps 2026` and
`trading fx`:

| Question | Expected |
|---|---|
| "move my vps 2026 folder into a trading fx subfolder" | one `move_folder`, `folderId` = vps 2026, parent = trading fx |
| same, when `trading fx` does not exist | `create_folder` then `move_folder` |
| "move trading fx into vps 2026" when vps 2026 is its child | rejected by `wouldCycle`, explained rather than silently dropped |
| any question with no key resolvable | reply carries the degraded-mode notice, never a bare search result |

- Unit: dedup (repeat identifier skipped, new one accepted, ring buffer eviction),
  token hash/verify, retention sweep boundary, `preview`/`commit` per destination,
  picker overflow trimming by capture date.
- Snapshot: the prompt built from the registry, so adding a destination shows its
  effect on the prompt in the diff.
- Regression: the three existing photo routes behave identically after being moved
  into the registry.
- Manual, in the browser preview: picker path with several images; Sources strip
  layout; a review group committing into AI Rankings and appearing on that board.

## Out of scope

Android ingestion. Reading iCloud or Google Photos libraries (no API exists).
Background sync without the Shortcut (impossible on iOS). Renaming storage keys or
existing API routes. Encrypting saved passwords.

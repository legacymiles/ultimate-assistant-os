---
name: dashboard-app
description: "Recall is now \"Dashboard\" at /apps/dashboard — what was renamed, what deliberately was NOT, plus the iPhone inbox and the destination registry"
metadata: 
  node_type: memory
  type: project
  originSessionId: d25b4215-8767-4835-bfa4-4a5dea2d1801
  modified: 2026-09-14T03:41:45.024Z
---

Renamed 2026-09-07. Recall is now **Dashboard**, at `/apps/dashboard`.

**Renamed:** the route (old path 301s), the catalog entry (`slug: "dashboard"`),
page titles, and all visible prose.

**Deliberately NOT renamed — do not "finish the job" in a later session:**
- localStorage / `app_state` keys stay `recall:*`. Renaming orphans every note,
  photo, list and login.
- Module paths stay `src/{components,lib}/recall/*`.
- `/api/recall/*` stays — `/api/recall/lists/join` is embedded in invite links
  family members already hold.
- `RECALL_PASSWORD`, `RECALL_DATA_DIR` stay.
- `src/lib/seed.ts` matches BOTH `"dashboard"` and `"recall"` catalog slugs,
  because timeline rows written before the rename still say `recall`.

New endpoints use `/api/dashboard/*` because the Shortcut URL is user-facing.

**iPhone inbox** (`src/lib/dashboard/inbox.ts`). iOS exposes no camera-roll API,
iCloud has none, Google Photos went picker-only in 2025 — so the phone must
PUSH. An iOS Shortcut POSTs to `/api/dashboard/inbox/push` with a per-user
token (stored hashed, shown once). Load-bearing: **dedup by the photo's device
identifier**, or a nightly "last 50" automation re-imports 45 on its second run
and the queue floods. `/push` is the ONLY session-exempt API path in the hub,
exempted by exact match in middleware, never by prefix. The inbox is a transit
buffer — claimed blobs are deleted, unclaimed swept after 7 days. It is separate
from `recall-photo-queue:v1`, which stays unsynced.

**Destination registry** (`src/lib/dashboard/destinations/`). Photo routes are
no longer a closed union. One file per destination declares `hint`, `fields`,
`parse`, `preview`, `commit`. **The vision prompt is GENERATED from the
registry** — a destination cannot be added without the model learning about it.
`commit` runs client-side through the target app's own store module, never its
storage key. Three entries:
- **AI Rankings** — names records by the GitHub identifier as shown
  (`comfyanonymous/ComfyUI`) and reports `nameSource` seen-vs-inferred, so a
  guessed name is flagged rather than written silently.
- **Cookbook Genie** — writes through the app's own Supabase/localClient (it has
  no store module), into a resolved-or-created "From Photos" cookbook so filing
  never depends on which cookbook sorts first.
- **Skills Library** — transcribes the prompt VERBATIM; for a prompt the wording
  is the artifact, so a paraphrase is worthless.

**EA Feature List cannot be a destination.** It is read-only by design:
`EA_FEATURES` is a static array in `src/lib/ea-features/features.ts` with no
store, no localStorage and no write path — features are dictated and appended to
source. Filing into it needs persistence built for that app first. Do not
"finish" this in a later session without deciding that separately.

Also added: "Move to…" folder UI (`moveFolder` was previously reachable only by
the agent), and a `degradedNotice()` so a missing key never again impersonates a
working assistant.

**Blob sweep must count the review queue** (fixed 2026-09-12). `Recall.tsx`
sweeps IndexedDB on mount via `pruneOrphans(referencedFileIds(items, queue))`.
It used to count only items, so every page load deleted the full-size image of
every photo still awaiting review. Any NEW thing that stores blobs must be added
to `src/lib/recall/referencedFiles.ts`, or its blobs vanish on the next load.
Remaining edge: blob is written before its queue entry, so a second tab loading
in that gap can still sweep it.

**Cookbook Genie gotchas** (cost a failed real-photo test): rows are
`{name, amount: string, unit}` and `{step, text}` — plain strings render as
blank rows. Its local shim has `getSession` but NO `getUser`; use getSession
(also what the app calls). Supabase reports insert failures in the return value,
not by throwing — always check `error`. Destination commits run BEFORE the
Dashboard item is created, so a failed commit writes nothing and retry is safe.

**Photo review features** (added 2026-09-12, user-requested while testing):
- *Duplicates* — `src/lib/recall/photos/fingerprint.ts` dHash (look-alike, not
  byte-exact, by user choice; bursts may flag). Checked at import vs filed items
  + queue. Old items without a fingerprint are hashed from their THUMBNAIL.
  Flagged photos are excluded from both Approve buttons until "Keep anyway".
- *Send to an app* — chips from `DESTINATIONS`; picking one calls
  `reanalyze(..., { forceRoute })`, and the vision route ENFORCES the forced
  route after parsing (prompt alone was not trusted).
- *"What are these photos?"* note — strong guidance, deliberately not an override.
- *New album* — name + optional people rule via `createCategory`. An album with
  NO people gets `minPeople: 999` so it is manual-only; otherwise it would sort
  ahead of the family rules and swallow every photo containing a person.
- Trap: `createItem` in `src/lib/recall/store.ts` copies each field explicitly —
  a new Item field must be added to `NewItemInput` AND copied in the literal, or
  it compiles and is silently dropped.
- Product rule from the user: other apps get the INFORMATION (e.g. the recipe),
  never the image; the photo stays in Dashboard under "Sent to apps".

**Per-photo agent prompt** (added 2026-09-12). The review screen has "Tell the
agent what to do with this photo": the message + image go to the vision model
and are FOLLOWED (which app, where inside it, include/exclude, which album the
picture goes in). Three deliberate strengths in `userGuidance` (route.ts): app
chip = instruction, per-photo prompt = instruction, batch note = guidance only.
It must never invent facts absent from both image and prompt; it reports
`agentNote.followed / couldNot`. The prompt is saved on the pending photo so a
later Re-read still follows it.
- Named places resolve by `closestPlace` (`src/lib/dashboard/places.ts`): case,
  punctuation, plural, small typos — but first letter must match ("Brunch" is
  NOT "Lunch"). Existing places are SENT to the model (`Destination.places()` +
  `gatherKnownPlaces`) so the preview shows the real name; commits re-run the
  match as a safety net. User chose "close match, else create".
- Cookbook destination has a `cookbook` field; empty → "From Photos".
- Verified: "my desert cookbook, leave out the sesame seeds, note from Aunt May,
  photo in Test Album Beach" → existing Desserts, sesame ingredient AND step
  dropped, note in description, picture in the album.

**Google Drive backup of the Folders tab** (added 2026-09-13,
`src/lib/dashboard/driveBackup/`). Drive layout: "Ultimate Assistant OS" /
"Photos" (albums) + "Folders" (tree, + "Unfiled"). Files = real files, notes =
Google Docs, links/websites/to-dos/logins = one "Links, to-dos & logins" doc per
folder. User decisions: NEVER upload passwords (secret-looking fields dropped
too); backup that NEVER deletes (plan has no delete step); button + auto while
open, and auto only while `driveTokenLive()` (a no-click consent popup is
blocked). Identity = `appProperties.dashboardKey`, never names, so renames/moves
follow and other devices don't duplicate. CONFIRMED WORKING on the live site
2026-09-13 after the user created a Google OAuth client and set
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` in Vercel (NEXT_PUBLIC_ vars need a REDEPLOY — they
are inlined at build time). The GIS token client must have an `error_callback`,
or a blocked/closed Google window leaves the backup spinning forever.

**Windows/OneDrive build trap:** `next build` can die with `EINVAL: readlink`
before compiling anything — in `.next` when another dev server shares it, and
even in a private `NEXT_DIST_DIR` whose old files OneDrive has turned into cloud
placeholders. It is never a code error. Build with `NEXT_DIST_DIR=.next-verify`
and `rm -rf .next-verify` first if it still fails (it is throwaway output no
server uses; never delete `.next`, another session may be serving from it).

**Folder delete CASCADES** (user request 2026-09-13). `deleteFolder` removes the
folder, every nested subfolder and all items in them (it used to lift contents
to the parent). The confirm prompt counts them via `folderDeleteImpact`; the
agent's `delete_folder` shares the same function. Drive backup still never deletes.

**Enlarge in review** — `Lightbox` in ReviewQueue.tsx loads the ORIGINAL blob
(not the 180px thumb); Esc is caught in capture phase so it closes only the
lightbox.

**Browser-probe trap:** `innerText` applies CSS `text-transform`, so an
`uppercase` label reads "OR PICK AN APP" — a case-sensitive text check reports a
closed screen that is open. Check elements, or use `/i`.
Also: a freshly started preview server's first navigate often lands on the hub
home, not the requested app — assert `location.pathname` before trusting results.

**ONE Drive backup, for photos too** (2026-09-15). The Photos tab used to have
its own Drive path (`backupPhotos` -> a separate "Recall Photos" folder, flat but
for one level of album names, blind to a sub-folder inside an album). Deleted.
Photos now call `backupToDrive()` in `photos/pipeline.ts`, which is the same
`driveBackup/run.ts` the Folders tab uses — whole tree, any depth, id-matched.
`src/lib/recall/drive.ts` stops at the TOKEN now; everything written to Drive
goes through `lib/dashboard/driveBackup`. Settings lost `driveMirrorCategories`
and `driveFolderId` with it.

**Two Google config checks, not one** (the bug that started 2026-09-15).
`driveConfigured()` = CLIENT_ID only (sign in, back up). `drivePickerConfigured()`
= CLIENT_ID **and** API_KEY (only the Picker, i.e. importing FROM Drive). The
Photos tab used to require both, so with only the client id set in Vercel it
announced "Google Drive isn't set up" while the Folders tab backed up fine.
Never gate a backup on the Picker key.

**Photo folders are user-creatable, and teachable by example** (2026-09-15).
`AlbumDialog.tsx` + `makeAlbum()` in PhotosBoard create BOTH halves — the
`PhotoCategory` rule and the real folder under Photos (`ensureFolderPath`). One
without the other is the bug to watch for. `PhotoCategory.refs` (max 4, 256px
thumbs) are reference pictures for the FOLDER: they ride in the SAME contact
sheet as the faces (`buildContactSheet(people, categories)`, legend entries now
carry `kind: "person" | "album"`), and the model returns `albumMatch {slot,
confidence}`. Routing precedence in `applyAnalysis`: explicit `photoAlbum` from a
user prompt > `albumMatch` at >=0.7 (or >=0.5 when nothing else matched) > the
people rules. This is what makes a folder with no face behind it — "Jobs", "My
Truck" — sort itself. `reconcileCategories` rebuilds derived categories from the
people list, so refs/refHint MUST be carried across there or they vanish on the
next rename.

**Batch prompt -> collage** (2026-09-15). The Photos instruction box is now an
instruction, not a hint. `readBatchPlan` (`photos/batch.ts` +
`/api/recall/photos/batch`) turns "make these into a collage and put a quote
about hard work at the bottom" into a plan; `composeBatch` (`photos/compose.ts`)
draws it on a canvas IN THE BROWSER. The model only interprets and writes the
words — it never draws — so with no AI key `readPlanLocally` still makes the
collage and places text the user typed in quotes, and only refuses to invent a
quote. A collage enters the queue as ONE photo (`PendingPhoto.composite`,
`Item.composite`) and the originals are not queued.
- Dedup rule the user asked for: `findDuplicate(..., composite)` compares
  collages ONLY with collages and plain photos ONLY with plain photos. A collage
  is never a duplicate of a picture inside it; the same collage twice still is.

`scripts/dev-preview.mjs` takes trailing `KEY=value` args as env for that server
only — use it to verify a screen that changes when a public key is set without
putting the key in `.env.local` (launch config `photos-drive-preview-3236`).

Tests: `npm test` (vitest ^2 — vitest 5 needs @types/node >=22, repo pins ^20).

Supersedes the naming in [[recall-app]], [[recall-photos-calendar]],
[[recall-lists-board]]. Related: [[hub-ai-provider]]

**Cross-device sync bug fixed 2026-09-16** (commit 9737720). Laptop and phone on the
same login each saw only their own folders: Recall.tsx ran `ensurePhotosRoot()`
(unconditional save) and `load()` saved an empty seed BEFORE `useRemotePull`, so
every load stamped the device newest and reconcile pushed instead of pulling.
Rule now: NOTHING in Dashboard may write on mount before reconcile — writes go in the
useRemotePull callback, and ensureFolderPath saves only if it created a folder.
One-time repair: `reconcile(key, mergeOnce)` + `mergeRecallData` (union by id,
same-named sibling folders collapsed) behind flag `recall:sync-repair:v1`.
File blobs (IndexedDB) still never sync — only thumbnails/text travel.

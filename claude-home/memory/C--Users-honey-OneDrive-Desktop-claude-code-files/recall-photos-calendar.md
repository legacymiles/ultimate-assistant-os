---
name: recall-photos-calendar
description: "Recall's Photos and Calendar tabs — vision triage routes a camera roll to people-folders / knowledge base / calendar; the contact-sheet trick, the rule-driven categories, and why the review queue is not synced"
metadata: 
  node_type: memory
  type: project
  originSessionId: 03d9bc70-109b-4ba3-a594-233b0431a2d9
  modified: 2026-09-07T13:33:32.290Z
---

Added 2026-09-07. Recall's home now has **four** tabs: Folders, Photos, Calendar, Lists. See [[recall-app]], [[recall-lists-board]].

**Photos** (`src/lib/recall/photos/*`, `src/components/recall/photos/*`). One vision call per photo answers three questions at once — is this `people`, `info` or `event`; which known faces are in it; and everything needed to file it. Splitting that into two passes would double cost and let the passes disagree about the same picture.

Three decisions worth not re-deriving:

1. **The contact sheet.** Reference faces are composited client-side into ONE labelled JPEG grid ("1. Jack", "2. Leo"), memoised on a signature of the people list, and sent alongside each photo. The model answers "which numbered faces appear here?" instead of open-ended identification, and cost stops growing with family size. `src/lib/recall/photos/vision.ts`.
2. **Categories are RULES, not code.** "Me & My Son" is `{requires:[self,son], exact:true, minPeople:2}`. Solo and pair folders are *derived* from the people list by `reconcileCategories`, so adding a child creates its folders. `exact` also rejects strangers — a selfie with someone else in it is not a selfie. Matching lives in `photos/types.ts`.
3. **Two storage keys, on purpose.** `recall-photos:v1` (people, categories, settings) syncs; `recall-photo-queue:v1` does NOT. Each pending photo points at an IndexedDB blob that never leaves the device, so a synced queue would show a laptop photos whose pixels don't exist there.

Approved photos become **ordinary Recall items** (`kind: "image"`) in ordinary folders under a `role: "photos"` root — so search, the folder workspace and the assistant work on them for free. The review queue groups by DESTINATION and approves whole groups: one click per folder, not per photo, and a mislabelled face stands out against a consistent wall of thumbnails.

**Calendar** (`src/lib/recall/calendar/*`). An event's day is a plain `"YYYY-MM-DD"` string plus a separate `"HH:MM"`, never an ISO instant — an instant silently shifts the day west of UTC (the bug already paid for once in [[std-safe-app]]). Everything builds a local `Date` via `eventStart`. Reminders only fire while a Recall tab is open; `.ics` export is the honest bridge to a phone that rings in a pocket, and the UI says so.

**Assistant** (`src/lib/recall/agent.ts`): now sees knowledge base + calendar + people in one prompt, gets today's date (without it every relative date it writes is wrong), and can propose `create_event` / `update_event` / `delete_event` / `add_person` on top of the old 13 actions. `executeAction` returns `calendarChanged` / `photosChanged` so the shell remounts those boards — three stores, one confirmation UI.

**Drive backup**: `drive.file` scope already in use for picking also permits writing, so backup needs no new scope and Recall still cannot read the rest of the user's Drive. `backupPhotos` in `src/lib/recall/drive.ts` uploads serially and stamps `item.driveBackupId` so re-running skips.

**Known limit, told to the user in the UI:** a web app cannot background-sync a camera roll. Ways in are the mobile file picker and the Drive import.

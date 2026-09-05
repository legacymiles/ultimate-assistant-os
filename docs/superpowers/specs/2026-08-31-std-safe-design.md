# STD Safe — design

**Date:** 2026-08-31
**Route:** `/apps/std-safe`
**Category:** Apps

## What it is

A third-party STD result tracker and verifier. You upload the lab report you
already received, the app reads it, and you keep a running per-infection status.
When you meet someone, they ask for your code, you approve, and they see a
read-only view of what you were tested for, what came back, and when.

## What the badge claims — and what it does not

The word "clean" does not appear anywhere in the product. A badge that says
"clean" makes a promise the underlying data cannot keep. The app says instead
what is actually true: which infections were tested, what each came back, when
the sample was collected, and how that was verified.

Two verification tiers, and only two:

- **Lab document** — a report file is on file and was machine-read.
- **Self-reported** — typed in, nothing backing it.

A standing honesty panel appears on every shared view:

1. A document on file proves a document exists. It does not prove the document
   is authentic — nothing short of a direct lab integration could.
2. No test covers exposure *after* its collection date. A negative from three
   weeks ago says nothing about last weekend.

There is no real integration available: no consumer lab (STDcheck, Quest,
LabCorp, Epic/MyChart) offers third-party result sharing to outside developers.
The app does not pretend otherwise — there are no fake "Connect" buttons.

## Model

```
User         id, handle, code (6 chars, rotatable), salt/hash, displayName?, createdAt
TestRecord   id, userId, collectedAt, reportedAt?, lab, panelName,
             verification: document | self, fileId?, fileName?, results[], note?
Result       infection, outcome: negative | positive | indeterminate, context?, value?
context      treated-cleared | in-treatment | managed-undetectable |
             suppressive-therapy | untreated
ShareRequest id, fromUserId, toUserId, status: pending | approved | denied | expired,
             createdAt, respondedAt?, grantExpiresAt
```

Ten infections: HIV, syphilis, chlamydia, gonorrhea, hepatitis B, hepatitis C,
HSV-1, HSV-2, trichomoniasis, *Mycoplasma genitalium*.

### Status is derived per infection, not per record

Each infection carries its own latest result and its own age. Someone may have
had HIV drawn two weeks ago and syphilis six months ago; a single overall date
would hide that. Freshness tiers, applied per infection:

| tier   | age of sample |
| ------ | ------------- |
| fresh  | 0–30 days     |
| aging  | 31–90 days    |
| stale  | 90+ days      |

Untested infections are rendered as explicit grey rows, never omitted. The
headline reads `All negative on 7 of 10` — the coverage count is part of the
claim, so a two-test panel can never look like a full workup.

Positives are first-class and carry treatment context, because an undetectable
HIV status is not transmissible and a treated-and-cleared chlamydia is not a
current infection. Hiding individual results is deliberately *not* offered: a
hidden row would be indistinguishable from a negative one, which would corrupt
every other row on the page.

`status.ts` is a pure, client-safe module. The server and the UI derive verdicts
from one implementation, so a shared view and the owner's own view can never
disagree.

## Upload → confirm → save

`POST /api/std-safe/reports/parse` reads the file server-side and returns a
**draft**. Nothing is saved by parsing.

- PDF → `pdf-parse` v2, then lab-specific patterns for STDcheck, Quest,
  LabCorp and MyChart, plus a generic table reader.
- Image → AI Gateway vision when `AI_GATEWAY_API_KEY` is set; otherwise the app
  says plainly that it cannot read the image offline and drops to manual entry
  with the image on screen.

Every draft lands on a review screen. The user confirms or corrects each field
before anything is written. Extraction is never trusted silently.

The uploaded file is stored server-side under `dataDir/std-safe-reports/<userId>/`
and is **never** served to a requester — lab reports carry full name, date of
birth and medical record numbers. The owner can view and delete their own.

## Sharing — approve a request

1. You show your 6-character code.
2. They enter it. A request lands in your inbox.
3. You see a preview of exactly what they would see, then Approve or Deny.
4. Approved: their view opens for 24 hours, then expires.

Denial is silent to the asker — it reads as "no response". A denial that
announced itself would be a disclosure in its own right.

Rotating your code revokes every outstanding grant.

## Storage and enforcement

A single JSON file, `.std-safe.json`, in `STDSAFE_DATA_DIR` or the working
directory — the pattern `recall/lists/store.ts` already established. Passwords
use the shared PBKDF2 helper in `src/lib/recall/passwords.ts` (210k iterations).
Sessions are HMAC-signed cookies (`stdsafe_session`), signed with a secret kept
in the store file.

Every mutator takes a `Caller` and re-checks it. The UI hiding a button is not
the enforcement point.

Persistence is host-dependent and reported honestly, as Recall Lists does: on a
long-lived Node host the file persists; on serverless it is ephemeral and the UI
says so rather than silently losing someone's results.

## Files

```
src/lib/stdsafe/       types · status · dataDir · store · session · parse · reports · client
src/app/api/std-safe/  auth · me · reports/parse · records · requests · view
src/components/stdsafe/ StdSafe · AuthPanel · StatusCard · UploadFlow ·
                        DraftReview · RecordTimeline · RequestInbox · AskPanel
src/app/apps/std-safe/page.tsx
```

## Verification

No test framework is installed in this repo. Verification is:

- `scripts/std-safe-check.mjs` — exercises the parser and `status.ts` against
  fixture report text and asserts the derived verdicts.
- `npx tsc --noEmit` and `npm run build`.
- Driving the real flows in the browser: sign up two accounts, upload, request,
  approve, view, expire.

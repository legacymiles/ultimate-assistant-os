---
name: std-safe-app
description: "STD result verification + sharing app at /apps/std-safe; document-verified only (no lab API exists), per-infection status, approve-a-request sharing"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0b2c34f1-0285-4412-b5e9-523a18325e45
  modified: 2026-08-31T23:20:51.733Z
---

Third-party STD test verification and tracker, built 2026-08-31, at `/apps/std-safe`
in the OS hub ([[ultimate-assistant-os-portfolio]]). Spec:
`docs/superpowers/specs/2026-08-31-std-safe-design.md`.

**The constraint that shaped everything:** no consumer lab (STDcheck, Quest, Labcorp,
Epic/MyChart) offers third-party result sharing to outside developers. "Connect your
account" is not buildable. So verification is document-based only — you upload the
report PDF, it is machine-read, and the badge says "lab document on file", which
proves a document exists, not that it is authentic. The app states this rather than
implying more. There are deliberately no fake "Connect" buttons.

Design decisions the user approved, worth not re-litigating:
- The word "clean" appears nowhere. Headline is "All negative on 7 of 10" — coverage
  is inside the claim so a partial panel can never read as a full one.
- Status is derived **per infection**, not per record; each row carries its own date
  and age (fresh ≤30d / aging ≤90d / stale 90+). Untested rows render greyed, never
  omitted.
- Positives are first-class with treatment context (treated-cleared, in-treatment,
  managed-undetectable, suppressive-therapy, untreated); a managed positive renders
  amber, not red. Hiding individual results is NOT offered — a hidden row would be
  indistinguishable from a negative one.
- Sharing is approve-a-request: 6-char code → request → preview of exactly what they'd
  see → 24h grant. Denials are silent (a denial that announces itself is a disclosure).
  Rotating the code revokes all live grants.

Architecture mirrors [[recall-lists-board]]: file store `.std-safe.json` under
`STDSAFE_DATA_DIR`, PBKDF2 via `src/lib/recall/passwords.ts`, HMAC session cookie,
every mutator re-checks a `Caller`. Report files live in `std-safe-reports/<userId>/`
and are never served to a requester. Both are gitignored.

**Gotcha:** the shared `formatDate()` in `src/lib/utils.ts` parses a date-only
`YYYY-MM-DD` as UTC midnight and prints it in local time, so west of Greenwich every
collection date rendered a day early. `formatDay()` in `src/lib/stdsafe/status.ts`
builds the Date from calendar parts instead. Use it for any date-only string.

Verify with `node scripts/std-safe-check.mjs` (62 checks over the parser and status
derivation; `scripts/ts-loader.mjs` lets plain node import the app's .ts). Preview on
port 3214 via `std-safe-preview-3214` — see [[hub-parallel-dev-servers]].

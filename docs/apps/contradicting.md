# Contradicting

Route: `/apps/contradicting` · Category: AI · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- contradicting "what to change"`.

## What it does

A clip-on recorder (the Omi pendant, or the Omi app on your phone) streams what was said, and Contradicting keeps each person's words with the exact time. When someone says “I never called you that”, it finds the line where they did and answers on your phone: “Actually, at 3:47 PM 10-18-26 you did say…”, with a Replay of the back-and-forth that led up to it. It catches the same words instantly and the same meaning in different words with Claude, flags promises and always/never lines as key points, keeps Omi's summary of each conversation, and searches everything ever said. Consent-first and fair: only people who agreed are recorded, withdrawing deletes what they said, unnamed voices are dropped after two days, and everyone is checked the same way — you included.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **New Jarvis app plugin — Omi recorder receipts for "I never said that"** — Clip-on Omi pendant (or Omi phone app) streams transcripts to a per-account webhook; denials are matched to the person's earlier line (same words, or same meaning via Claude) and answered on the phon…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/contradicting` — owner's sign-in
- `src/app/api/contradicting/`
- `src/components/contradicting/`
- `src/lib/contradicting/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET POST | `/api/contradicting` | owner's sign-in |
| GET POST HEAD | `/api/contradicting/omi` | per-account key (no session) |

### Data & database rules

- Server docs (server_docs via readDoc/writeDoc) — `src/lib/contradicting/server/store.ts`

### Keys & outside services

- `AI_MODEL` — `src/lib/contradicting/server/ai.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/lib/contradicting/server/ai.ts`

### Tests

- `src/lib/contradicting/engine.test.ts`
<!-- code:end -->

# Text Inbox

Route: `/apps/text-inbox` · Category: AI · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- text-inbox "what to change"`.

## What it does

An iPhone Shortcut automation sends each text from the people you pick, and Jarvis drafts a reply in your voice — your own words about how you text, plus every reply you rewrite, so drafts sound more like you over time. Nothing is ever sent until you approve it: edit the draft, ask for a redo ("say no nicely"), or decline. Approve on your iPhone and it sends right away through your own Messages app; approve on your computer and your phone buzzes — one tap sends it. Apple only lets the iPhone send a text as you, so the website never sends anything by itself. Also a widget on the Jarvis Dashboard.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **AI drafts replies to your iPhone texts, you approve, your phone sends** — New Jarvis app + Dashboard widget. An iPhone automation sends each text from chosen contacts; Jarvis drafts a reply in the user's voice (tone + learned rewrites). Approve on the iPhone sends at once …
- **Clearer Jarvis Send steps (no Key box needed)**
- **Works for every sender, skips codes and alerts** — Setup now shows the everyone option (Any Sender + a single space in Message Contains), and automated texts (codes, short codes, ads) are skipped without an AI draft or a notification.

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/text-inbox` — owner's sign-in
- `src/app/api/text-inbox/`
- `src/components/text-inbox/`
- `src/lib/text-inbox/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET POST | `/api/text-inbox` | owner's sign-in |
| GET POST | `/api/text-inbox/outbox` | per-account key (no session) |
| GET POST | `/api/text-inbox/push` | per-account key (no session) |

### Data & database rules

- Server docs (server_docs via readDoc/writeDoc) — `src/lib/text-inbox/server/store.ts`

### Keys & outside services

- AI calls through `src/lib/ai/provider.ts` — `src/app/api/text-inbox/route.ts`, `src/lib/text-inbox/server/brain.ts`

### Tests

- `src/lib/text-inbox/engine.test.ts`
<!-- code:end -->

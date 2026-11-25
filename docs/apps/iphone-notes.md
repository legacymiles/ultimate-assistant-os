# iPhone Notes

Route: `/apps/iphone-notes` · Category: AI · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- iphone-notes "what to change"`.

## What it does

An iPhone Shortcut sends the notes you wrote or changed lately, and Jarvis reads each one into what it would do: a to-do, a calendar event, a birthday, something to remember, an app idea for In Queue, a job for the chat agent, or just keep it in Folders. Every proposal shows a confidence score that teaches itself — it follows what you actually approve, so a kind of guess you keep declining drops even when the AI is sure. Nothing runs until you tap Approve; edit it first, decline it, or tell Jarvis what the note really is. Sort by most or least sure, drag the Confidence Rail to filter, search everything. Re-sending a note never makes a duplicate. Also a widget on the Jarvis Dashboard.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **New app + Dashboard widget — iPhone notes read into to-dos, events, birthdays, memory and ideas with a self-improving confidence score; noth** — A "Notes to Jarvis" iPhone Shortcut posts each recent note to /api/iphone-notes/push (per-account key, session-exempt, no duplicates on re-send). Jarvis proposes up to 6 actions per note, each scored…
- **A failed Shortcut run now says exactly what arrived and the fix, on the phone and on the setup screen; any field name holding the note is ac**
- **Shortcut setup down to one field (body = Repeat Item), and a reply echoed back by the Shortcut is never saved as a note**
- **Refuses a push that glues many notes into one and tells the Shortcut exactly how to fix it**
- **Ignores Shortcut step words typed in place of a variable, fixes the title when the note is re-sent, and says exactly what to fix** — A field like "Repeat Item > tap it > Name" typed as text is dropped (the title falls back to the note's first line). Re-sending the same note with a real title/date updates it in place, no duplicate.

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/iphone-notes` — owner's sign-in
- `src/app/api/iphone-notes/`
- `src/components/iphone-notes/`
- `src/lib/iphone-notes/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET POST | `/api/iphone-notes` | owner's sign-in |
| GET POST | `/api/iphone-notes/push` | per-account key (no session) |

### Data & database rules

- Server docs (server_docs via readDoc/writeDoc) — `src/lib/iphone-notes/server/store.ts`

### Keys & outside services

- AI calls through `src/lib/ai/provider.ts` — `src/app/api/iphone-notes/route.ts`, `src/lib/iphone-notes/server/brain.ts`

### Tests

- `src/lib/iphone-notes/engine.test.ts`
<!-- code:end -->

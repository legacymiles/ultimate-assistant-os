# Profiles

Route: `/apps/profiles` · Category: AI · Live

Record reviewed: 2026-11-22

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- profiles "what to change"`.

## What it does

A web of folders for the owner's life — their son, girlfriend, businesses, jobs — where every
profile opens into its own world of information. Only the current level is ever shown; you click
to go deeper. Jarvis is the way information gets in and gets found: the owner tells it things in
plain words (or drops photos in), Jarvis works out where each piece belongs and proposes the
changes, and nothing is saved until the owner taps Save. The chat is answered by the owner's
**Jarvis harness** on their PC (Claude or DeepSeek, through the local bridge) when it is on, the
hub's cloud model when it is not, and an offline reader with neither.

Design rule from the owner: show the current level, click to go deeper, use Jarvis to find or
manage anything. Not a dashboard, not a CRM, not a file manager — no charts, stats, sidebars or
tab bars.

## Features

- **Talk to it** — the hub's voice ("Jarvis, …" or the orb) goes to the Profiles chat on any
  Profiles page, opens the answer in the peek card and reads it back, saying when changes are
  waiting for Save.
- **The one Profiles app (Nov 2026)** — the same app is Jarvis › Dashboard › Profile, the
  Dashboard's Profiles tab and `/apps/profiles`. The old Profile tabs (Who you are, Business &
  personal, Life record, How you work) are gone from Jarvis; **Connections**, the **Backend
  checklist**, **Finish setup** and **Saved documents** live in Profiles › Settings (inside
  Jarvis). `/apps/jarvis#connections` opens Settings with Connections expanded.
- **Your existing profiles come in** — every Dashboard profile is imported once (businesses into
  My Businesses, people where they belong, accounts and passwords as private rows); the Life
  record is synced into My Profile every time Profiles opens, updated in place, its Work history
  becoming job profiles inside My Jobs. The examples clear themselves the moment real data
  arrives.
- **Read my screen feeds Profiles** — it stays in the main Jarvis chat bar; what it saves to the
  Life record shows up in My Profile straight away (it fires `jarvis:record-changed`).
- **Synced with Folders, Memory and Photos** — each real profile gets a folder under "Profiles"
  in the Dashboard (nested and moved/renamed with it) holding a searchable note of its details
  (private rows left out), so Folders search and the Memory graph find it; photos uploaded to a
  profile land in Photos › <profile>; a profile's gallery also shows every picture already in
  its folder or Photos folder.
- **New profiles start from what is already known** — "create a profile for my 3D printing
  business" searches Jarvis Memory and the Dashboard's folders, notes and photos first, files
  what it finds into the new profile (cited), puts it in the right parent (a teacher inside the
  child's School, a business inside My Businesses, a job inside My Jobs) and asks questions for
  that kind of profile: equipment with purchase date, seller and price, vendors, websites and
  which email is used for which site for a business; school, doctor and sizes for a child;
  anniversary and favorites for a partner; codes, coworkers and payday for a job. After saving,
  the chat stays with the new profile so the answers are filed there.
- **Never-send-to-AI values** — what the Life record marks sensitive (SSN and the like) and
  imported passwords are withheld from every prompt; the owner can still tap to see them.

- **Profiles home** — only the main profiles, as glass cards. Each shows its next upcoming date
  and a peek of what's inside; My Profile shows who it is connected to. Hover lifts a card and
  lights it in that profile's colour.
- **Webbed folders** — every profile has one home (its path) and can be linked inside other
  profiles. My Son lives on the home screen and is also linked inside My Profile.
- **People are round, things are square** — a person gets a glowing round mark; a business, job,
  place or object a rounded-square tile with an icon.
- **Every world has its own light** — opening a profile shifts the whole background to its hue;
  its mark flies from the card into the page header.
- **Profile pages** — profiles inside it as mini-app folder cards (each previews its contents),
  a Photos and videos card, then sections of details that fold open. Sections exist only when they
  have rows. Rows can be copied, edited in place, removed (with Undo) and added.
- **Private values** — codes, serials and account numbers are hidden until tapped (setting).
- **Gallery** — every photo and video in a profile and everything inside it, filterable by
  sub-profile, photos or videos; lightbox with arrow keys; add photos by upload.
- **Settings** — per profile: name, description, colour, icon or initials, "Jarvis can search
  this profile", where it lives and is linked, Archive (undoable). App: which brain answers,
  harness status, hide private values, clear or restore the examples, start a fresh conversation,
  restore archived profiles.
- **Jarvis, four sizes** — orb while scrolling, a bar on every page (`/` to focus; focus offers
  questions for the page), a peek card for quick answers, and a full conversation sheet.
- **Answers with sources** — the answer first, then source cards with the path
  (`MY BUSINESSES › NORTHSIDE PRINTS › BUSINESS EMAILS`); tapping one flies there level by level
  and flashes the row. Photo answers show a strip and Open gallery.
- **Telling Jarvis things** — one message can become several changes (a new profile, rows in
  it, a date filed in two places). They show as one card — "3 changes waiting for your OK" — with
  Save all, Review each (untick any) and Cancel. Follow-up questions come with quick replies.
- **Live panel** — while changes wait, the right side of the sheet shows the profile being
  written, new rows glowing, and the path it is filed into. Otherwise it is Changed today: every
  save with Undo.
- **Drop photos into the chat** — Jarvis files them into the right profile's photos.
- **Dictation** in the chat where the browser supports it.
- **Examples** — a first visit opens on a clearly marked example world, cleared in one tap
  (anything the owner added is kept).
- **Syncs across devices** via the hub's app_state blob sync when Supabase is configured; local
  only otherwise.

## Must keep working

- Jarvis › Profile shows only Profiles, and Profiles › Settings shows Connections and the Backend
  checklist working.
- Profiles never writes the Dashboard store on a device that has no Dashboard copy (it would
  overwrite the account's real folders); it reconciles first (`recallBridge.ts` `syncToRecall`).
- Life record sensitive values and imported passwords never reach a prompt (`noAi`).

- Asking "What email do I use for my printing suppliers?", "What is the gas code at my job?",
  "Show me pictures of my son" and "Move my son's teacher profile into his school folder" on the
  examples gives the right answer or change (covered by `src/lib/profiles/profiles.test.ts`).
- Nothing Jarvis proposes is saved without Save; every save can be undone.
- The harness thread never gets to act: it is started strict and every gate is refused.
- With no PC, no keys and no network the chat still answers (offline reader).
- Esc closes the innermost thing first: lightbox, chat, peek, then goes back a level.

## Requested, not built yet

- Photos are stored as downscaled JPEG data in the synced blob; a large library will want
  Supabase Storage.
- Searching the owner's jarvis-memory store and folders beyond Profiles' own Memory notes.

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/profiles` — owner's sign-in
- `src/app/api/profiles/`
- `src/components/profiles/`
- `src/lib/profiles/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/profiles/agent` | owner's sign-in |

### Data & database rules

- Saved data `profiles:v1` — `src/lib/profiles/useProfiles.ts`

### Keys & outside services

- AI calls through `src/lib/ai/provider.ts` — `src/app/api/profiles/agent/route.ts`

### Tests

- `src/lib/profiles/integrations.test.ts`
- `src/lib/profiles/profiles.test.ts`
<!-- code:end -->

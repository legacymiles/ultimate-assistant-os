# Jarvis › Profile — the personal-information OS

**Status:** spec, 2026-10-30. Replaces the Four-Cs `NewDashboard` as the Profile tab of
`/apps/jarvis`. Driven by the owner's brief plus six ideas taken from Brad Bonanno's
"The 4 Ms of AI minimalism" (`r0HT6UGZ624`).

## 1. What this is

Profile is the **one organised place every fact about the owner lives**, as a folder system
the AI builds and maintains for them. It is not a notes app and not a second brain: it is the
*record layer* that feeds Jarvis's memory, and the UI through which a human audits what the
AI believes about them.

The load-bearing promise: **the user never files anything by hand.** They say a thing, drop a
document, or answer a question in the queue; the AI decides where it goes and shapes the folder.
The moment a user has to choose which folder something belongs in, this feature has failed and
has become the "second brain vault" maintenance job the source video spends its first minute
mocking.

### Why not Recall

Recall (`/apps/dashboard`) is the owner's *capture* tool — anything, auto-filed, searchable.
Profile is *one subject* (the owner), with **typed** folders that know what fields a job or a
printer or a bill has. Recall's folder-as-workspace model is the right shape and is borrowed
here; its free-form item model is not.

## 2. The two layers (answers "should the main folder have an About Me?")

| Layer | What | Written by | Size | Read when |
|---|---|---|---|---|
| **About Me** | The briefing — identity, household, how to talk to me, hard constraints, what's current | AI, derived from the tree | ~1 page, hard-capped | every Jarvis turn |
| **The tree** | The record — every bill, login, old job, vendor, friend's birthday | AI on ingest, owner on edit | unbounded | on demand, via the Map |

About Me is **derived, never hand-authored**. It carries `Rebuilt from N folders · <when>` and a
Rebuild button. The owner can **pin** a line (always kept) or **veto** one (never re-added) —
that is the whole editing model, and it is what stops a generated document from being a thing
nobody trusts.

It is separate from the **Map** on purpose, exactly as the video keeps `context/about.md` apart
from the root `AGENTS.md`:

- **About Me** answers *who is this person* → goes into the model's context.
- **Map** answers *where do I look and what are the rules* → goes into Jarvis's system prompt.

The Map is generated, never edited, and always contains the vault rule:

> Secrets (passwords, card numbers, door codes, ID numbers) live in `secret` fields.
> They are never in About Me, never embedded, and never enter chat context. Fetch one only
> when the owner asks for that specific field by name.

## 3. Data model

One flat node list with parent pointers — same reason Recall does it: a single blob syncs
through `app_state`, and rename/move is one field, not a tree rewrite.

```ts
Node  { id, parentId, name, pack, icon, fields: Field[], notes, pinned?, createdAt, updatedAt }
Field { id, label, kind, value, source: "you"|"ai"|"import", confirmed, updatedAt }
```

A node is **both a folder and a record**: it holds fields *and* children. "Current job" has an
address and a door code *and* a Pay stubs subfolder. Forcing those apart is what makes other
folder systems annoying.

`FieldKind` = `text | multiline | date | money | url | email | phone | address | secret`.
`secret` is the only one with behaviour attached (§6).

```ts
ProfileStore { version, avatar, basics, nodes: Node[], about: AboutDoc, queue: ConfirmItem[], onboarded }
AboutDoc     { text, builtAt, sources: Record<lineIndex, nodeId[]>, pinned: string[], vetoed: string[] }
ConfirmItem  { id, kind: "conflict"|"unconfirmed"|"stale", nodeId, fieldId?, question, options? }
```

`sources` is what powers the provenance hover (§5) — hovering a line of About Me lights up the
folders it was derived from. It is also the honesty mechanism: a line with no source is a line
the AI invented, and the UI says so.

## 4. Schema packs — the mechanic that makes the owner's examples work

A **pack** is a typed folder template: the fields a thing of that kind has, plus the children it
spawns. A fact triggers a pack; the pack writes the empty structure; the owner (or the AI) fills it.

```ts
Pack { id, label, icon, cues: string[], fields: {label, kind}[], children?: {name, pack?}[] }
```

This is the video's "don't pre-build the tree, let the agent spin up folders as jobs arrive",
made concrete and typed. The owner's own examples, resolved:

| They say | Pack fires | What appears |
|---|---|---|
| "I started at Acme" | `job` | Work › Acme — employer, title, start, address, schedule, manager, pay, payroll login (secret), door code (secret); children Pay stubs, Reviews |
| "I run a DTF printing business called X" | `business` | Business › X — legal name, EIN, formed, bank, accountant; children Website & Domains, Email & Logins, Equipment, Vendors, Clients, Taxes, Pricing, Brand |
| "I just got a DTF printer" | `equipment` | Business › X › Equipment › DTF printer — make/model, serial, purchased, price, warranty, supplies, maintenance |
| "Maya's birthday is 3 June" | `person` | People › Maya — relationship, birthday, phone, email, how we met, gift ideas |

Packs shipped at v1: `person · job · job-application · job-offer · resume · business · website ·
equipment · vendor · client · bill · card · account · tax-year · property · vehicle · insurance ·
health · id-document · subscription · login · voice`.

`voice` is deliberately in the list: it is the one file in the source video the owner has no
equivalent of anywhere in Jarvis — core instruction, banned words, and a sample of their *own
approved writing* (never AI output, or it launders LLM clichés back into itself).

### Seeded root

`Me · People · Money · Work · Business · Home · Legal & Docs` — seven tiles, each with the
obvious children and nothing else. Business starts empty; it fills when a business exists.

## 5. The interface

Dense and database-like, per the owner's standing preference. One screen, four bands:

```
┌ avatar · name · birthday · pronouns · location          [edit] ┐
├ ONE BAR — type to filter the whole tree · Enter to ask ────────┤
├ ⚠ 3 things to confirm                            (collapsed)   │
├ ABOUT ME  — Rebuilt from 47 folders · 2 days ago   [Rebuild]   │
└ COLUMN BROWSER ───────────────────────────────────────────────┘
```

**The signature mechanic — the column browser.** Not a card grid: a macOS-column-view
navigator. Root tiles are column 0; clicking a folder slides in the next column; the breadcrumb
is the column trail itself. Fully keyboard-driven — `↑↓` within a column, `→` to descend,
`←` to ascend, so the owner can traverse their entire life without the mouse. The last column
is always the record view (fields + notes + children).

**The surprise moment — provenance.** Hovering a line of About Me dims the browser and lights
the folders that line came from; clicking the line jumps there. The generated document is
auditable by pointing at it.

**One bar, two modes.** Typing filters every node name, field label and field value live
(secrets excluded) and shows dense `Work › Acme › Pay stubs` result rows. If the input reads as
a question, an `Ask` affordance appears and Enter sends it to `/api/profile/ask` with a redacted
tree as context. One input, no mode switch to learn.

Motion budget is deliberately small: column slides (180ms, `cubic-bezier(.2,.8,.2,1)`),
provenance cross-fade, queue height. All gated behind `prefers-reduced-motion`. A record screen
that bounces is a toy; this one holds the owner's bank details.

## 6. Secrets

- `secret` fields render masked (`••••`) with a per-field reveal that does not persist.
- `redactForAi()` strips every `secret` value before any tree text leaves the browser. It is the
  single choke point, and it is unit-tested with a test that fails if a secret reaches the string.
- Secrets never enter About Me, the Map, or pgvector. The embedding path takes About Me and node
  *names* only.
- v1 stores secrets in the same synced blob as everything else, which means **they are only as
  private as the owner's Supabase row**. That is a known v1 limitation, written down here rather
  than implied: the encrypted-at-rest version is Recall's `logins` cipher model, and is the
  follow-up.

## 7. Onboarding — ingestion, not interrogation

The current 7-question intake becomes the *fallback*, not the gate. Three doors, in order:

1. **Drop what you already have** — resume, an AI chat export (`Settings → Data controls →
   Export data`), a bill, a job offer email, a tax return. `/api/profile/extract` returns draft
   nodes and fields, all `source: "ai"`, all `confirmed: false`.
2. **Tell it in a sentence** — free text, same route, same drafts.
3. **Answer seven questions** — the existing intake, imported as seed facts.

Everything a draft produces lands **unconfirmed**, which is what fills the queue. The owner's
first run is therefore *reviewing* their profile, never typing it.

**The confirm queue** is a real UI band, not a line in chat. Three kinds:
- `conflict` — two values for one fact ("Two addresses on file — which is current?") with both
  as one-click options. Taken straight from the video's A$950-vs-A$1,200 moment.
- `unconfirmed` — the AI wrote it, nobody has agreed yet.
- `stale` — dated fields past their date (expired card, lapsed registration, a renewal gone by).

## 8. Write-back

Any AI write shows `Edited Work › Acme · door code` with a one-click undo, mirroring the video's
`[Edited offer.md]` badge. Profile is the memory UI; an invisible write to a folder holding bank
details is not acceptable.

## 9. Files

```
src/lib/profile/   types.ts · packs.ts · model.ts · about.ts · redact.ts · profile.test.ts
src/app/api/profile/   extract/route.ts · about/route.ts · ask/route.ts
src/components/profile/  ProfileApp.tsx · ColumnBrowser.tsx · RecordView.tsx · AboutMe.tsx
                         OneBar.tsx · ConfirmQueue.tsx · Ingest.tsx · profile.css
```

Mounted at `tab === "profile"` in `src/components/jarvis/Jarvis.tsx`. `NewDashboard` stays
reachable at `/apps/new-dashboard` so the Four-Cs intake is not lost, and Profile imports from
its store on first run.

## 10. Out of scope for v1

Encrypted-at-rest secrets · pgvector write-through (About Me only) · multi-person profiles ·
`handoff.md` per folder (the video's session-continuity idea — good, but it belongs to the Chat
tab, not here) · Means/Methods, which already live in Jarvis's Tools, Skills and Routines tabs.

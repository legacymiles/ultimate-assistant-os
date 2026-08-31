# AI Rankings — design

**Date:** 2026-08-30
**Route:** `/apps/ai-rankings`
**Status:** built (second pass — rebuilt from a card directory into a database)

## Problem

The tool landscape moves faster than memory does. Tools get bookmarked, tried
once and lost; something new launches, is worse overall, but has one feature
worth keeping — and six months later there is no record of *why* it was kept.
There is also no single place that answers the practical questions before
starting a project: is this free or does it bill me, can I self-host it, do I
need an API key, do I already *have* that key, and when did I add this — is it
stale?

This is one private database that answers all of that, across every kind of
software rather than only AI, plus a personal leaderboard per section so "what
is currently the best video model *for me*" has an answer that is not a
benchmark someone else ran.

## What changed after the first pass

The first build was a card grid with a wall of filter chips and a separate
Rankings tab. It was rejected for the right reason: that is what every tool
directory on the internet looks like, and the scope is not only AI. The rebuild:

- **A database, not a directory.** Section tree on the left, dense sortable
  table in the middle, full record on the right. No cards.
- **Two levels of filing.** `group` › `category`, both free-form strings the
  user creates. One flat category list stops working the moment the board holds
  editors, VPNs and trading terminals alongside image models.
- **Notes and features on every record.** The thing the board is actually for.
- **The chip wall is gone.** Facts are sortable columns; the narrowing people
  repeat is a named view in the sidebar.
- **An LLM that files records**, with an offline fallback.

## Data model

`src/lib/ai-rankings/types.ts`:

| Field | Type | Purpose |
| --- | --- | --- |
| `name`, `url`, `summary` | string | What it is, one line |
| `group` / `category` | string | Two-level filing — AI › Image, Dev › Editors |
| `tags` | string[] | Capabilities: `vision`, `local`, `open-source`… |
| `access` | `free` \| `freemium` \| `paid` | What it costs *you* |
| `openSource` | boolean | Is the code or are the weights open |
| `hosting` | `hosted` \| `self-host` \| `both` | Website vs runs on your machine |
| `apiKey` | `required` \| `optional` \| `none` | Does calling it from code need a key |
| `haveKey` | boolean | Do you already hold that key |
| `pricingNote` | string? | Free text — "$20/mo", "credits", "50 free/day" |
| `notes` | string? | Freeform running log |
| `features` | `Feature[]` | `{text, verdict}` where verdict is love / good / miss / dealbreaker |
| `rank` | number? | 1-based position on its category leaderboard |
| `addedAt` / `updatedAt` | ISO date | New-vs-old, and last touched |

### Why access, openSource and hosting are three fields

The original ask was "free paid websites vs open-source free". Folding those
into one enum breaks on the common case: Flux and Stable Diffusion are open
weights *and* sell hosted paid tiers; Obsidian is closed, local and free.
Price, openness and location are independent, and the sidebar views treat them
that way — "Open source" and "Self-hostable" are different lists.

### Why features carry a verdict

A tool that lost the benchmark but owns one feature you rely on should keep its
rank, and the reason should be visible next to the number. Marking each note
love / good / miss / dealbreaker turns that into something the table can show
(a ★ count per row) and the "Has a love note" view can filter on.

### Why vision is a tag, not a category

Vision cuts across LLM, image and video models — a category would force a false
choice for every multimodal model. It lives in `tags`, which are filterable.

## Features are the navigation

The third pass came from one observation: *first/last frame*, *extend a clip*,
*cinematic* are not categories and not new axes — they are **features**, and the
real question is always "which of these do it". So the feature list stopped
being decoration on a record and became a way to browse:

- **A feature index in the sidebar**, counted and clickable. Clicking one
  filters the table to every record that has it. The index is scoped to the
  section currently selected, so browsing Video lists the features video tools
  have rather than everything on the board.
- **Loose matching** (`featureKey`) so "First-Last Frame" and "first last frame"
  are one row, plus **autocomplete** from wording already on the board when
  typing a new one. An index holding four spellings of one idea is not an index.
- **The classifier proposes features**, given the board's existing wording, and
  offers them as chips you tap to accept one at a time. Applying the filing
  fields and accepting features are separate actions on purpose — the filing is
  one decision, the features are several.

A leaderboard stays per category rather than per feature: filtering to a feature
and sorting by `#` already answers "of the ones that do this, my order", with no
second ranking model to keep in sync.

## Layout

Three panes:

1. **Sidebar** — saved views (All, Recently added, Ranked, Unranked, Open
   source, Free, Self-hostable, Needs a key, Key in hand, Has a love note), then
   the section tree with live counts and inline "+" to add a group or category.
2. **Table** — one row per record: rank, name + summary, section, cost, source,
   runs, key, added. Sortable headers. `table-fixed` so a long summary truncates
   instead of pushing the table off a phone screen.
3. **Record panel** — every field editable in place, plus the notes box, the
   feature list, and the rank controls. Full-screen sheet under `lg`.

**Ranking** is folded into the table rather than living in a separate tab. When
a single leaf category is selected, unranked rows show a "+" to join the board
and ranked rows become draggable; sorting by `#` shows the leaderboard with the
unranked pool beneath it. The record panel also has #-position, ▲▼ and Remove,
which is what works on touch.

## The LLM brain

`POST /api/ai-rankings/classify` takes a name, URL, summary, notes and the
user's existing tree, and returns a suggested group, category, summary, tags,
access, openSource, hosting, apiKey and pricing note. It follows the pattern
already used by the cookbook and blueprint routes: the Vercel AI Gateway when
`AI_GATEWAY_API_KEY` is set, and a keyword heuristic
(`src/lib/ai-rankings/classify.ts`) when it isn't — so the route never fails and
the feature works on a fresh clone with no key.

The suggestion is always shown for the user to **Apply or Discard**, and the
panel says which path produced it. Filing that happens behind your back is worse
than filing you have to confirm.

## Storage

Local-first, `localStorage` key `ai-rankings:v2`, seeded on first load. Mutators
in `store.ts` all return fresh data so the component does `setData(result)` —
the same boundary Recall uses, so a Supabase backend can be dropped in later
without touching the UI. Export JSON / Import JSON cover backup and moving
between machines. Ranks renumber to a gapless 1..n per leaf after every
mutation, so deleting a #2 can never leave a board reading 1,3,4.

## Seed

~95 real tools: 70 across the AI groups, plus Dev, Design, Productivity, Media,
Security and Trading so the two-level structure is visible from the first load.
Model knowledge has a cutoff, so some pricing and API details will be wrong —
every row is editable and the seed is a starting shape, not a reference. Ranks
and features start empty on purpose: those are the parts that are personal.

The seed is also **not the user's taste**, and was never going to be. Rows carry
checkboxes and the header strip grows a "Delete selected" with a confirm step,
so cutting fifty entries you did not ask for is a few clicks rather than fifty
deletions. Select-all applies to what is on screen, never the whole board, so
filtering to a section and clearing it is safe. The selection controls live in
the existing header strip rather than a bar of their own — a bar that appears
above the table pushes every row down by its own height, and the second checkbox
you click is then never the one you aimed at.

## File layout

```
src/lib/ai-rankings/types.ts      types + labels + group hues
src/lib/ai-rankings/seed.ts       the ~95 starter records
src/lib/ai-rankings/store.ts      localStorage CRUD, tree, features, ranking
src/lib/ai-rankings/query.ts      pure filter/sort/count + saved views
src/lib/ai-rankings/classify.ts   suggestion type + offline heuristic
src/app/api/ai-rankings/classify/route.ts   gateway call, heuristic fallback
src/components/ai-rankings/AiRankings.tsx   shell: top bar + three panes
src/components/ai-rankings/Sidebar.tsx      views + section tree
src/components/ai-rankings/ToolTable.tsx    the dense table
src/components/ai-rankings/DetailPanel.tsx  the record
src/components/ai-rankings/chips.tsx        pill primitives
src/app/apps/ai-rankings/page.tsx           thin route
```

Plus one entry in `src/lib/catalog.ts` so it appears on the hub.

## Out of scope

No cloud sync and no sharing — the store boundary keeps both as clean follow-ons.
No bulk "auto-file everything" pass yet; classification is one record at a time,
which is also what keeps every suggestion reviewable.

---
name: ai-rankings-app
description: "AI Rankings app at /apps/ai-rankings — a three-pane database of software (not just AI) with per-record notes/features, drag-to-rank per section, and an LLM auto-filer"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0d8e33e9-778b-41f5-9ed3-456568e3f0d1
  modified: 2026-09-13T20:09:02.929Z
---

AI Rankings is the user's database of every tool worth remembering, at
`/apps/ai-rankings` in the [[ultimate-assistant-os-portfolio]] hub. Built
2026-08-30. Spec: `docs/superpowers/specs/2026-08-30-ai-rankings-design.md`.

**It was rebuilt once, and the reason matters.** The first pass was a card grid
with a filter-chip rail and a separate Rankings tab. The user rejected it —
"i already see this everywhere" — and widened the scope: not just AI, but
software, websites and open-source generally. The rebuild is a three-pane
database: section tree (group › category, both free-form) on the left, dense
sortable `table-fixed` in the middle, full editable record on the right. No
cards, no chip wall. Assume this preference holds for future utility apps here:
**dense and database-like beats a card directory.**

Design decisions that shouldn't be undone:

- **Cost, openness and hosting are three independent fields** (`access`,
  `openSource`, `hosting`). Flux is open weights *and* sells a paid hosted tier;
  Obsidian is closed, local and free. One enum can't say that.
- **Features ARE the organising principle**, not a decoration. The user's words:
  "first last frame, extend video, some video generators are cinematic some are
  not — these are just features, the website should help categorize". So the
  sidebar carries a clickable feature index (scoped to the selected section),
  feature text matches loosely so one idea is one row, the input autocompletes
  from wording already on the board, and the classifier proposes features as
  tap-to-accept chips. Do not turn features into a separate axis or a per-section
  checklist — the user rejected both.
- **Every record carries `notes` plus `features[]`**, each feature marked love /
  good / miss / dealbreaker. That list is the written case for the rank — a tool
  that isn't best overall but owns one feature keeps its slot and says why. Rows
  show a ★ count.
- **The board ships EMPTY.** On 2026-09-06 the user cleared all 95 seeded rows
  to enter their own — "keep the categories and colors, i just want to input my
  own listings". `seed.ts` is now `SEED_TREE` (group → categories) and nothing
  else; `buildSeed()` returns `{ tools: [], tree }`. Group colours survive
  because `groupHue` derives them from the name. **Never re-add seeded records.**
  The header has a two-step "Clear all records" (`store.clearTools()`) that keeps
  the tree; it disarms itself after 5s.
- **A date range (`filters.added`) is a filter, not a view** — presets 7d/30d/
  3mo/1yr plus a custom from/to, either end optional, parsed at LOCAL midnight
  and local end-of-day so a named day is inclusive at both ends. Picking one
  also sets the sort to newest-first. It replaced the old "Recently added" view,
  which could not be held alongside another view.
- **`sortTools("newest", "asc")` IS newest-first** — it compares b to a. The
  header click used to force `desc` on the first click, which showed the OLDEST
  record at the top of a column labelled "Added"; fixed 2026-09-06.
- **Vision is a tag, not a category** — the user said so themselves.
- **`contentRating` is a fourth independent axis** (`unknown | sfw | soft |
  explicit`), added 2026-09-06 for image/video models that can generate X-rated
  output. The NSFW filter (All / Safe / 18+) is deliberately NOT part of
  `Filters`: it narrows the pool everything else — sidebar counts, feature
  index, search, select-all — is measured against, it persists in its own
  localStorage key, and "reset" must never switch it off. Safe mode hides
  `soft` + `explicit` only; **unrated stays visible**, because unrated is not
  the same as safe.
- **Ranking lives in the table**, not a separate view: pick a leaf category and
  rows become rankable/draggable. Ranks renumber gaplessly per leaf.
- **Auto-file always suggests, never applies.** `/api/ai-rankings/classify` uses
  the AI Gateway when `AI_GATEWAY_API_KEY` is set and a keyword heuristic
  (`lib/ai-rankings/classify.ts`) when it isn't, so it works with no key.

- **"New" is a menu: Analyze a link / Blank entry** (added 2026-09-13). Paste a
  URL → `/api/ai-rankings/analyze-url` reads the page (via social-import
  `safeFetch`, SSRF-guarded), scans same-origin JS bundles for GitHub / HF /
  arXiv links when the HTML has none (SPA project pages like
  auk-project.github.io render them from script), reads the GitHub + HF APIs,
  then files with the SAME prompt pieces as /classify (`FILING_RULES` etc. in
  `classify.ts`). Pure logic in `lib/ai-rankings/analyzeLink.ts` (tested),
  fetching in `readSite.ts`. **This path deliberately WRITES the record
  directly** — the user asked for "it makes the entry for me" — and opens it in
  the panel for review; it is the one exception to "auto-file never applies".
  API licence facts override the model on openSource; the Links block in notes
  is written by code, not the model; a github.com/huggingface.co link keeps
  `owner/repo` as the name; same URL twice opens the existing record.

Local-first, `localStorage` key `ai-rankings:v2` (scoped per account), no seeded
records, JSON export/import. Same store boundary as [[recall-app]], so a cloud backend can drop in
without touching components.

Open question: the app is still *named* "AI Rankings" though it now holds Dev,
Design, Productivity, Media, Security and Trading records too.

# Projects Timeline

Route: **`/apps/projects-timeline`** · Category: AI · one of the 40 apps in this hub.

> This page used to be the repository's root `README.md`, which made every tool that
> cloned the repo believe the whole project was this one app. The root README now
> describes the hub; the app-level detail lives here.

A **project intelligence system** — the first module of the *Ultimate Assistant OS*. It
helps you organize, store, understand, and continuously refine projects over time,
becoming the single source of truth for each one (websites, mobile apps, MT4 Expert
Advisors, trading systems, AI agents, businesses, automations, software tools, and future
ideas).

No configuration is required — the app boots in **local demo mode** (data persists in
your browser via `localStorage`) and ships with seed projects, including the
`GoldEA Basket Trader` MT4 example.

---

## Features

- **Left sidebar** — searchable, scrolling list of every project (name · one-line summary · last-updated), with a Create Project button. Built to handle hundreds of projects.
- **Project view** — title, one-line summary, plain-English overview, and metadata.
- **Features** — **Core** features as green cards (what the project fundamentally is) and **Supporting** features as blue cards (enhancements, refinements, visual upgrades, bug fixes, quality-of-life).
- **Version timeline** — versions in chronological order; click to expand summary, date, and files.
- **Per-version file storage** — files belong to a *version*, not the project. Supports PDF, images, video, documents, ZIP, source code, `.mq4`, `.ex4`, and more, with typed badges.
- **Project Knowledge Inbox** — the project's permanent **memory**. Save notes, ideas, feature requests, Claude/ChatGPT/AI conversations, dev updates, documentation, bug reports, and brain dumps. Entries stay attached forever and are shown chronologically.
  - **Upload & auto-summarise files** — drop in a **PDF, Word doc, text file, or image**; the AI reads it (PDF/DOCX text extraction, OCR + vision for images) and writes an editable summary that becomes the entry. The source file is kept as an attachment. Falls back to a built-in extractive summariser when no AI key is set (text/PDF/DOCX still read locally; images need a key for vision).
- **AI Project Analyst** — *not a chatbot*. One **Regenerate Project** button analyzes the Knowledge Inbox, versions, files, and existing features, then proposes an updated one-liner, overview, core/supporting features, and version summaries — plus a **Change Detection** breakdown (new features, feature changes, improvements, bug fixes, missing documentation). You review the diff and **Apply**.

---

## How it works: two backends, one UI

A backend-agnostic `Repo` interface (`src/lib/repo/`) has two implementations selected at
runtime:

| Mode | When | Storage | Auth | Files |
|------|------|---------|------|-------|
| **Local demo** | no env vars | `localStorage` | none | inlined (< 1.5 MB) |
| **Supabase** | env vars set | Postgres | email/password | Storage bucket |

The UI never knows which backend is active. Enabling Supabase is a repository-wide step,
not an app-level one — see [Supabase](../../README.md#supabase-optional) in the root README.

## The AI analyst

Without a key the analyst uses a built-in **heuristic** engine, so the feature works
offline. With `AI_GATEWAY_API_KEY` set it calls a real LLM through the Vercel AI Gateway.

The endpoint is `src/app/api/regenerate/route.ts`. It sends structured-JSON instructions
and falls back to the heuristic on any error, so the button never fails.

---

## Where this app's code lives

```
src/app/apps/projects-timeline/page.tsx   the page
src/components/                           AppShell, Sidebar, ProjectView,
                                          FeaturesSection, VersionTimeline,
                                          KnowledgeInbox, AIPanel, modals…
src/lib/types.ts                          domain model
src/lib/store.ts                          Zustand store + selectors
src/lib/analyst.ts                        offline heuristic analyzer
src/lib/repo/                             Repo interface + local + supabase impls
src/app/api/regenerate/route.ts           AI Project Analyst endpoint
```

Auth and session gating are shared with the rest of the hub (`src/middleware.ts`,
`src/app/login/`, `src/app/auth/callback/route.ts`), not owned by this app.

---

## Design intent

Projects Timeline is intentionally self-contained: it owns its data and shares only the
auth + design layer, so it slots into the larger modular OS alongside every other app in
[`docs/apps/README.md`](README.md).

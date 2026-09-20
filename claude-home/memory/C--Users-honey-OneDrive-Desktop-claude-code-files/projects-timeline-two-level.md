---
name: projects-timeline-two-level
description: "Projects Timeline's two-level writeups, the seed-content enrichment pattern, and the pristine-only backfill rule"
metadata: 
  node_type: memory
  type: project
  originSessionId: aea589cd-f474-45f2-a12d-3f6cd81fb7d6
  modified: 2026-08-29T00:00:55.394Z
---

Projects Timeline gives every project a **basic overview** (2–3 sentences) and a **detailed explanation** (long-form, lossless). The heuristic/local path is the default — no AI key needed.

**Rich content pattern:** hand-written project content lives in `src/lib/seed-content/<slug>.ts`, exporting `<slug>Detailed()`, `<slug>Features(projectId)`, `<slug>Versions(projectId)`, `<slug>Knowledge(projectId)`. Wire it into `applyEnrichment()` in `src/lib/seed.ts`. Examples: `amhe.ts`, `recall.ts`.

**Why the backfill matters:** `LocalRepo` only merges *new* catalog slugs, so a project already seeded in someone's browser never picks up content written later — it stays an empty shell forever. `backfillEnrichment()` fixes this, and its rule is the important part: **only fill a project that is completely pristine** (`isPristine` — no detailed, no features, no versions, no knowledge). A project the user has written into is never overwritten.

**How to apply:** when documenting a project after a long editing session, put the small decisions in `Knowledge` entries (the reference that drove the design, the user's own words, rejected alternatives, bugs found, what's unverified) and the structure in `Detailed`. Map the back-and-forth onto `Versions` — each iteration gets a summary saying what changed *and why*. That is what makes the entry useful to another agent.

Detailed writeups render through `src/components/Markdown.tsx` — a dependency-free renderer covering headings, bold/italic, inline code, lists, tables and rules. It interprets no raw HTML, so AI-generated writeups are safe to display. Knowledge entries stay `whitespace-pre-wrap` on purpose; their line breaks are intentional.

Related: [[recall-app]], [[ultimate-assistant-os-portfolio]]

---
name: document-apps-as-built
description: "Standing request — write each new app's Projects Timeline entry at the end of its build session, capturing the back-and-forth"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: aea589cd-f474-45f2-a12d-3f6cd81fb7d6
  modified: 2026-08-29T00:10:31.699Z
---

From 2026-08-28 onward: **at the end of a session that builds or substantially reworks an app, write its Projects Timeline entry before finishing.** The user asked for this after seeing the Recall writeup and confirming that going back to reconstruct older apps was not worth it — "just start from now on all future apps."

**Why:** the small decisions only exist in the conversation. Code shows *what*, never *why* — not why an alternative was rejected, not which gotcha cost an hour, not what is built-but-unverified. Once the session ends that layer is only recoverable by reading a 400-message transcript, which is expensive and does not scale. Writing it while the context is live is nearly free.

**How to apply:** create `src/lib/seed-content/<slug>.ts` exporting `<slug>Detailed()`, `<slug>Features(projectId)`, `<slug>Versions(projectId)`, `<slug>Knowledge(projectId)`, then wire it into `applyEnrichment()` in `src/lib/seed.ts` — see [[projects-timeline-two-level]] for the pattern and the pristine-only backfill rule. Use `recall.ts` as the quality bar.

What actually earns its place, learned from the Recall entry:
- **Rejected alternatives with the reason** — more useful than the thing that shipped
- **The user's own words, quoted verbatim** — paraphrase loses the intent
- **Invariants that are invisible in a screenshot** and would be destroyed by a well-meaning rewrite
- **Versions mapping the iterations**, each saying what changed *and why*
- **An honest "known gaps / unverified" entry** — never let built-but-untested read as working

Related: [[projects-timeline-two-level]], [[recall-app]]

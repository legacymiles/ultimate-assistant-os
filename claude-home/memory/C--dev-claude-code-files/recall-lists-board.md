---
name: recall-lists-board
description: "Recall's second home tab — a shared family Lists board (to-do/to-buy/bills) with invite links, per-member colours and admin-vs-member permissions; the one part of Recall stored server-side"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3e21f789-8c95-4c07-b08c-670df3d25a24
  modified: 2026-08-29T01:38:25.985Z
---

Added 2026-08-28. Recall's home page now has two tabs: **Folders** (the RAG side, unchanged) and **Lists** — a shared household board of short-lived items. See [[recall-app]].

Eight built-in lists (To-Do, To-Buy, Remember, Ideas, Goals, Projects, Bills, Notes) as a card wall; empty ones collapse to one line. Two colour axes that never overlap: the left dot is urgency (red urgent / orange running low / yellow wish list / grey normal — four states, because forcing three would make them meaningless), the right circle is which family member added it.

**The load-bearing decision:** Lists is the ONE part of Recall that is NOT localStorage. It's server-side in `.recall-lists.json` (same pattern as `.recall-gate.json`), because the feature is defined by an invite link someone opens on their own phone. `RECALL_DATA_DIR` moves both files to a mounted volume. That store file is the Supabase seam.

**Why:** the user wanted family members to "join through a one-time sign-up link" and to reach "only the list, not the RAG side of Recall". Both are impossible with browser-local data.

**How to apply:** two principals, two cookies — `recall_auth` (admin, = app password) and `recall_member` (HMAC-signed). The member cookie is resolved FIRST on purpose; otherwise an ungated Recall resolves everyone to admin and the rules evaporate. Members are blocked server-side from `/apps/recall`, `/api/recall`, `/api/recall/extract` — never by hiding UI. Permission lives in `src/lib/recall/lists/store.ts`, checked on every mutation; the one deliberate exception is that ANYONE can tick an item done (if you buy the milk someone else added, you must be able to check it off), while edit/delete stay owner-scoped.

Spec: `docs/superpowers/specs/2026-08-28-recall-lists-design.md`. Full rationale also lives in `src/lib/seed-content/recall.ts` section 13.

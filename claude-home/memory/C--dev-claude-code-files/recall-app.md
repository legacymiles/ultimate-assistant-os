---
name: recall-app
description: Recall — the folder-as-page second brain at /apps/recall; its load-bearing invariants and where its full spec lives
metadata: 
  node_type: memory
  type: project
  originSessionId: aea589cd-f474-45f2-a12d-3f6cd81fb7d6
  modified: 2026-08-29T00:00:42.897Z
---

Recall (`/apps/recall`) was rebuilt from a capture-and-tag notes app into a **folder-as-page second brain**, driven by a reference screenshot of the user's own Lovable app ("golden-print-flow"). Home is folder tiles only; opening a folder shows opt-in typed sections (sub-folders as tiles, notes, to-dos, links & files, logins, websites) added from one `+ Add section` menu.

**Why:** every piece of the user's feedback pushed toward *less on screen by default, more on demand*. That is the app's design principle — derived from the edits, not declared up front.

**How to apply:** the full spec — exact crypto parameters, storage layout, extraction matrix, the 13 agent actions, rejected alternatives, and bugs fixed — now lives in the Projects Timeline entry for Recall (`src/lib/seed-content/recall.ts`), not here. Read that before redesigning. The invariants most easily destroyed in a rewrite, because neither is visible in a screenshot:

1. A section holding items **always renders**, listed or not; a non-empty section **cannot be removed**. Turning a section off must never hide data.
2. Credentials are filtered out of `retrieveForQuestion`, so a saved login never reaches the AI Gateway.

Also load-bearing: **saved passwords are plaintext by the user's explicit decision** (2026-09-07). The master-password vault was removed — no gate to see a login, `item.password` holds the value, Settings › Saved passwords lists every one across folders with reveal/copy, and `legacyVault.ts` exists only to import old ciphertexts once. Do not reintroduce encryption or a second password here: an unrecoverable password was the thing they wanted gone.

Also load-bearing: file blobs live in **IndexedDB** (`recall-files`/`blobs`), never localStorage — its ~5MB cap would break on the first photo. Only extracted text + a small thumbnail go to localStorage.

Related: [[projects-timeline-two-level]], [[hub-parallel-dev-servers]], [[ultimate-assistant-os-portfolio]]

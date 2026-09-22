---
name: ea-feature-list-app
description: "Expert Advisor Feature List app at /apps/ea-feature-list — code-defined, tagged EA feature specs the user dictates"
metadata: 
  node_type: memory
  type: project
  originSessionId: fbcc301e-6832-411f-90bc-effb5358c386
  modified: 2026-07-21T16:16:02.575Z
---

Built 2026-07-21: **Expert Advisor Feature List** — a tagged, searchable vault of MT4/MT5 Expert Advisor feature specs at `/apps/ea-feature-list` in the Assistant OS hub (registered in `src/lib/catalog.ts`, category Trading). The user **dictates features in chat and I append them to the list**; there is deliberately no add/edit UI.

Files: `src/lib/ea-features/types.ts` (`EaFeature`: id, title, summary, tags[], body, addedAt), `src/lib/ea-features/features.ts` (`EA_FEATURES` + `allTags()` + `filterFeatures()`), `src/components/ea/` (EaFeatureList, EaFeatureRow, EaFeatureDetailModal, TagPill), `src/app/apps/ea-feature-list/page.tsx`. UI mirrors [[skills-library-app]]: search box, tag filter chips (multi-select, AND'd), rows → detail modal with the verbatim spec in a mono `<pre>` + "Copy spec". Tag pills on rows are clickable and toggle the filter. Search covers title, summary, tags **and the full spec body**.

**Why code-defined (not Supabase/localStorage):** same reasoning as featured skills — this repo runs local mode with no Supabase, so per-browser storage would never reach the deployed site. Baking features into `features.ts` means they ship with every deploy and every browser.

**How to apply:** to add a feature, append an object to `EA_FEATURES` — keep `body` verbatim (it's what gets copied into a build agent), give it a kebab-case `id`, a one-line `summary`, and reuse existing tag labels where they fit so the filter chips stay tidy. First feature: `intelligent-position-addition-manager` (only add a new 0.02 lot when secured profit + trailing stop can absorb it, then recalc the trailing stop for the new basket size). Changes need a deploy to reach the live Vercel site (`ultimate-assistant-os`).

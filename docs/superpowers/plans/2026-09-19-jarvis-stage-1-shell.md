# Jarvis Stage 1 (shell, memory core, dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename New Dashboard to Jarvis at `/apps/jarvis` with a tabbed shell (Dashboard, Chat, Inbox, Calendar, Memory, Routines, Profile), a three.js "memory core" sphere of connected dots, and a dashboard that reads the owner's existing profile — all working with no keys set.

**Architecture:** New `src/components/jarvis` + `src/lib/jarvis` modules. The existing New Dashboard component is reused wholesale as the Profile tab (no rewrite, no data migration: same `new-dashboard` store key). Memory is abstracted behind `memoryClient.ts` so Stage 2 can swap the local keyword store for Supabase hybrid search without touching the UI.

**Tech Stack:** Next 15 App Router, TypeScript, Tailwind v4 tokens (`panel`, `line`, `ink`), `@react-three/fiber` + `three` (already dependencies), vitest, `loadLocal`/`saveSynced` for cross-device state.

**Spec:** `docs/superpowers/specs/2026-09-19-jarvis-design.md`

---

### Task 1: Jarvis types and store

**Files:**
- Create: `src/lib/jarvis/types.ts`, `src/lib/jarvis/store.ts`
- Test: `src/lib/jarvis/store.test.ts`

- [ ] **Step 1: Write the failing test** — `emptyJarvis()` returns `version: 1` with empty
  conversations/memories/messages/events/routines seeded from `SEED_ROUTINES`, and
  `mergeProfileStore` reads the existing `new-dashboard` blob unchanged (same key, untouched).
- [ ] **Step 2:** `npx vitest run src/lib/jarvis/store.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement. `types.ts` holds `JarvisStore`, `Memory`, `Conversation`, `ChatTurn`,
  `InboxMessage`, `CalEvent`, `Routine`, `PendingAction`, `MemorySource`. `store.ts` holds
  `JARVIS_KEY = "jarvis"`, `emptyJarvis()`, `loadJarvis()`, `saveJarvis()` (via `saveSynced`).
  Profile data stays under `STORE_KEY` from `src/lib/new-dashboard/model.ts`.
- [ ] **Step 4:** vitest → PASS.
- [ ] **Step 5:** Commit `Jarvis: store and types`.

### Task 2: Memory client (local keyword implementation)

**Files:**
- Create: `src/lib/jarvis/memoryClient.ts`, `src/lib/jarvis/rank.ts`
- Test: `src/lib/jarvis/rank.test.ts`

- [ ] **Step 1: Write the failing test** for `rrf(listA, listB)`: an item ranked 1st in one list and
  absent in the other beats an item ranked 3rd in both; ids are unique in the output; empty inputs
  give `[]`.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** Implement `rrf` (reciprocal rank fusion, k = 60) and `keywordScore(q, m)`
  (lowercased token overlap over title+content, title weighted ×2). `memoryClient.ts` exposes
  `searchMemories(store, q, k)` using `keywordScore`, `addMemory`, `graphNodes(store, cap)`.
  It is the only module the UI imports for memory, so Stage 2 can replace its body with a fetch.
- [ ] **Step 4:** vitest → PASS.
- [ ] **Step 5:** Commit `Jarvis: local memory client with rank fusion`.

### Task 3: Memory core (three.js sphere)

**Files:**
- Create: `src/components/jarvis/MemoryCore.tsx`
- Modify: none

- [ ] **Step 1:** Implement `<MemoryCore nodes amplitude mode onPick search />` with
  `@react-three/fiber`: Fibonacci sphere placement, `<points>` with a circular sprite texture drawn
  to a canvas, per-node colour from `SOURCE_COLOR`, additive blending, `<lineSegments>` for links,
  slow rotation in `useFrame`, radius scaled by `1 + amplitude * 0.15`. `mode: "sphere" | "network"`
  lerps between the sphere layout and a clustered-by-source layout. `frameloop="demand"` is NOT used
  (it animates), but the canvas must not render when `document.hidden`.
- [ ] **Step 2:** Empty state: 400 dim placeholder dots + centred "No memories yet".
- [ ] **Step 3:** Verify in the browser at `/apps/jarvis` once Task 5 lands (spinning sphere, no
  console errors, ~60fps).
- [ ] **Step 4:** Commit `Jarvis: memory core sphere`.

### Task 4: Route, redirect, catalog rename

**Files:**
- Create: `src/app/apps/jarvis/page.tsx`
- Modify: `src/app/apps/new-dashboard/page.tsx` (becomes `redirect("/apps/jarvis")`),
  `src/lib/catalog.ts:76-91` (slug/title/tag/overview), `src/lib/catalog.ts:695` (UNPREVIEWABLE),
  `.claude/launch.json` (preview entry `jarvis`, port 3240)
- Test: `src/lib/jarvis/store.test.ts` (extend: catalog has a `jarvis` slug and no `new-dashboard`)

- [ ] **Step 1:** Write the failing catalog test.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** Make the edits. Check for other references:
  `grep -rn "new-dashboard" src docs .claude` and update every user-facing one.
- [ ] **Step 4:** vitest → PASS; `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `Jarvis: route, redirect from new-dashboard, catalog entry`.

### Task 5: Shell (left rail + tabs)

**Files:**
- Create: `src/components/jarvis/Jarvis.tsx`, `src/components/jarvis/Shell.tsx`

- [ ] **Step 1:** `Shell` renders a dense dark layout: left rail with Dashboard / Chat / Inbox /
  Calendar / Memory / Routines / Profile (icons from `src/components/icons`), a top bar with
  "Hub" back link, the profile picker, a mic button (disabled placeholder in Stage 1, tooltip
  "Voice arrives in stage 3"), and a status pill showing which capabilities are live
  (`Memory: local`, `Apps: not connected`).
- [ ] **Step 2:** Tab state lives in the URL hash (`#chat`) so a reload keeps the tab.
- [ ] **Step 3:** Profile tab renders the existing `<NewDashboard chromeless />` — add a
  `chromeless` prop to `NewDashboard` that hides its own top bar (it keeps everything else).
- [ ] **Step 4:** Browser check at 1440px and 390px: no horizontal scroll, rail collapses to icons.
- [ ] **Step 5:** Commit `Jarvis: app shell with tabs`.

### Task 6: Dashboard tab

**Files:**
- Create: `src/components/jarvis/DashboardTab.tsx`
- Test: `src/lib/jarvis/brief.test.ts`, `src/lib/jarvis/brief.ts`

- [ ] **Step 1: Write the failing test** for `briefInputs(profile, store, now)`: returns priorities
  not yet done, the next 3 events after `now`, unread inbox count, and 5 most recent memories —
  and returns empty arrays (never invented filler) when the store is empty.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** Implement `brief.ts`, then `DashboardTab.tsx`: memory core hero with the
  `N memories · M links` HUD, then a dense grid — Today (date + priorities with done toggles),
  Next up (events), Inbox (count + 3 subjects), Recent memories. Every panel prints its source
  line ("from your profile", "local memory") and an honest empty state.
- [ ] **Step 4:** vitest → PASS; browser check.
- [ ] **Step 5:** Commit `Jarvis: dashboard tab`.

### Task 7: Placeholder tabs that are honest

**Files:**
- Create: `src/components/jarvis/Placeholder.tsx`

- [ ] **Step 1:** Chat, Inbox, Calendar, Routines render `<Placeholder stage={n} does={...} />`:
  a short line saying what the tab will do and what stage adds it. Memory tab renders the full
  memory core + the local memory list + a "Write a note" box that saves a memory (works today).
- [ ] **Step 2:** Browser check each tab renders, no console errors.
- [ ] **Step 3:** Commit `Jarvis: memory tab and honest placeholders`.

### Task 8: Verify and deploy

- [ ] **Step 1:** `npx vitest run src/lib/jarvis` → all PASS.
- [ ] **Step 2:** `npx tsc --noEmit` → clean. `npm run build` → succeeds.
- [ ] **Step 3:** Preview server on port 3240, walk every tab, screenshot the sphere.
- [ ] **Step 4:** Merge to `main` and push so it deploys; confirm `/apps/jarvis` loads on the live
  site and `/apps/new-dashboard` redirects.
- [ ] **Step 5:** Commit/merge message `Jarvis stage 1: shell, memory core, dashboard`.

---

## Self-review notes

- Spec §3 folder layout, §4.1 memory core, §4.7 dashboard and §1 rename are covered by Tasks 1–8.
- Spec §4.2–4.6 (Supabase memory, agent loop, voice, connectors) are Stages 2–4 and get their own
  plans; Task 7 makes their absence visible rather than faked.
- Type names used here (`JarvisStore`, `Memory`, `MemorySource`, `graphNodes`, `rrf`) are defined in
  Tasks 1–2 and reused unchanged in later tasks.

# Phase 0: Make the Assistant Actually Run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The assistant performs "move my vps 2026 folder into a trading fx subfolder" instead of returning a keyword-search result, and can never again silently impersonate a working AI when no key is configured.

**Architecture:** No new architecture. `move_folder` already exists end to end (type → validation → `moveFolder()` → confirmation UI); the only missing link was that `/api/recall` returns `null` before calling a model when `AI_GATEWAY_API_KEY` is absent, so the client falls back to `heuristicAnswer`. This phase (1) makes that fallback announce itself, (2) refreshes stale model defaults, (3) exposes folder-move in the UI so the assistant is not the only path, and (4) adds the repo's first test framework so the reported bug has a regression test.

**Tech Stack:** Next.js App Router, TypeScript, React, `vitest` (new dev dependency, node environment). No `zod` — validation follows the existing hand-written switch in `agent.ts`.

**Spec:** `docs/superpowers/specs/2026-09-07-dashboard-iphone-ingest-design.md` § 0

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `package.json` | add `vitest` devDep + `test` script | Modify |
| `vitest.config.ts` | node environment, `@/` alias | Create |
| `src/lib/recall/agent.ts` | degraded-mode notice on the heuristic path | Modify |
| `src/lib/recall/agent.test.ts` | regression tests for validation + degraded mode | Create |
| `src/lib/recall/store.test.ts` | regression tests for `moveFolder` cycle safety | Create |
| `src/app/api/recall/route.ts` | refresh stale model default | Modify |
| `src/app/api/recall/photos/route.ts` | refresh stale model default | Modify |
| `src/components/recall/MoveFolderDialog.tsx` | parent picker, excludes descendants | Create |
| `src/components/recall/FolderWorkspace.tsx` | wire "Move to…" into the folder menu | Modify |

---

## Task 1: Test framework

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 3: Add the `test` script to `package.json`**

Add to the `"scripts"` object, after `"lint"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs with no tests**

Run: `npm test`
Expected: exits 0 (or reports "No test files found"). Not a failure.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "Add vitest so the reported agent bug can have a regression test"
```

---

## Task 2: Regression test for the reported bug

The bug report was: *"can u move my vps 2026 folder into a trading fx subfolder"* returned a
search result. `sanitizeActions` is the function that decides whether a proposed
`move_folder` survives. These tests pin its behaviour so a future prompt change
cannot silently break it.

**Files:**
- Create: `src/lib/recall/agent.test.ts`
- Modify: `src/lib/recall/agent.ts` (export the validator for testing)

The function is `sanitizeActions` at `src/lib/recall/agent.ts:188`. Its real
signature is:

```ts
function sanitizeActions(input: unknown, data: RecallData, events: CalendarEvent[]): AgentAction[]
```

Three arguments, not two — `events` is required even for folder actions.

- [ ] **Step 1: Export `sanitizeActions`**

In `src/lib/recall/agent.ts:188`, change:

```ts
function sanitizeActions(input: unknown, data: RecallData, events: CalendarEvent[]): AgentAction[] {
```

to:

```ts
export function sanitizeActions(input: unknown, data: RecallData, events: CalendarEvent[]): AgentAction[] {
```

Change nothing else about it.

- [ ] **Step 2: Write the failing test**

Create `src/lib/recall/agent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RecallData } from "./types";
import { sanitizeActions } from "./agent";

// Mirrors the reported tree: a top-level "vps 2026" and a "trading fx".
const DATA = {
  folders: [
    { id: "f_vps", name: "vps 2026", parentId: null },
    { id: "f_fx", name: "trading fx", parentId: null },
  ],
  items: [],
} as unknown as RecallData;

describe("move_folder survives sanitizeActions", () => {
  it("keeps a move_folder naming a real folder", () => {
    const out = sanitizeActions(
      [{ type: "move_folder", folderId: "f_vps", path: ["trading fx"] }],
      DATA,
      [],
    );
    expect(out).toEqual([
      { type: "move_folder", folderId: "f_vps", path: ["trading fx"] },
    ]);
  });

  it("drops a move_folder naming a folder that does not exist", () => {
    const out = sanitizeActions(
      [{ type: "move_folder", folderId: "f_nope", path: ["trading fx"] }],
      DATA,
      [],
    );
    expect(out).toEqual([]);
  });

  it("keeps create_folder + move_folder together when the target is new", () => {
    const out = sanitizeActions(
      [
        { type: "create_folder", path: ["trading fx", "vps"] },
        { type: "move_folder", folderId: "f_vps", path: ["trading fx", "vps"] },
      ],
      DATA,
      [],
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ type: "move_folder", folderId: "f_vps" });
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/lib/recall/agent.test.ts`

Expected: PASS if the validator already behaves correctly (it should — this is a
characterisation test proving the capability was never the problem). If any case
FAILS, that is a real second bug: fix `sanitizeActions` so it passes, and say so
in the commit message.

- [ ] **Step 4: Commit**

```bash
git add src/lib/recall/agent.ts src/lib/recall/agent.test.ts
git commit -m "Pin move_folder validation with the reported case as a test"
```

---

## Task 3: Cycle safety for moveFolder

`wouldCycle` is at `src/lib/recall/store.ts:452` and is **not** exported.

**Files:**
- Modify: `src/lib/recall/store.ts:452`
- Create: `src/lib/recall/store.test.ts`

- [ ] **Step 1: Export `wouldCycle`**

Change line 452 from:

```ts
function wouldCycle(folders: Folder[], folderId: string, candidateParent: string | null): boolean {
```

to:

```ts
export function wouldCycle(folders: Folder[], folderId: string, candidateParent: string | null): boolean {
```

- [ ] **Step 2: Write the test**

Create `src/lib/recall/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Folder } from "./types";
import { wouldCycle } from "./store";

const FOLDERS = [
  { id: "f_fx", name: "trading fx", parentId: null },
  { id: "f_vps", name: "vps 2026", parentId: "f_fx" },
] as unknown as Folder[];

describe("wouldCycle", () => {
  it("allows moving a folder under an unrelated parent", () => {
    expect(wouldCycle(FOLDERS, "f_vps", null)).toBe(false);
  });

  it("refuses moving a folder into its own descendant", () => {
    expect(wouldCycle(FOLDERS, "f_fx", "f_vps")).toBe(true);
  });

  it("refuses moving a folder into itself", () => {
    expect(wouldCycle(FOLDERS, "f_fx", "f_fx")).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/lib/recall/store.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/recall/store.ts src/lib/recall/store.test.ts
git commit -m "Test that moveFolder cannot create a cycle"
```

---

## Task 4: Make degraded mode announce itself

This is the fix for the actual reported experience. When no key is configured the
reply must not look like an answer the assistant reasoned its way to.

**Files:**
- Modify: `src/lib/recall/agent.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/recall/agent.test.ts`:

```ts
import { degradedNotice } from "./agent";

describe("degraded mode", () => {
  it("says the assistant is offline and names the missing key", () => {
    const notice = degradedNotice();
    expect(notice).toMatch(/AI_GATEWAY_API_KEY/);
    expect(notice.toLowerCase()).toMatch(/search/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/lib/recall/agent.test.ts`
Expected: FAIL — `degradedNotice is not a function` / has no exported member.

- [ ] **Step 3: Implement `degradedNotice` in `src/lib/recall/agent.ts`**

Add above `heuristicAnswer`:

```ts
/**
 * What the assistant says when no model is configured.
 *
 * This exists because the silent fallback was itself the bug: with no key, the
 * route returned null, the keyword search answered instead, and the result read
 * as a stupid AI rather than an absent one. A user cannot debug what does not
 * announce itself.
 */
export function degradedNotice(): string {
  return (
    "⚠️ AI is off — this is a keyword search, not an answer.\n" +
    "Set AI_GATEWAY_API_KEY in .env.local and restart the dev server to enable " +
    "reasoning and actions (moving folders, creating events, filing items).\n"
  );
}
```

- [ ] **Step 4: Prefix the heuristic reply with it**

In `askAgent`, find where the reply falls back to `heuristicAnswer` (the branch
taken when the route returns `{ reply: null }`). Change the answer assignment
from:

```ts
    answer: heuristicAnswer(question, candidates, data.folders, soon),
```

to:

```ts
    answer: degradedNotice() + "\n" + heuristicAnswer(question, candidates, data.folders, soon),
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add src/lib/recall/agent.ts src/lib/recall/agent.test.ts
git commit -m "Say when AI is off instead of faking an answer

The silent fallback to keyword search is what made the assistant look
broken: with no key it returned a search hit phrased as a reply."
```

---

## Task 5: Refresh stale model defaults

`anthropic/claude-sonnet-4-6` is previous-generation and now costs more than the
current `claude-sonnet-5` ($3/$15 vs $2/$10 per 1M tokens). These are the
hardcoded fallbacks used only when `AI_MODEL` is unset.

**Files:**
- Modify: `src/app/api/recall/route.ts:160`
- Modify: `src/app/api/recall/photos/route.ts:117`

- [ ] **Step 1: Update the agent route default**

In `src/app/api/recall/route.ts`, change:

```ts
  const model = process.env.AI_MODEL || "anthropic/claude-sonnet-4-6";
```

to:

```ts
  const model = process.env.AI_MODEL || "anthropic/claude-opus-5";
```

- [ ] **Step 2: Update the vision route default**

In `src/app/api/recall/photos/route.ts`, change:

```ts
  const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || "anthropic/claude-sonnet-4-6";
```

to:

```ts
  const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || "anthropic/claude-opus-5";
```

- [ ] **Step 3: Confirm no other stale defaults remain**

Run: `grep -rn "claude-sonnet-4-6" src/ .env.example`
Expected: only `.env.example` may match. If `src/` matches, update those too.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/recall/route.ts src/app/api/recall/photos/route.ts
git commit -m "Default to Opus 5; sonnet-4-6 is older and now more expensive"
```

---

## Task 6: "Move to…" in the folder UI

`moveFolder` is currently called from no component — the assistant is the only
way to move a folder. That is why the user hit the assistant for a structural
edit in the first place.

**Files:**
- Create: `src/components/recall/MoveFolderDialog.tsx`
- Modify: `src/components/recall/FolderWorkspace.tsx`

- [ ] **Step 1: Read the existing dialog and menu patterns**

Run: `sed -n '1,60p' src/components/recall/FolderDialog.tsx`
Run: `grep -n "removeFolderSection\|menu\|onData" src/components/recall/FolderWorkspace.tsx | head -30`

Match the styling, prop shape and `onData(...)` convention exactly. Do not invent
a new dialog idiom.

- [ ] **Step 2: Create `src/components/recall/MoveFolderDialog.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { moveFolder, folderPathString } from "@/lib/recall/store";
import type { RecallData } from "@/lib/recall/types";

/**
 * Choose a new parent for a folder.
 *
 * Descendants are excluded from the list rather than merely rejected on submit:
 * `wouldCycle` already refuses those moves silently, and a control that offers a
 * choice it will then ignore is worse than one that never offers it.
 */
export function MoveFolderDialog({
  folderId,
  data,
  onData,
  onClose,
}: {
  folderId: string;
  data: RecallData;
  onData: (d: RecallData) => void;
  onClose: () => void;
}) {
  const [parentId, setParentId] = useState<string | null>(null);

  const options = useMemo(() => {
    const banned = new Set<string>([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of data.folders) {
        if (f.parentId && banned.has(f.parentId) && !banned.has(f.id)) {
          banned.add(f.id);
          grew = true;
        }
      }
    }
    return data.folders
      .filter((f) => !banned.has(f.id))
      .map((f) => ({ id: f.id, path: folderPathString(data.folders, f.id) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [data.folders, folderId]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-neutral-900 p-5 text-neutral-100 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold">Move folder</h2>
        <p className="mb-4 text-sm text-neutral-400">
          Moving “{folderPathString(data.folders, folderId)}”.
        </p>
        <select
          className="mb-4 w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm"
          value={parentId ?? ""}
          onChange={(e) => setParentId(e.target.value || null)}
        >
          <option value="">(top level)</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.path}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-neutral-100"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500"
            onClick={() => {
              onData(moveFolder(folderId, parentId));
              onClose();
            }}
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into `FolderWorkspace.tsx`**

Add the import at the top:

```tsx
import { MoveFolderDialog } from "./MoveFolderDialog";
```

Add state alongside the component's other `useState` calls:

```tsx
const [movingFolder, setMovingFolder] = useState<string | null>(null);
```

Add a `Move to…` entry to the same menu that already offers folder actions
(the one near `removeFolderSection` usage at line ~197), calling
`setMovingFolder(folderId)`.

Render the dialog near the component's other modals:

```tsx
{movingFolder && (
  <MoveFolderDialog
    folderId={movingFolder}
    data={data}
    onData={onData}
    onClose={() => setMovingFolder(null)}
  />
)}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. If `RecallData`, `onData` or `data` have different names
in `FolderWorkspace`, adapt to the real ones rather than renaming the existing
component's props.

- [ ] **Step 5: Verify in the browser**

Start the dev server, open the Recall app, open a folder, use `Move to…` to move
a folder under another, and confirm the tree updates and survives a page reload.
Confirm the folder being moved does not appear in its own dropdown.

- [ ] **Step 6: Commit**

```bash
git add src/components/recall/MoveFolderDialog.tsx src/components/recall/FolderWorkspace.tsx
git commit -m "Add Move to... so the assistant is not the only way to move a folder"
```

---

## Task 7: End-to-end verification of the reported bug

- [ ] **Step 1: Confirm the key is loaded**

Run:

```bash
grep -c "^AI_GATEWAY_API_KEY=." .env.local
```

Expected: `1`. If `0`, stop — the user has not added the key yet, and Step 3
cannot pass.

- [ ] **Step 2: Confirm the gateway answers**

Run:

```bash
k=$(grep -m1 "^AI_GATEWAY_API_KEY=" .env.local | cut -d= -f2- | tr -d '\r'); curl -s -o /dev/null -w "%{http_code}\n" https://ai-gateway.vercel.sh/v1/chat/completions -H "Authorization: Bearer $k" -H "Content-Type: application/json" -d '{"model":"anthropic/claude-opus-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

Expected: `200`. A `403` with `customer_verification_required` means no credit
card is on file on the Vercel account — the user must add one; nothing in the
code can work around it.

- [ ] **Step 3: Reproduce the original request**

Start the dev server, open the assistant, and send the exact original message:

> can u move my vps 2026 folder into a trading fx subfolder

Expected: a proposed `move_folder` action shown for confirmation — **not** a list
of matching notes, and **not** the degraded-mode notice.

- [ ] **Step 4: Confirm the degraded path still announces itself**

Temporarily blank `AI_GATEWAY_API_KEY` in `.env.local`, restart, ask the same
question. Expected: the reply opens with the "⚠️ AI is off" notice. Restore the
key and restart.

- [ ] **Step 5: Full check**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit any fixes and finish**

```bash
git add -A
git commit -m "Verify the reported folder-move request end to end"
```

---

## Done when

- `npm test` passes.
- Asking *"can u move my vps 2026 folder into a trading fx subfolder"* proposes a
  `move_folder` action.
- Removing the key produces a labelled search result, never a disguised one.
- A folder can be moved from the UI without the assistant.

## Next

Phase A (rename to Dashboard), Phase B (iPhone ingestion), Phase C (destination
registry) each get their own plan, written after Phase 0 is verified.

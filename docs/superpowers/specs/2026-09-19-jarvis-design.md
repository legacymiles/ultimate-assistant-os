# Jarvis — design spec

**Date:** 2026-09-19
**Supersedes:** the New Dashboard app (`/apps/new-dashboard`), which becomes Jarvis's Profile tab.
**Source of the idea:** YouTube `bjDDsdSfun8` (an "Agentic OS" walkthrough) plus the owner's two
prompt packs (Build Blueprint, Everyday Prompt Pack).

## 1. What Jarvis is

A personal agentic assistant that lives at `/apps/jarvis` in the hub. It keeps the owner's context
(the Four Cs profile already in New Dashboard), remembers conversations and files in a real
semantic memory, answers by voice or text with sources cited, and — after an explicit
confirmation — acts on the outside world: creates calendar events, sends emails and DMs.

Its signature visual is a **memory core**: a slowly turning sphere of glowing dots joined by lines,
one dot per real memory, coloured by source, that reacts to Jarvis's voice.

### Decisions taken before this spec

| Decision | Choice | Why |
|---|---|---|
| Side-effecting actions | **Always confirm first** | Sending mail/DMs in the owner's name is hard to undo. |
| Memory | **Supabase pgvector + hybrid search** | The owner asked for "a true super RAG agent"; keyword-only degrades past a few thousand rows. |
| App connections | **Composio now, direct-Google escape hatch** | Zapier MCP caps at 300 tool calls/month, far too low. Composio's free tier is 20k/month (100k with own OAuth app). A connector interface keeps the direct-Google route cheap to add. |
| Master folder awareness | **Repo files bundled + local sync of `~/.claude`** | `CLAUDE.md` and `aios/` ship with the deployment; the Claude Code memory folder only exists on the owner's PC so it is uploaded by a local-only sync route. |

### What this is NOT (YAGNI)

- Not a re-implementation of the video's design/media/website tabs. The hub already has
  Image Studio, Seedance Studio and Website Redesigner.
- Not a second onboarding. The existing 7-question intake is reused as-is.
- Not a background worker. Every action is user-triggered; nothing runs on a schedule in v1.
- Not multi-user. Other people's profiles stay supported in the Profile tab, but memory,
  inbox and calendar belong to the signed-in owner only.

## 2. Assessment of the two prompt packs (asked for by the owner)

**Pack 01 (Build Blueprint)** — mostly not adopted. It specifies a *manual* starter: no connected
accounts, no automatic actions, pasted fictional messages. Jarvis is past that stage and the
owner explicitly wants a connected inbox and an agent that edits the calendar. Two rules from it
are adopted and become hard requirements:

- **R1 — No invention.** Jarvis never fabricates messages, meetings, progress or sources, and
  states what is missing instead.
- **R2 — Review before save.** A memory Jarvis proposes is shown for approval/edit before it is
  written.

**Pack 02 (Everyday Prompt Pack)** — adopted, as the Routines tab. Daily brief, triage a message,
plan the week, weekly review, capture a memory. They are stored as editable prompts and run with
real context injected rather than pasted by hand.

## 3. Architecture

```
src/components/jarvis/        UI: Shell, MemoryCore (three.js), Dashboard, Chat, Inbox,
                              Calendar, Memory, Routines, Profile (re-exports New Dashboard),
                              VoiceModal, ConfirmCard
src/lib/jarvis/               types.ts, store.ts (localStorage+saveSynced), context.ts,
                              tools.ts, actions.ts, routines.ts, memoryClient.ts, *.test.ts
src/lib/jarvis/server/        memory.ts (embed + hybrid search), connectors/ (composio.ts,
                              google.ts, types.ts), agent.ts (tool loop)
src/app/api/jarvis/           chat, memory/{search,save,sync,propose}, action, inbox,
                              calendar, connectors
src/app/apps/jarvis/page.tsx  the route
supabase/migrations/          jarvis_memories table + hybrid search RPC
```

`/apps/new-dashboard` becomes a redirect to `/apps/jarvis` (kept so old links and the catalog's
history do not 404). The catalog entry is renamed; the slug changes to `jarvis` and stays in
`UNPREVIEWABLE`.

### Data flow (one question)

1. Client sends the conversation + active profile id to `POST /api/jarvis/chat`.
2. Server builds the system prompt: profile intake, `CLAUDE.md` + `aios/*` digest, today's date
   and timezone, the honesty rules (R1), and the list of available tools.
3. Server runs an OpenAI-style tool loop through `aiFetch` (so the owner's site-wide model picker
   and fallbacks apply), max 6 rounds.
4. Read-only tools (`search_memory`, `find_events`, `find_messages`) execute immediately.
5. A write tool (`create_event`, `send_message`, `save_memory`) does **not** execute. The loop
   stops and returns `{ pendingAction }` describing exactly what would happen.
6. Client renders a ConfirmCard. On approval it calls `POST /api/jarvis/action`, which is the only
   place a write ever runs, and the result is appended to the conversation.
7. After a completed answer the client calls `/api/jarvis/memory/propose`; proposals are shown as
   review chips (R2).

### Error handling / degradation (the hub rule: never 500, degrade visibly)

| Missing | Behaviour |
|---|---|
| Supabase | Memory falls back to local keyword search; a banner says "Local memory only". |
| `OPENROUTER_API_KEY` / gateway | Chat returns a setup message, not a simulated answer. Existing `/api/ai/status` surfaces it. |
| `COMPOSIO_API_KEY` | Inbox and Calendar show a "Connect your apps" empty state; calendar still works as a manual agenda with overlap warnings. |
| Speech recognition unsupported | Mic button is disabled with a tooltip naming the browser requirement. |
| Local-only routes (master-folder sync) off the PC | `{ available: false }`, button hidden. |

## 4. Components in detail

### 4.1 Memory core (`MemoryCore.tsx`)

- three.js via `@react-three/fiber` (already a dependency).
- Input: `MemoryNode[] { id, source, title, strength, links[] }` from `/api/jarvis/memory/graph`
  (a capped sample: 2,000 nodes max, chosen by recency + strength).
- Sphere mode: Fibonacci-sphere placement, additive-blended point sprites, per-source colour,
  faint line segments for links, slow multi-axis rotation, gentle drift.
- Network mode: the same nodes in a cheap force-directed layout, clustered by source.
- Voice reactivity: an `amplitude` prop (0–1) scales the radius and bloom; driven by a
  `AnalyserNode` on the mic while listening, and by a synthesised envelope while speaking.
- Centre HUD: `N memories · M links`. Search field filters and highlights.
- Empty state: a dim sphere of placeholder dots and "No memories yet".
- Must not run its RAF loop when the tab is hidden or the component is off-screen.

### 4.2 Memory (server)

Table `jarvis_memories`:

```
id uuid pk, user_id uuid, profile_id text, kind text, source text,
title text, content text, meta jsonb, embedding vector(1536),
created_at timestamptz, updated_at timestamptz, tsv tsvector generated
```

- Embeddings: `openai/text-embedding-3-small` via `https://openrouter.ai/api/v1/embeddings`
  (1536 dims), batched, with the content truncated to ~8k chars.
- Hybrid search RPC `jarvis_search(query_embedding, query_text, user, k)`: reciprocal-rank fusion
  of a `<=>` vector order and a `ts_rank_cd` order. Fusion is a pure function tested in
  `src/lib/jarvis/rank.test.ts`.
- RLS: row owner only, matching the other tables in `supabase/migrations/`.
- Sources: `chat`, `note`, `file`, `master-folder`, `skill`, `email`, `event`, `proposal`.
- `POST /api/jarvis/memory/sync` (Node runtime, local only, same guard as `/api/skills/scan`)
  reads `~/.claude/projects/<project>/memory/*.md` and `~/.claude/skills/*/SKILL.md`, upserts them
  by a stable id so re-running is idempotent.

### 4.3 Connectors

```ts
interface Connector {
  id: "composio" | "google";
  listApps(): Promise<ConnectedApp[]>;
  listTools(app: string): Promise<ToolSpec[]>;   // name, description, params, readOnly
  call(tool: string, args: unknown): Promise<unknown>;
}
```

- `composio.ts` talks to Composio's HTTP API with `COMPOSIO_API_KEY`; connect/authorise happens in
  Composio's own flow, opened in a new tab from the Connections panel.
- `google.ts` is a stub in v1 that reports `available: false`, so the swap later is additive.
- `readOnly` comes from the tool metadata when present, else from a name test
  (`get|list|find|search|read|fetch` ⇒ read-only). Unknown ⇒ treated as a write, i.e. confirmed.
  Tested in `src/lib/jarvis/tools.test.ts`.

### 4.4 Inbox

- `GET /api/jarvis/inbox?refresh=1` fans out to the enabled apps' "find messages" tools, normalises
  to `{ id, app, from, subject, preview, body, at, link }`, caches to the store and upserts to
  memory as `source: "email"`.
- Labels Needs reply / Task / Reference / Done are local state on the message id.
- Compose: "Send via <app>" + recipient + subject + body; "Draft with Jarvis" fills it; sending
  goes through the ConfirmCard → `/api/jarvis/action`.

### 4.5 Calendar

- Month grid + selected-day panel. Events read from the calendar connector for the visible range.
- Manual events (no connector) live in the store, flag overlaps, and are labelled
  "Manually maintained".
- Create/move/delete always via ConfirmCard. The card shows title, date, start–end and timezone
  resolved from the profile.

### 4.6 Voice

- `SpeechRecognition` (webkit-prefixed on Safari) with interim transcripts shown live.
- Speaking: `POST /api/tts` (fish.audio) when `FISH_API_KEY` is set; otherwise
  `speechSynthesis`. The modal shows status, transcript and the ball.
- A confirmation can be given by voice: "yes/confirm/send it" resolves the pending card; anything
  else cancels. The card stays on screen either way.

### 4.7 Dashboard

Top: the memory core + today's date, weather omitted (no key). Below, in a dense two-column grid:
daily brief (generated on demand, never auto-invented), the profile's 90-day priorities with
done-toggles, unread inbox count, the next three events, and recent memories. Each panel states
its source and the time it was produced.

### 4.8 Routines

Five seeded prompts, editable, each with a "needs" list (memory / calendar / inbox). Run = one
chat turn with those contexts injected; the result is saved with its date and is searchable.

## 5. Testing

- Unit (vitest, next to the code): rank fusion, read-only classification, context builder
  truncation, overlap detection, memory-proposal parsing, store migration from the
  `new-dashboard` key.
- Browser verification per stage with the preview server on its own port, using
  `read_page`/console/network, then a screenshot.
- Deploy each stage and confirm on the live site, per the owner's rule that a feature is not done
  until it works the way they use it.

## 6. Setup the owner must do (one step at a time, opened for them)

1. Paste the `jarvis_memories` migration into Supabase SQL editor (copied to clipboard by the
   assistant).
2. Add `COMPOSIO_API_KEY=` to `.env.local` when stage 4 lands; connect Gmail/Calendar/Slack in
   Composio's own UI.
3. Optional: `FISH_API_KEY` for a better voice (already documented for Voice Studio).

## 7. Build order

1. **Shell** — route, rename, redirect, tab layout, memory core against seeded/local data,
   dashboard shell, Profile tab carrying the existing New Dashboard.
2. **Memory + chat** — migration, embeddings, hybrid search, master-folder context and sync,
   agent loop with `search_memory`, proposals, sources in answers.
3. **Voice** — recognition, TTS, modal, ball reactivity, spoken confirmation.
4. **Connectors** — Composio, inbox, calendar, ConfirmCard writes, routines that use them.

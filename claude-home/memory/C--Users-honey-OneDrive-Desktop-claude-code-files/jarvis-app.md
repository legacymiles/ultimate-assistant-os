---
name: jarvis-app
description: "Jarvis (/apps/jarvis) — New Dashboard rebuilt as a voice-first agentic assistant with pgvector memory, a memory-core sphere, Composio app connections and confirm-before-acting"
metadata: 
  node_type: memory
  type: project
  originSessionId: b39b691a-ed8f-48f4-84f0-0f94af07d73e
  modified: 2026-09-19T21:48:11.241Z
---

Built 2026-09-19 from a YouTube "Agentic OS" walkthrough (`bjDDsdSfun8`) the owner asked me to watch.
**New Dashboard became Jarvis**: slug `jarvis`, code in `src/{components,lib}/jarvis` + `/api/jarvis/*`,
`/apps/new-dashboard` redirects. The Four-Cs profile app is unchanged and is now the **Profile tab**
(`<NewDashboard chromeless />`), still on its own `new-dashboard` store key — that separation is what
made the rename lossless, so do not merge the two stores.

**Load-bearing decisions (the owner chose each one):**
1. **Confirm before acting.** The agent loop in `src/lib/jarvis/server/agent.ts` *stops* at any tool that
   is not provably read-only and returns `pending`; `/api/jarvis/action` is the only place a write runs and
   it rejects `confirmed !== true`. `isReadOnly()` treats an unrecognised tool name as a write.
2. **Composio, not Zapier.** Zapier MCP caps at 300 tool calls/month — the owner rejected it outright.
   Composio is 20k/month free (100k with own OAuth app). `COMPOSIO_API_KEY` + optional `COMPOSIO_USER_ID`.
   Tools are *discovered* per toolkit and filtered by regex, never hardcoded slugs.
   A Google-direct connector is the planned escape hatch — that is why `server/connectors/types.ts` exists.
3. **Memory = Supabase pgvector + hybrid search.** `jarvis_memories` + `jarvis_search()` RPC returns BOTH
   ranks; fusion (RRF, k=60) lives in `src/lib/jarvis/rank.ts` so the same rule runs server-side and in the
   on-device fallback. Embeddings: `openai/text-embedding-3-small` via OpenRouter's `/embeddings` — it does
   NOT go through the front-page model picker, because the vector column is tied to 1536 dims.
4. **Nothing is invented.** Every answer cites memories; empty panels stay empty. Two rules adopted from the
   owner's prompt Pack 01 (the rest of that pack was rejected as a manual-only beginner kit); Pack 02's
   prompts became the Routines tab.

**Master-folder awareness:** `CLAUDE.md` + `aios/*` are bundled (`outputFileTracingIncludes` for
`/api/jarvis/**`) and always in the system prompt. `~/.claude/projects/*/memory/*.md` and `~/.claude/skills`
only exist on the owner's PC, so `/api/jarvis/memory/sync` uploads them when Jarvis runs there.

**Gotchas:** RRF with k=60 ranks "found by both searches" above "first in one" — that is correct, my first
test asserted the opposite. Voice uses the browser recogniser (no key); browser TTS exposes no audio stream,
so the ball's amplitude is synthesised for that path only.

Related: [[new-dashboard-ai-os]], [[hub-ai-provider]], [[hub-deployment-supabase]], [[voice-studio-app]].

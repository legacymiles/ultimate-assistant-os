# Jarvis

Route: `/apps/jarvis` · Category: AI · Live

Record reviewed: 2026-11-22 — the voice half rewritten by hand; the Features list below is still
the seeded one and wants rewriting into plain features next time this app is edited.

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- jarvis "what to change"`.

## What it does

Your memory, folders, photos, lists, calendar and Record in one place. Every request, typed or spoken, becomes a block: exactly what you said, a numbered ledger of every step it took, and what each step actually returned, rendered as the thing it is — a table, a page, a screenshot, a command's real output. Nothing is flattened into "Done" and nothing scrolls away; a block from an hour ago is still there and still re-runnable. Voice is always on rather than a button you press: it waits for its name, hears the sentence after it, and can be talked over mid-answer — with an echo test so it never replies to itself. The part no web assistant has: a local agent on the PC, so it drives a real Chromium that keeps your logins, runs shell commands, reads and writes files, lists and focuses windows, and sees the screen. It reads freely and stops for a yes on the one class of step that cannot be undone. With the agent off it still thinks, remembers and answers, and says plainly which capability is missing.

## Features

- **One voice for the whole hub (Nov 2026)** — the always-listening voice no longer lives only in
  Chat: it is mounted once in the root layout (`src/components/voice/VoiceProvider.tsx`), keeps
  listening across pages, and shows as a small orb in the bottom-left of every owner page (Jarvis
  itself keeps its reactor for the same voice). "Jarvis, …" goes to the chat or harness thread in
  use — Jarvis chat, Profiles, an open harness thread, a running build (Client Review / Website
  Studio), App Builder, Website Studio drafts, the Dashboard agent — and the answer is read back
  (a harness's answer when its turn finishes, or the gate it stopped at). With no chat on the
  page it types into the box you were in, and with no box it opens Jarvis and runs it here.
  Owner pages only, never inside a frame, only the visible tab listens.
- **Start / stop, not always listening** — nothing listens until you tap the orb (or Jarvis's
  mic): it hears ONE request, answers, and switches the microphone off by itself; **Stop** cuts
  listening and speaking at once. Always listening for "Jarvis" is **Hands-free**, an opt-in
  switch remembered on this device (Jarvis's "Wait for the name" is the same switch), so it
  never picks up a conversation in the room and starts a task.

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Choose how Jarvis sounds** — a Voice stage at the top of the Dashboard, above the memory core.
  All 37 English Phonon voices as cards with the catalog's own description, filtered by the accent
  the catalog actually states (British 8, American 3, Not stated 26) plus Characters (12). Press
  **Hear <name>** to audition one without keeping it, or pick the card to keep it; Speed,
  Expression and Consistency sit under the grid. The choice is saved per account
  (`voice-settings:v1`) and the status dock shows which voice is live. A preview goes through the
  same `/api/tts` and the same body (`ttsBody`) a real answer uses, so what you audition is what
  you get. With no voice backend running it says so in plain words and names the command to start
  one — it never fails silently.
- **Shell, memory core sphere, dashboard, memory tab** — New Dashboard becomes Jarvis at /apps/jarvis; the old route redirects and the Four-Cs profile keeps its own store key, so no saved data moves. The memory core draws one glowing dot per real memory, c…
- **Moved into the hub as /apps/buildflip-2** — Brought over from legacymiles/buildflip-2-2 and the live v1: its route, UI, logic and API land in the hub's own folders, its AI goes through the shared provider, and its fonts come from the faces alr…
- **Built only after your PC has checked it, with the failing checks on screen**
- **Profiles, accounts and the memory map**
- **Show the file a write is touching**
- **Keep a build brief to one line while it runs**
- **The live line shows the newest thing, once**
- **One live line while the coding harness works**
- **Keep going when the tab closes, the bridge restarts, or a limit hits** — A build was a harness thread in the bridge and a row on the server, but nothing on the PC remembered it. Closing the tab left the thread running invisibly; a bridge restart (an update, a wake, a rein…
- **Pick which Claude powers In Queue and 24/7 agents, and give the harness your keys once** — One "Powered by" menu on every harness surface (24/7 agents, In Queue's Run now, the harness start panel; Chat lists the same picks): Claude Opus 5.5 / Opus 5 / Sonnet on your subscription, the same …
- **Carry on the moment this PC has power** — The hub stores a goal and never pushes. This is the other half -- the thing on the PC that notices it has power and asks "is there anything I can do?".
- **24/7 agents that carry on where the last machine left off** — Work that needs a MACHINE -- Flux on Pinokio, a Blender render, an Unreal build -- could only be asked for while the PC was awake. From a phone, or with Pinokio unreachable, it was a dead end.
- **A workbench in the chat — coding agents, GitHub, Vercel, Supabase, MCP, CLIs** — The chat could browse, read and run, but it could not hand a multi-file job to an agent that writes, tests and commits, and it had no way to reach the services an app actually ships through. Both are…
- **Stop gating the push, stop refusing in silence, remember the act** — Three failures from one real build, in order of what they cost.
- **Refresh arena scores daily, and show what a filter hides** — A leaderboard whose scores are only ever typed in by hand goes quietly wrong, so the daily check now has two halves: Hugging Face for new releases, which still land in the inbox for approval, and Art…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

- **Jarvis still speaks.** `useVoice.speak` posts to `/api/tts` and plays the audio through an
  AudioContext, so the Reactor meter reads the voice and not the microphone. A media element that
  is routed into a context but never connected to `ctx.destination` goes silent.
- **The voice is always on, not a button.** Wake word, talk-over mid-answer and the echo test are
  untouched by the Voice stage; the dock still says the voice *state* in words (off / waiting for
  its name / listening / thinking / speaking), with the chosen voice's name after it.
- **No backend is not a crash.** With nothing configured, `/api/tts` answers `{ fallback: true }`
  and the browser's own voice speaks; the Voice stage says what to start, in plain words.
- **A saved voice that no longer exists falls back.** `clampSettings` drops a name the catalog
  does not have rather than sending it on every line.

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/jarvis` — owner's sign-in
- Page `/apps/new-dashboard` — owner's sign-in
- Page `/apps/new-jarvis` — owner's sign-in
- `src/app/api/finance/`
- `src/app/api/jarvis-profile/`
- `src/app/api/jarvis/`
- `src/app/api/new-dashboard/`
- `src/app/api/new-jarvis/`
- `src/app/api/site-errors/`
- `src/app/api/studio/`
- `src/components/hub/`
- `src/components/jarvis/`
- `src/components/new-dashboard/`
- `src/components/new-jarvis/`
- `src/components/studio-home/`
- `src/lib/armory/`
- `src/lib/finance/`
- `src/lib/jarvis-profile/`
- `src/lib/jarvis/`
- `src/lib/memory-map/`
- `src/lib/new-dashboard/`
- `src/lib/new-jarvis/`
- `src/lib/passwords/`
- `src/lib/site-errors/`
- `src/lib/studio-home/`
- `src/lib/studio/`
- `src/lib/telephony/`

### Sign-in & who can use it

- Needs a signed-in user (requireUser / auth.getUser) — `src/lib/finance/server/context.ts`, `src/lib/jarvis/record/server/files.ts`, `src/lib/jarvis/server/memory.ts`
- Password gate (src/lib/appGate.ts) — `src/app/apps/jarvis/page.tsx`

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET POST DELETE | `/api/finance/bills` | owner's sign-in |
| GET POST | `/api/finance/link` | owner's sign-in |
| GET POST | `/api/finance/state` | owner's sign-in |
| POST | `/api/finance/sync` | owner's sign-in |
| GET POST | `/api/finance/webhook/plaid` | owner's sign-in |
| POST | `/api/jarvis-profile/learn` | owner's sign-in |
| POST | `/api/jarvis-profile/skill` | owner's sign-in |
| POST | `/api/jarvis/action` | owner's sign-in |
| POST | `/api/jarvis/agent` | owner's sign-in |
| GET | `/api/jarvis/armory` | owner's sign-in |
| GET | `/api/jarvis/calendar` | owner's sign-in |
| GET POST | `/api/jarvis/call` | owner's sign-in |
| GET POST | `/api/jarvis/call/webhook` | owner's sign-in |
| POST | `/api/jarvis/chat` | owner's sign-in |
| GET | `/api/jarvis/connectors` | owner's sign-in |
| GET | `/api/jarvis/inbox` | owner's sign-in |
| POST | `/api/jarvis/memory/delete` | owner's sign-in |
| GET | `/api/jarvis/memory/list` | owner's sign-in |
| GET POST | `/api/jarvis/memory/mcp` | per-account key (no session) |
| GET POST | `/api/jarvis/memory/rules` | owner's sign-in |
| GET | `/api/jarvis/memory/rules/export` | owner's sign-in |
| POST | `/api/jarvis/memory/save` | owner's sign-in |
| POST | `/api/jarvis/memory/search` | owner's sign-in |
| GET POST | `/api/jarvis/memory/sync` | owner's sign-in |
| GET POST DELETE | `/api/jarvis/memory/vault` | owner's sign-in |
| GET DELETE | `/api/jarvis/record/capture` | owner's sign-in |
| POST OPTIONS | `/api/jarvis/record/capture/push` | per-account key (no session) |
| POST | `/api/jarvis/record/extension` | owner's sign-in |
| POST | `/api/jarvis/record/extract` | owner's sign-in |
| POST DELETE | `/api/jarvis/record/file` | owner's sign-in |
| GET | `/api/jarvis/record/file/[id]` | owner's sign-in |
| POST OPTIONS | `/api/jarvis/record/map` | per-account key (no session) |
| POST | `/api/jarvis/record/snapshot` | owner's sign-in |
| GET OPTIONS | `/api/jarvis/record/snapshot/pull` | per-account key (no session) |
| GET POST DELETE | `/api/jarvis/record/token` | owner's sign-in |
| GET POST | `/api/jarvis/skills` | per-account key (no session) |
| POST | `/api/jarvis/skills/usage` | per-account key (no session) |
| GET | `/api/jarvis/sync-status` | owner's sign-in |
| GET POST PATCH | `/api/jarvis/vault/ops` | owner's sign-in |
| POST | `/api/new-dashboard/focus` | owner's sign-in |
| POST | `/api/new-jarvis/agent` | owner's sign-in |
| GET POST | `/api/new-jarvis/agents` | owner's sign-in |
| POST | `/api/new-jarvis/autopilot` | owner's sign-in |
| GET POST | `/api/new-jarvis/board` | owner's sign-in |
| POST | `/api/new-jarvis/devops` | owner's sign-in |
| POST | `/api/new-jarvis/enhance` | owner's sign-in |
| POST | `/api/new-jarvis/ideas` | owner's sign-in |
| GET | `/api/new-jarvis/queue` | owner's sign-in |
| GET POST | `/api/new-jarvis/requests` | owner's sign-in |
| GET | `/api/new-jarvis/requests/image` | per-account key (no session) |
| GET | `/api/new-jarvis/requests/input` | per-account key (no session) |
| POST | `/api/new-jarvis/requests/video` | per-account key (no session) |
| GET | `/api/new-jarvis/requests/watch` | owner's sign-in |
| POST | `/api/new-jarvis/watch` | owner's sign-in |
| POST | `/api/new-jarvis/web` | owner's sign-in |
| GET PATCH | `/api/site-errors` | owner's sign-in |
| GET | `/api/site-errors/feed` | per-account key (no session) |
| POST OPTIONS | `/api/site-errors/report` | per-account key (no session) |
| POST | `/api/studio/character` | owner's sign-in |
| POST | `/api/studio/film3d/plan` | owner's sign-in |
| POST | `/api/studio/film3d/video` | owner's sign-in |
| POST | `/api/studio/image` | owner's sign-in |
| POST | `/api/studio/kids-flow/plan` | owner's sign-in |
| POST | `/api/studio/video-swap/job` | owner's sign-in |
| POST | `/api/studio/workflow-maker` | owner's sign-in |

### Data & database rules

- Table `app_state` (public.app_state) · RLS on — used in `src/lib/jarvis/server/syncStatus.ts`
  - policy public.app_state · app_state_all — for all using (user_id = auth.uid()) with check (user_id = auth.uid())
- Table `finance_accounts` (public.finance_accounts) · RLS on — used in `src/lib/finance/server/store.ts`
  - policy public.finance_accounts · finance_accounts_owner — for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())
- Table `finance_alerts` (public.finance_alerts) · RLS on — used in `src/lib/finance/server/store.ts`
  - policy public.finance_alerts · finance_alerts_owner — for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())
- Table `finance_bills` (public.finance_bills) · RLS on — used in `src/app/api/finance/bills/route.ts`, `src/lib/finance/server/store.ts`
  - policy public.finance_bills · finance_bills_owner — for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())
- Table `finance_connections` (public.finance_connections) · RLS on — used in `src/lib/finance/server/store.ts`
  - policy public.finance_connections · finance_connections_owner — for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())
- Table `finance_settings` (public.finance_settings) · RLS on — used in `src/lib/finance/server/store.ts`
  - policy public.finance_settings · finance_settings_owner — for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())
- Table `finance_txns` (public.finance_txns) · RLS on — used in `src/lib/finance/server/store.ts`
  - policy public.finance_txns · finance_txns_owner — for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())
- Table `jarvis_memories` (public.jarvis_memories) · RLS on — used in `src/lib/jarvis/server/memory.ts`, `src/lib/jarvis/server/skills.ts`
  - policy public.jarvis_memories · jarvis owner all — for all using (auth.uid() = user_id) with check (auth.uid() = user_id)
- Database function `jarvis_search` — `src/lib/jarvis/server/memory.ts`
- Saved data `jarvis-camera-watch:v1` — `src/lib/new-jarvis/useCameraWatch.ts`
- Saved data `jarvis-ideas:v1` — `src/lib/new-jarvis/useIdeas.ts`
- Saved data `jarvis-inbox-had:v1` — `src/lib/new-jarvis/inboxSync.ts`
- Saved data `jarvis-launcher:v1` — `src/lib/new-jarvis/launcher.ts`
- Saved data `jarvis-onboarding:v1` — `src/lib/new-jarvis/onboarding.ts`
- Saved data `jarvis-profile:v1` — `src/lib/jarvis-profile/useJarvisProfile.ts`
- Saved data `jarvis-said:v1` — `src/lib/new-jarvis/useIdeas.ts`
- Saved data `jarvis-share-up-skip:v1` — `src/lib/new-jarvis/shareUp.ts`
- Saved data `jarvis-watches:v1` — `src/lib/new-jarvis/watches.ts`
- Saved data `jarvis-widgets:v1` — `src/components/new-jarvis/Widgets.tsx`
- Saved data `jarvis:toolkit:v1` — `src/lib/jarvis/toolkit.ts`
- Saved data `recall:v1` — `src/lib/passwords/usePasswordVault.ts`
- Server docs (server_docs via readDoc/writeDoc) — `src/app/api/jarvis/call/webhook/route.ts`, `src/lib/jarvis/record/inbox.ts`, `src/lib/new-jarvis/server/agentsStore.ts` +2 more

### Keys & outside services

- `AI_MODEL` — `src/app/api/studio/character/route.ts`
- `AI_VISION_MODEL` — `src/app/api/studio/character/route.ts`
- `CLAUDE_SKILLS_HOME` — `src/app/api/new-jarvis/queue/route.ts`, `src/lib/jarvis/server/masterFolder.ts`
- `CLIENT_REVIEW_UNCENSORED_MODELS` — `src/app/api/new-jarvis/agent/route.ts`
- `COMPOSIO_API_KEY` — `src/lib/jarvis/server/connectors/composio.ts`
- `COMPOSIO_USER_ID` — `src/lib/jarvis/server/connectors/composio.ts`
- `FINANCE_ENC_KEY` — `src/lib/finance/crypto.ts`
- `GITHUB_TOKEN` — `src/app/api/new-jarvis/devops/route.ts`
- `JARVIS_BOARD_PROJECT` — `src/app/api/new-jarvis/board/route.ts`
- `JARVIS_BOARD_REPO` — `src/app/api/new-jarvis/board/route.ts`, `src/app/api/new-jarvis/devops/route.ts`
- `JARVIS_CALL_PROVIDER` — `src/lib/telephony/provider.ts`
- `JARVIS_CALL_TO_NUMBER` — `src/lib/telephony/provider.ts`
- `JARVIS_CALL_WEBHOOK_SECRET` — `src/app/api/jarvis/call/webhook/route.ts`
- `JARVIS_ERRORS_TOKEN` — `src/app/api/site-errors/feed/route.ts`
- `JARVIS_GITHUB_REPO` — `src/app/api/new-jarvis/devops/route.ts`
- `JARVIS_GITHUB_TOKEN` — `src/app/api/new-jarvis/board/route.ts`, `src/app/api/new-jarvis/devops/route.ts`
- `JARVIS_MCP_TOKEN` — `src/lib/jarvis/server/mcpAuth.ts`
- `JARVIS_MCP_USER_ID` — `src/app/api/jarvis/sync-status/route.ts`, `src/lib/jarvis/server/mcpAuth.ts`
- `JARVIS_SEARCH_MODEL` — `src/app/api/new-jarvis/web/route.ts`
- `JARVIS_TYPING_MODEL` — `src/lib/new-jarvis/fastTyping.ts`
- `JARVIS_UNCENSORED_MODELS` — `src/app/api/new-jarvis/agent/route.ts`, `src/lib/new-jarvis/fastTyping.ts`
- `NEXT_PUBLIC_IPHONE_SETUP_VIDEO` — `src/components/new-jarvis/IphoneGuide.tsx`
- `NEXT_PUBLIC_JARVIS_BUILD_HARNESS` — `src/lib/new-jarvis/harness/choice.ts`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — `src/lib/new-jarvis/server/requestsAuth.ts`
- `NEXT_PUBLIC_SUPABASE_URL` — `src/lib/new-jarvis/server/requestsAuth.ts`
- `OPENROUTER_API_KEY` — `src/lib/jarvis/server/embed.ts`
- `OPENROUTER_SITE_URL` — `src/app/api/new-jarvis/web/route.ts`
- `PLAID_ENV` — `src/lib/finance/providers/plaid/client.ts`
- `PLAID_WEBHOOK_URL` — `src/app/api/finance/link/route.ts`
- `RECALL_DATA_DIR` — `src/lib/jarvis/record/inbox.ts`, `src/lib/jarvis/record/server/files.ts`
- `RETELL_AGENT_ID` — `src/lib/telephony/provider.ts`
- `RETELL_API_KEY` — `src/lib/telephony/provider.ts`
- `RETELL_FROM_NUMBER` — `src/lib/telephony/provider.ts`
- `SUPABASE_ACCESS_TOKEN` — `src/app/api/new-jarvis/devops/route.ts`
- `SUPABASE_PAT` — `src/app/api/new-jarvis/devops/route.ts`
- `SUPABASE_SERVICE_ROLE_KEY` — `src/lib/jarvis/server/mcpAuth.ts`
- `TWILIO_ACCOUNT_SID` — `src/lib/telephony/provider.ts`
- `TWILIO_AUTH_TOKEN` — `src/lib/telephony/provider.ts`
- `TWILIO_FROM_NUMBER` — `src/lib/telephony/provider.ts`
- `TWILIO_VOICE_URL` — `src/lib/telephony/provider.ts`
- `VAPI_API_KEY` — `src/lib/telephony/provider.ts`
- `VAPI_ASSISTANT_ID` — `src/lib/telephony/provider.ts`
- `VAPI_PHONE_NUMBER_ID` — `src/lib/telephony/provider.ts`
- `VERCEL_API_TOKEN` — `src/app/api/new-jarvis/devops/route.ts`
- `VERCEL_TEAM_ID` — `src/app/api/new-jarvis/devops/route.ts`
- `VERCEL_TEAM_SLUG` — `src/app/api/new-jarvis/devops/route.ts`
- `VERCEL_TOKEN` — `src/app/api/new-jarvis/devops/route.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/jarvis-profile/learn/route.ts`, `src/app/api/jarvis/record/extract/route.ts`, `src/app/api/jarvis/record/map/route.ts` +14 more

### Tests

- `src/lib/armory/catalog.test.ts`
- `src/lib/finance/crypto.test.ts`
- `src/lib/finance/dates.test.ts`
- `src/lib/finance/findings.test.ts`
- `src/lib/finance/fold.test.ts`
- `src/lib/finance/match.test.ts`
- `src/lib/finance/merchant.test.ts`
- `src/lib/finance/money.test.ts`
- `src/lib/finance/occurrences.test.ts`
- `src/lib/finance/providers/plaid/client.test.ts`
- `src/lib/finance/providers/plaid/live-sandbox.test.ts`
- `src/lib/finance/providers/plaid/map.test.ts`
- `src/lib/finance/providers/plaid/webhook.test.ts`
- `src/lib/finance/providers/sync.test.ts`
- `src/lib/finance/reconcile.test.ts`
- `src/lib/finance/server/rows.test.ts`
- `src/lib/finance/spend.test.ts`
- `src/lib/jarvis-profile/checklist.test.ts`
- `src/lib/jarvis/agentChat.test.ts`
- `src/lib/jarvis/brief.test.ts`
- `src/lib/jarvis/graph/force.test.ts`
- `src/lib/jarvis/graph/pick.test.ts`
- `src/lib/jarvis/jarvis.test.ts`
- `src/lib/jarvis/mcpProtocol.test.ts`
- `src/lib/jarvis/record/diff.test.ts`
- `src/lib/jarvis/record/fields.test.ts`
- `src/lib/jarvis/record/files.test.ts`
- `src/lib/jarvis/record/record.test.ts`
- `src/lib/jarvis/record/scan.test.ts`
- `src/lib/jarvis/server/skills.test.ts`
- `src/lib/jarvis/server/syncStatus.test.ts`
- `src/lib/jarvis/skillFormat.test.ts`
- `src/lib/jarvis/syncSteps.test.ts`
- `src/lib/jarvis/toolUsage.test.ts`
- `src/lib/jarvis/tools.test.ts`
- `src/lib/jarvis/updates.test.ts`
- `src/lib/jarvis/vault/diff.test.ts`
- `src/lib/jarvis/vault/ops.test.ts`
- `src/lib/jarvis/vault/parse.test.ts`
- `src/lib/jarvis/vault/resolve.test.ts`
- `src/lib/jarvis/voice.test.ts`
- `src/lib/memory-map/build.test.ts`
- `src/lib/memory-map/layers.test.ts`
- `src/lib/new-dashboard/new-dashboard.test.ts`
- `src/lib/new-jarvis/actions.test.ts`
- `src/lib/new-jarvis/agentTools.test.ts`
- `src/lib/new-jarvis/agents/agents.test.ts`
- `src/lib/new-jarvis/agents/connector.test.ts`
- `src/lib/new-jarvis/agents/describe.test.ts`
- `src/lib/new-jarvis/agents/templates.test.ts`
- `src/lib/new-jarvis/agents/wiring.test.ts`
- `src/lib/new-jarvis/appBuilderWiring.test.ts`
- `src/lib/new-jarvis/askEvent.test.ts`
- `src/lib/new-jarvis/autopilotChat.test.ts`
- `src/lib/new-jarvis/board.test.ts`
- `src/lib/new-jarvis/breath.test.ts`
- `src/lib/new-jarvis/bridge.test.ts`
- `src/lib/new-jarvis/browserFast.test.ts`
- `src/lib/new-jarvis/capture.test.ts`
- `src/lib/new-jarvis/chatMedia.test.ts`
- `src/lib/new-jarvis/devops.test.ts`
- `src/lib/new-jarvis/dictation.test.ts`
- `src/lib/new-jarvis/errorFix.test.ts`
- `src/lib/new-jarvis/felix.test.ts`
- `src/lib/new-jarvis/harness/families.test.ts`
- `src/lib/new-jarvis/harness/lane-policy.test.ts`
- `src/lib/new-jarvis/harness/link.test.ts`
- `src/lib/new-jarvis/harness/model.test.ts`
- `src/lib/new-jarvis/harness/models.test.ts`
- `src/lib/new-jarvis/ideas.test.ts`
- `src/lib/new-jarvis/improve.test.ts`
- `src/lib/new-jarvis/inboxSync.test.ts`
- `src/lib/new-jarvis/keySetup.test.ts`
- `src/lib/new-jarvis/launcher.test.ts`
- `src/lib/new-jarvis/persist.test.ts`
- `src/lib/new-jarvis/plainErrors.test.ts`
- `src/lib/new-jarvis/queue.test.ts`
- `src/lib/new-jarvis/queueBuild.test.ts`
- `src/lib/new-jarvis/reactor.test.ts`
- `src/lib/new-jarvis/reflex.test.ts`
- `src/lib/new-jarvis/requests.test.ts`
- `src/lib/new-jarvis/runner.test.ts`
- `src/lib/new-jarvis/screenCapture.test.ts`
- `src/lib/new-jarvis/shareUp.test.ts`
- `src/lib/new-jarvis/spectrum.test.ts`
- `src/lib/new-jarvis/talk.test.ts`
- `src/lib/new-jarvis/threads.test.ts`
- `src/lib/new-jarvis/triage.test.ts`
- `src/lib/new-jarvis/trust.test.ts`
- `src/lib/new-jarvis/wake.test.ts`
- `src/lib/new-jarvis/watchRules.test.ts`
- `src/lib/new-jarvis/web.test.ts`
- `src/lib/new-jarvis/workbench.test.ts`
- `src/lib/passwords/crypto.test.ts`
- `src/lib/passwords/vault.test.ts`
- `src/lib/site-errors/log.test.ts`
- `src/lib/studio-home/sections.test.ts`
- `src/lib/studio-home/wall.test.ts`
- `src/lib/studio/characters.test.ts`
- `src/lib/studio/cinema.test.ts`
- `src/lib/studio/composite.test.ts`
- `src/lib/studio/film.test.ts`
- `src/lib/studio/film3d/film3d.test.ts`
- `src/lib/studio/kids-flow/palette.test.ts`
- `src/lib/studio/kids-flow/plan.test.ts`
- `src/lib/studio/models.test.ts`
- `src/lib/studio/panels.test.ts`
- `src/lib/studio/preflight.test.ts`
- `src/lib/studio/queueText.test.ts`
- `src/lib/studio/references.test.ts`
- `src/lib/studio/skills.test.ts`
- `src/lib/studio/stitchWindows.test.ts`
- `src/lib/studio/storyboard.test.ts`
- `src/lib/studio/video-swap/plan.test.ts`
- `src/lib/studio/workflow-maker/blueprint.test.ts`
- `src/lib/studio/workflows.test.ts`
- `src/lib/telephony/decide.test.ts`
- `src/lib/telephony/script.test.ts`
<!-- code:end -->

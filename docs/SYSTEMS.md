# Systems — the parts every app shares

Read the section for a system before changing anything that touches it. Each app's own doc is
in `docs/apps/<slug>.md`; this file is for the plumbing between apps.

Contents: [AI calls and models](#ai-calls-and-models) · [In Queue — the request folders Claude Code works from](#in-queue--the-request-folders-claude-code-works-from) · [PC-rendered Studio workflows](#pc-rendered-studio-workflows) · [Kids Animation Flow (Studio card)](#kids-animation-flow-studio-card) · [3D Animation Flow (Studio card)](#3d-animation-flow-studio-card) · [Studio homes — one home per kind of thing](#studio-homes--one-home-per-kind-of-thing) · [Memory](#memory) · [Felix, prompt enhancer, super-board](#felix-prompt-enhancer-super-board) · [Skill spend and model routing](#skill-spend-and-model-routing) · [The build checklist](#the-build-checklist) · [API keys and connections](#api-keys-and-connections) · [Site errors](#site-errors) · [Video from a social link](#video-from-a-social-link) · [Data, sign-in and the database](#data-sign-in-and-the-database)

## AI calls and models

**Every AI call**

`src/lib/ai/provider.ts` (OpenRouter preferred, Vercel gateway fallback; model `anthropic/claude-opus-5`)

**Decision models (Jev, Span — typed yes/no/choice/score, never text)**

`src/lib/ai/decisions.ts` (catalogue, pure) + `src/lib/ai/decide.ts` (OpenRouter Decisions API call). Wired today: chat front door (`src/lib/new-jarvis/triage.ts`, Jev trims tools on quick/remember turns) and the browser agent's clicks and typing (`src/lib/new-jarvis/browserFast.ts` + `fastTyping.ts`: Jev picks links/buttons/boxes, never irreversible or secret ones; for a box it picks the words — a saved Life Record detail filled in the owner's tab via `hub/record_fill` (value never reaches a model), the person's own words, or a few words written by a small model, `JARVIS_TYPING_MODEL`, DeepSeek Flash by default; never submits; a read after every step needs no model). Claude refusing explicit adult content → DeepSeek, then Grok (`src/lib/new-jarvis/reroute.ts`, `JARVIS_UNCENSORED_MODELS`; never for blocked content or a hand-picked model). Where else Jarvis should use them: `src/lib/new-jarvis/decisionPoints.ts` — flip `wired` when one is wired; the self-audit and Improvements widget propose the rest

## In Queue — the request folders Claude Code works from

**In Queue (Jarvis › Queue tab + Dashboard widget) — the ledger of apps/workflows/skills AND a request folder per row**

Ledger: `src/lib/new-jarvis/queue.ts` + `/api/new-jarvis/queue`. Requests (chat-style folder per row + an Inbox, newest first, pictures allowed): pure `src/lib/new-jarvis/requests.ts`, per-account server doc `server/requestsStore.ts` (server_docs, no migration), browser API `/api/new-jarvis/requests`, UI `QueueBoard.tsx` + `QueueFolder.tsx`, hook `useRequests.ts` (polls every 15 s, so finished requests vanish by themselves). Claude Code works it through the jarvis-memory connector: `queue_list`, `queue_start`, `queue_note`, `queue_complete` (completing REMOVES it — the queue cleans itself), `queue_add`; pictures at `/api/new-jarvis/requests/image` with the same token. **When you finish work, check `queue_list` for a request it satisfies and complete it.**

## PC-rendered Studio workflows

**PC-rendered Studio workflows**

A Studio card whose skill renders in code on the PC (`animate-my-character` → skill `animate-character-story`, the cth9191/animate kit; `film-3d` → skill `threejs-film-story`) ends with the `studio_queue` tool instead of `studio_generate`: the approved brief + pictures go to that workflow's In Queue folder (`src/lib/studio/queueJob.ts`, `queueText.ts` `PC_SKILLS`)

## Kids Animation Flow (Studio card)

**Kids Animation Flow — the Studio card `animate-my-character` (shown as "Kids Animation Flow") and its own screen**

Pick the card, type the story + attach the character in the Studio composer (or name @animate-my-character in the Studio chat) → `StudioTab` opens the screen with that prompt as a `KidsSeed` (`fromPrompt` in `plan.ts` reads name/length/shape/look/mood out of it) and the storyboard is written at once. Shell `src/components/jarvis/kids-flow/KidsFlow.tsx` (+ `CharacterStage`, `StoryStage`, `BoardStage` (draggable paper beat strip + animatic), `RenderStage`, `WatchStage`, `kids-flow.css`). Logic `src/lib/studio/kids-flow/` — `plan.ts` (pure: sheet, beats, `draftBeats` fallback planner, `checkPlan`, `briefText` = what the PC reads), `palette.ts` (colours measured from the picture), `useKidsFlow.ts` (draft on this device; job status read live from In Queue). Planner `/api/studio/kids-flow/plan` (vision model, falls back to `draftBeats`). Video back from the PC: connector `queue_video_link` → signed Storage PUT (bucket `queue-videos`, key `videoKey(uid,id)`) or token POST to `/api/new-jarvis/requests/video`; `queue_complete` with `video: true`; played via `/api/new-jarvis/requests/watch?id=`

## 3D Animation Flow (Studio card)

**3D Animation Flow — the Studio card `film-3d` and its own screen (Three.js films made in code)**

Pick the card, attach the character + type the story in the Studio composer (or @film-3d in the Studio chat) → `StudioTab` opens `src/components/jarvis/film3d/Film3DFlow.tsx` with a `Film3DSeed` (`fromPrompt` in `plan.ts`). Stages Character (live 3D turntable) → Story → Storyboard (the real film plays live in `FilmStage.tsx`, beat strip = its timeline) → Render → Watch. **Engine** `src/lib/studio/film3d/`: `plan.ts` (pure: closed beat vocabulary — world/time/move/expression/shot/prop — `draftBeats` no-AI planner, `checkPlan`, `filmOf`, compact `filmCode`/`parseFilmCode` the PC reads, `briefText`, `heroFromPalette`), `director.ts` (pure: `frameAt(film,t)` = shot, pose, prop, caption, fades; seeded, never the clock), `hero.ts` (toy-figure rig from `Hero3D`, `poseHero`), `world.ts` (11 worlds × 4 times of day), `props.ts`, `player.ts` (`FilmPlayer`: WebGL → 2D canvas with captions; optional GLB hero), `score.ts` (`scoreEvents` pure + OfflineAudioContext render + WAV), `encode.ts` (browser MP4: WebCodecs H.264 + AAC/Opus via mp4-muxer; MediaRecorder fallback), `capture.ts` (page API for the PC tool), `useFilm3D.ts` (draft on this device). Planner `/api/studio/film3d/plan` (vision → hero + beats in the vocabulary; falls back to `draftBeats`). **Make it here** = browser render → `/api/studio/film3d/video` (start → signed PUT or local multipart → done) files it as a finished `flow:film-3d` request with its video, played via `/api/new-jarvis/requests/watch`. **Send to my PC** = an In Queue request whose text ends with the FILM JSON; the PC renders it in HD with `tools/film3d-render/render.mjs` (esbuild-bundles `capture.ts`, headless Chromium frames → ffmpeg; `--doctor`, `--stills`, `--model hero.glb`). Same engine, same frames everywhere. Tests `film3d.test.ts`

## Studio homes — one home per kind of thing

**Studio homes — "one home per kind of thing" (several apps behind one switcher)**

Shell `src/components/studio-home/StudioHome.tsx` + `studio-home.css` (sliding-thumb tablist that scrolls sideways on a phone, accent hue per section via `--sh-hue`, reduced motion, `?section=` via `history.replaceState`, last section in localStorage, `pending` sections show a plain-English "on your PC" panel with a one-press In Queue request, `framedSection` = what to show bare inside a frame). Pure `src/lib/studio-home/sections.ts` (+ `sections.test.ts`) — each home's list is its own file there: `trading.ts`, `games.ts`, `builder.ts`. Shared pieces: `PlayShelf.tsx` (dense list + one-at-a-time play-in-place frame + Open full screen + a per-row action), `go.ts` (`goToSection` — a section switching the home in place), `src/lib/studio-home/fileRequest.ts` (POST to `/api/new-jarvis/requests`). Merged apps are listed in `MERGED_INTO` in `src/lib/studio/plugins.ts`: they keep their catalog entry but leave the hub grid and App plugins. Jarvis Audio Studio predates the shell and keeps its own copy

## Memory

**Memory shared with claude.ai and the VPS**

`/api/jarvis/memory/mcp` — same Supabase rows as Jarvis › Memory. Setup card: Jarvis › Memory › "Same memory everywhere"

**Memory map (the web view; replaced the old vault-only "Brain" tab)**

Jarvis › Dashboard › Memory › Map: `src/components/new-jarvis/MemoryMap.tsx` (Canvas 2D renderer over the force engine in `src/lib/jarvis/graph/force.ts`) + `src/lib/memory-map/build.ts` (pure, tested: you → hubs → apps by category, skills by category, clients, crashes, tasks, memories, vault notes, daily log days, findings, with cross-links; every node has a `layer` 0 core · 1 areas · 2 abilities · 3 memories; `timelineOf` = who changed what). `layers.ts` (pure, tested) = shell layout + flat rings. Memory › List is the old memory list

**Memory rules (on top of the memory rows, which stay the source of truth) — owner's notes are read-only for agents, a router per area, a daily log, findings per workflow**

Pure rules + tests `src/lib/memory-rules/rules.ts` (`OWNER_SOURCES`/`agentSource`/`agentDeleteRefusal`, `addLog`/`recentLog`, `addFinding`/`findingsBlock`, `buildRouters`/`routerIndex`, `vaultFiles`); per-account doc `server/store.ts` (server_docs `.memory-rules.<uid>.json`, no migration; `routersFor` builds routers live from the catalog, skill store and memories). Connector tools `get_router`, `log_activity`, `get_findings`, `add_finding` (`mcpProtocol.ts`, `mcp/route.ts`); `save_memory` never writes as note/profile/vault, `delete_memory` refuses them. Jarvis chat logs its `did` lines and every Studio run reads its workflow's findings first (`/api/jarvis/chat`). Browser `/api/jarvis/memory/rules` (log + findings + trimmed app edits for the map); PC copy `/api/jarvis/memory/rules/export` (token) → `skill-sync.mjs rules` (also on every `pull`) writes markdown to `~/Jarvis Vault/jarvis-memory`

## Felix, prompt enhancer, super-board

**Felix, prompt enhancer, super-board (the "pro team" loop)**

Skills: `skills/felix` (end goal first + Altitude/Depth/Range), `skills/prompt-enhancer` (Anthropic best practices, Felix as pass 1), `skills/software-factory` (super-board with the owner's defaults) — also in the Jarvis skill store. super-board itself is committed under `.claude/` (skills, bin, workflows) with config `.claude/super-board/configs/ultimate-assistant-os.json` (`human_approves_merge: true`, cards land in Backlog). It needs GitHub GraphQL, so run it from Claude Code on the PC/VPS, not a cloud session; one-time setup `scripts/super-board-setup.ps1`. In Jarvis: ✦ Enhance / Goal check above chat (`GoalCheck.tsx`, `src/lib/new-jarvis/felix.ts`, `/api/new-jarvis/enhance`), "Send to board" (`src/lib/new-jarvis/board.ts`, `/api/new-jarvis/board`) on Goal check, Improvements, Queue rows and Site errors

## Skill spend and model routing

**Skill spend + Jev model routing (Skills Library › Most spend, Retire?, per-skill weekly cap and model pin)**

Pure + tests `src/lib/skills/spend.ts` (`addSpend`, `capState`, `chooseTier` = pin › cap › Jev › router, `bySpend`, `retireCandidates`). Global doc `skill-spend` next to `ai-spend` (`server/spendStore.ts`, batched). Metered in `src/lib/ai/spend.ts` `recordCall` when the call's `task.skill` is set (Jarvis Studio runs set it). Jev picks free/cheap/best per skill run in `provider.ts` `planCall` → `server/routeSkill.ts` (1.5 s ceiling; only when the router is choosing). Claude Code turns: Stop hook `skill-sync.mjs usage-cost` reads only new transcript lines and posts tokens per skill to `/api/jarvis/skills/usage` (`spend`), priced from the model catalogue as estimates (`server/priceTokens.ts`). Page: `useSkillSpend.ts`, `SpendBadge` in `SkillRow.tsx`, cap + model controls in `SkillDetailModal.tsx`, API `/api/skills/spend` (PATCH needs sign-in)

## The build checklist

**THE build checklist — "Backend checklist", a section of Profile (one list: the owner's common-sense rules "if multi-user → login", "no duplicates", "newest first"… plus the pro standard: R crashes/errors, S security, D data, P speed, U what shows, L logins, A automatic, O shipping, C client sites; each starter has a code, level and how-to-check). There is no other checklist — the old `docs/website-backend-checklist.md` was merged in. Felix (`felix.ts` `CHECKLIST`/`checklistFor`), the enhancer and board cards cite its codes**

Jarvis › Dashboard › Profile › Backend checklist (no tab of its own): `src/components/new-jarvis/BackendChecklist.tsx`, logic `src/lib/jarvis-profile/` (`checklist.ts` pure rules/learning, `useJarvisProfile.ts` state, synced key `jarvis-profile:v1`). Learns from the owner's chat log via `/api/jarvis-profile/learn`; rules that are on go into every Jarvis chat build (`checklist` in the agent request) and are auto-published as the Claude Code skill `website-build-checklist` via `/api/jarvis-profile/skill`. **When you build or change an app here, follow that checklist.**

## API keys and connections

**API keys / connections (onboarding Keys step AND Jarvis › Dashboard › Profile › Connections, link `/apps/jarvis#connections/<capability>`)**

Registry `src/lib/new-jarvis/keySetup.ts`: `KEY_SOURCES` (site, url, how, prefix, cost, `steps` = numbered walk-through, each step a button to the exact page; `stepsFor` always ends with Paste + the Vercel step), `connectionRows` (every key-switched capability). UI: `KeyRowView` in `Onboarding.tsx` ("Show me how" opens the steps + paste box + "Jarvis, do it"), Profile tab `Connections.tsx` (`openConnections()` deep link). **Any new key an app asks for gets a `KEY_SOURCES` entry with steps and a capability in `src/lib/armory/catalog.ts`, so users can set it up by clicking**

## Site errors

**Site errors (crash log, hub + client sites)**

`src/lib/site-errors/` (pure fold/fingerprint + `store.ts` in `server_docs`, no migration). Ingest `/api/site-errors/report` (public, append-only), owner list `/api/site-errors`, bearer feed `/api/site-errors/feed` (super-collect source `jarvis-errors`). Browser: `ErrorReporter` in the root layout, `app/error.tsx` + `app/global-error.tsx` (`CrashScreen`). Client sites: `public/jarvis-errors.js`. Tab: Jarvis › More › Work › Site errors (`SiteErrors.tsx` `SiteErrorsPage`, `/apps/jarvis#site-errors`; moved off the Dashboard 2026-10-19)

## Video from a social link

**Video from a social link (Cook Connect, Dance Studio, …)**

`src/lib/social-import/videoDownload.ts` (a workflow per site). Facebook: share links (`/share/r/…`) are followed to the real reel first, then `facebook.ts` reads the embed/desktop/mobile/crawler pages for a direct video URL, then yt-dlp. Login-only posts use a session the owner connects in-app — Record extension button "Connect Facebook & Instagram" (`/api/social-import/cookies/push`) or the Connect panel under the error (`ConnectSitePanel.tsx`, `/api/social-import/cookies`); stored in server_docs by `cookieStore.ts`, env `YTDLP_COOKIES_*` still wins

## Data, sign-in and the database

**Cross-device state**

`src/lib/sync/appState.ts` (`loadLocal` / `saveSynced` / `useRemotePull`, Supabase `app_state` table)

**Password gates**

`src/lib/appGate.ts` + `src/middleware.ts`

**Database schema**

`supabase/migrations/` (combined: `supabase/all-schemas.sql`)

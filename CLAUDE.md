# Ultimate Assistant OS — operating manual

This folder lives at `C:\Users\honey\Projects\ultimate-assistant-os` — it moved out of OneDrive on
2026-10-13, because OneDrive hydration made every file read slow and hid it from tooling.

This folder is the owner's **master Claude Code folder** and their **portfolio**: one Next.js 15 hub
(App Router, TypeScript, Tailwind v4, Supabase, deployed on Vercel) that holds every app they build.
Read this file first. It says where things live so you can go straight to them instead of searching.

Structure follows the AIS-OS kit (github.com/nateherkai/AIS-OS): **Context → Connections →
Capabilities → Cadence**. The owner's personal context lives in `aios/`. Their living dashboard
of it is the **New Dashboard** app (`/apps/new-dashboard`).

## Where things live

| Need | Go to |
|---|---|
| Who the owner is, priorities, decisions | `aios/` (see `aios/README.md`) and the New Dashboard app |
| Long-term memory of past work (per app) | `C:\Users\honey\.claude\projects\C--Users-honey-Projects-ultimate-assistant-os\memory\MEMORY.md` |
| Memory shared with claude.ai and the VPS | `/api/jarvis/memory/mcp` — same Supabase rows as Jarvis › Memory. Setup card: Jarvis › Memory › "Same memory everywhere" |
| List of all apps (single source of truth) | `src/lib/catalog.ts` — add an app = add one object to `PROJECTS` |
| An app's page | `src/app/apps/<slug>/page.tsx` |
| An app's UI | `src/components/<folder>/` (folder name ≠ slug for some — see table below) |
| An app's logic / types / tests | `src/lib/<folder>/` (`*.test.ts` next to the code, run with `npx vitest run <path>`) |
| An app's server routes | `src/app/api/<folder>/` |
| Every AI call | `src/lib/ai/provider.ts` (OpenRouter preferred, Vercel gateway fallback; model `anthropic/claude-opus-5`) |
| Decision models (Jev, Span — typed yes/no/choice/score, never text) | `src/lib/ai/decisions.ts` (catalogue, pure) + `src/lib/ai/decide.ts` (OpenRouter Decisions API call). Wired today: chat front door (`src/lib/new-jarvis/triage.ts`, Jev trims tools on quick/remember turns) and the browser agent's clicks and typing (`src/lib/new-jarvis/browserFast.ts` + `fastTyping.ts`: Jev picks links/buttons/boxes, never irreversible or secret ones; for a box it picks the words — a saved Life Record detail filled in the owner's tab via `hub/record_fill` (value never reaches a model), the person's own words, or a few words written by a small model, `JARVIS_TYPING_MODEL`, DeepSeek Flash by default; never submits; a read after every step needs no model). Claude refusing explicit adult content → DeepSeek, then Grok (`src/lib/new-jarvis/reroute.ts`, `JARVIS_UNCENSORED_MODELS`; never for blocked content or a hand-picked model). Where else Jarvis should use them: `src/lib/new-jarvis/decisionPoints.ts` — flip `wired` when one is wired; the self-audit and Improvements widget propose the rest |
| Client Review (send a client their site, collect edit requests, approve, ship v2…) | ONE page for clients and the owner: `/apps/client-review` (`ClientReviewApp.tsx`; App plugins card). Tabs: Client (`MyWebsites.tsx` → `ClientPortal.tsx`, `?site=<secret>`) and Admin (`ClientReviewAdmin.tsx`), locked/faded unless `/api/client-review/portal/me` says owner; admin API `/api/client-review/admin` is owner-only in middleware. Clients sign in with Google; first account to open a link claims it. Old `/review/<secret>` links redirect in. Client API `/api/client-review/portal/[token]`, worker `public/client-review-sw.js` (scope `/apps/client-review`, VAPID keys self-generate). Logic `src/lib/client-review/` — `logic.ts` flow, `routing.ts` which lane writes the brief, `contentCheck.ts` what a request asks for (explicit → uncensored lane, minors/non-consent → blocked, never sent) |
| Jarvis (the one assistant) | `/apps/jarvis` → `src/components/new-jarvis/NewJarvis.tsx` (shell) + `src/lib/new-jarvis/`. `/apps/new-jarvis` redirects there. The old chat shell and Routines were removed 2026-10-17; `src/components/jarvis/` now holds only the panels Jarvis mounts. Camera Autopilot (photo sheet in `Deck.tsx`, brain `src/lib/new-jarvis/autopilotChat.ts`, route `/api/new-jarvis/autopilot`) sorts photos AND takes jobs: a `task` action's Yes hands the job + photo to the super chat via `jarvis:ask` (`src/lib/new-jarvis/askEvent.ts`), which runs it in Do mode with every chat tool |
| Felix, prompt enhancer, super-board (the "pro team" loop) | Skills: `skills/felix` (end goal first + Altitude/Depth/Range), `skills/prompt-enhancer` (Anthropic best practices, Felix as pass 1), `skills/software-factory` (super-board with the owner's defaults) — also in the Jarvis skill store. super-board itself is committed under `.claude/` (skills, bin, workflows) with config `.claude/super-board/configs/ultimate-assistant-os.json` (`human_approves_merge: true`, cards land in Backlog). It needs GitHub GraphQL, so run it from Claude Code on the PC/VPS, not a cloud session; one-time setup `scripts/super-board-setup.ps1`. In Jarvis: ✦ Enhance / Goal check above chat (`GoalCheck.tsx`, `src/lib/new-jarvis/felix.ts`, `/api/new-jarvis/enhance`), "Send to board" (`src/lib/new-jarvis/board.ts`, `/api/new-jarvis/board`) on Goal check, Improvements, Queue rows and Site errors |
| Site errors (crash log, hub + client sites) | `src/lib/site-errors/` (pure fold/fingerprint + `store.ts` in `server_docs`, no migration). Ingest `/api/site-errors/report` (public, append-only), owner list `/api/site-errors`, bearer feed `/api/site-errors/feed` (super-collect source `jarvis-errors`). Browser: `ErrorReporter` in the root layout, `app/error.tsx` + `app/global-error.tsx` (`CrashScreen`). Client sites: `public/jarvis-errors.js`. Deck widget: `SiteErrors.tsx` |
| THE build checklist — "Backend checklist", a section of Profile (one list: the owner's common-sense rules "if multi-user → login", "no duplicates", "newest first"… plus the pro standard: R crashes/errors, S security, D data, P speed, U what shows, L logins, A automatic, O shipping, C client sites; each starter has a code, level and how-to-check). There is no other checklist — the old `docs/website-backend-checklist.md` was merged in. Felix (`felix.ts` `CHECKLIST`/`checklistFor`), the enhancer and board cards cite its codes | Jarvis › Dashboard › Profile › Backend checklist (no tab of its own): `src/components/new-jarvis/BackendChecklist.tsx`, logic `src/lib/jarvis-profile/` (`checklist.ts` pure rules/learning, `useJarvisProfile.ts` state, synced key `jarvis-profile:v1`). Learns from the owner's chat log via `/api/jarvis-profile/learn`; rules that are on go into every Jarvis chat build (`checklist` in the agent request) and are auto-published as the Claude Code skill `website-build-checklist` via `/api/jarvis-profile/skill`. **When you build or change an app here, follow that checklist.** |
| Memory map (the web view; replaced the old vault-only "Brain" tab) | Jarvis › Dashboard › Memory › Map: `src/components/new-jarvis/MemoryMap.tsx` (Canvas 2D renderer over the force engine in `src/lib/jarvis/graph/force.ts`) + `src/lib/memory-map/build.ts` (pure, tested: you → hubs → apps by category, skills by category, clients, crashes, tasks, memories, vault notes, with cross-links). Memory › List is the old memory list |
| Cross-device state | `src/lib/sync/appState.ts` (`loadLocal` / `saveSynced` / `useRemotePull`, Supabase `app_state` table) |
| Password gates | `src/lib/appGate.ts` + `src/middleware.ts` |
| Database schema | `supabase/migrations/` (combined: `supabase/all-schemas.sql`) |
| GPU / desktop helpers that are not the website | `tools/` (music-creator, realtime-lucy, studio3d-builder, unreal-bridge, unreal-builder, video-studio-runner) |
| Repo-local skill | `skills/unreal-game-builder/` — the owner's other skills are in `C:\Users\honey\.claude\skills\` |
| Design specs and plans | `docs/superpowers/{specs,plans}/` |
| Screenshots / loose images | `docs/screenshots/` (gitignored) · `docs/images/` |
| The AIS-OS kit this structure comes from | `C:\Users\honey\AIS-OS` (clone) · skill `ai-os-dashboard` |
| Preview servers | `.claude/launch.json`; one port per app, `scripts/dev-preview.mjs <port> --no-auth` |
| Env keys | `.env.local` (names documented in `.env.example`). When a key is needed, add a blank line there and show the owner that line |

### Slug → code folder (only where they differ)

| Route `/apps/…` | components / lib folder |
|---|---|
| `dashboard` | `recall` (+ `src/lib/dashboard` for the photo inbox and destinations) |
| `prompt-architect` | `blueprint` |
| `tiktok-dances` | `dances` (+ `dance-studio`) |
| `fire-reveal` | `reveal` |
| `3d-studio` | `studio3d` |
| `cookbook-genie` | `cookbook` |
| `gods-eye-view` | `gods-eye` |
| `kart-showcase` | `kart` |
| `multi-order-calculator` | `calculator` |
| `std-safe` | `stdsafe` (the app is called **Tap Safe**; the slug, routes and Supabase bucket keep the old name so existing reports and share codes survive) |
| `ea-feature-list` | `ea` (lib: `ea-features`) |
| `ea-world/replay`, `ea-world/terminals` | `ea-replay` (tick replay + simulated MT4 broker; API `src/app/api/ea-replay`; the HFT EA sources are `public/ea-world/experts/HFT_Secret_Rebuild.mq4` (v1) and `HFT_Secret_v2.mq4` (v2, 34-SMA high/low wave + HFT, distances in price), twins `src/lib/ea-replay/strategies/hftSecret.ts` / `hftSecretV2.ts`; "Fingerprint the original" = `src/lib/ea-replay/statement.ts` (black-box RE from MT4 statements/tester reports); terminal launchers `tools/ea-terminals`) |
| `website-redesigner` | `redesigner` |
| `seedance-studio` | `seedance` (the app is called **Music Video Studio**; slug unchanged) |
| `smart-shot-videos` | `smart-shot` |
| `video-studio-arena` | `video-studio` (engines: `src/lib/video-studio/methods/<id>/`) |
| `skills-library` | `skills` |
| `jarvis-audio-studio` | `jarvis-audio-studio` (the shell) + `mp3-download`, `music-classified`, `music-creator` (its three studios, each still its own folder). `/apps/{mp3-download,music-classified,music-creator}` redirect in with `?section=` |
| `slippery-escape` | `slippery` |
| `personas-studio` | `social-personas` (components, lib, API routes and the synced key `social-personas:v1` keep the old Social Personas name so saved personas survive; `/apps/social-personas` redirects in). Also the Personas pane in Jarvis › Dashboard (`DashboardPanel.tsx`, `embedded`) and an App plugins card. Posting queue: `src/lib/social-personas/queue.ts` (pure) + `server/queue.ts` (server_docs) + `server/publish.ts` (IG reels, FB Page video, TikTok upload-to-inbox); heartbeat `/api/social-personas/publish/tick` driven by `.github/workflows/personas-tick.yml` every 15 min and by the open page. Sign-ins are Recall credentials in Personas Studio › <persona>, sealed by the vault |
| `projects-timeline` | `src/components/AppShell.tsx` + `src/lib/repo` (the original app; `README.md` describes it) |

## Rules that bite

- Never run two dev servers on the same `.next` dir — it corrupts it. Preview servers use their own `NEXT_DIST_DIR` (`.next-preview-<port>`).
- A self-contained Next app nested inside this repo must be added to the root `tsconfig.json` `exclude`, or `next build` breaks.
- The Vercel AI Gateway free tier serves no Anthropic model — keep OpenRouter as the default.
- Apps must work with no keys set (local demo mode, offline fallback). A missing key degrades visibly, never 500s.
- Private apps holding the owner's data go in `UNPREVIEWABLE` in `catalog.ts` so the hub carousel never frames them.
- Moving a finished app off the hub and into Jarvis is one edit, in `src/lib/studio/plugins.ts`: add the slug to `PLUGIN_SLUGS` (a card on Jarvis › App plugins that opens the app in its own tab) or to `TOOLBOX_SLUGS` (a tab mounted inside Jarvis › Toolbox, wired to a component in `new-jarvis/NewJarvis.tsx`). `hubProjects()` is the catalog minus both, so the two places cannot show the same app twice. Keep the catalog entry — deleting it is what silently killed the old Cookbook Genie card.

## How to work with the owner

- Be direct and concise. Lead with what needs action.
- They like dense, database-style UIs over card grids.
- **Every new app here gets a design skill, unasked.** Invoke it before writing any UI:
  `interactive-web-studio` is the one default for everything now — app/tool UIs and hub apps as well
  as landing/hero/public pages. Say which one is driving the look. `impeccable` and `taste-skill` are
  opt-in swaps. Never auto-pick a skill that costs money or renders footage
  (`h3-scroll-world`, `scroll-world`, `scroll-craft`, `imagegen-frontend-*`, `image-to-code-skill`) —
  those are opt-in only. Full rule: the global CLAUDE.md.
- When a decision is made, offer to log it in `aios/decisions/log.md`.
- **Creating or changing a skill:** write the complete SKILL.md and save it with the jarvis-memory
  connector's `save_skill` tool — that works from the phone and every cloud session, and it is the
  one home every device syncs from (`src/lib/jarvis/server/skills.ts`; PC/VPS pull it via
  `scripts/skill-sync.mjs`, set up from Jarvis › Memory › Skills everywhere). Writing files under
  `skills/` alone does not reach other devices.
- Default Shift: for any new task, ask "to what extent could AI be leveraged here?"

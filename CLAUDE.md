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
| Decision models (Jev, Span — typed yes/no/choice/score, never text) | `src/lib/ai/decisions.ts` (catalogue, pure) + `src/lib/ai/decide.ts` (OpenRouter Decisions API call). Wired today: chat front door (`src/lib/new-jarvis/triage.ts`, Jev trims tools on quick/remember turns). Where else Jarvis should use them: `src/lib/new-jarvis/decisionPoints.ts` — flip `wired` when one is wired; the self-audit and Improvements widget propose the rest |
| Client Review (send a client their site, collect edit requests, approve, ship v2…) | Owner: `/apps/client-review` + Jarvis › Toolbox › Clients (`ClientReviewAdmin.tsx`, API `/api/client-review/admin`). Client: public `/review/<secret>` (`ClientPortal.tsx`, API `/api/client-review/portal/[token]`, worker `public/client-review-sw.js`). Logic `src/lib/client-review/` — `logic.ts` flow, `routing.ts` which lane writes the brief, `contentCheck.ts` what a request asks for (word list only — no Jev here by the owner's call: explicit → uncensored lane, minors/non-consent → blocked, never sent) |
| Jarvis (the one assistant) | `/apps/jarvis` → `src/components/new-jarvis/NewJarvis.tsx` (shell) + `src/lib/new-jarvis/`. `/apps/new-jarvis` redirects there. The old chat shell and Routines were removed 2026-10-17; `src/components/jarvis/` now holds only the panels Jarvis mounts |
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

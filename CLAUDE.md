# Ultimate Assistant OS — operating manual

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
| Long-term memory of past work (per app) | `C:\Users\honey\.claude\projects\C--Users-honey-OneDrive-Desktop-claude-code-files\memory\MEMORY.md` |
| List of all apps (single source of truth) | `src/lib/catalog.ts` — add an app = add one object to `PROJECTS` |
| An app's page | `src/app/apps/<slug>/page.tsx` |
| An app's UI | `src/components/<folder>/` (folder name ≠ slug for some — see table below) |
| An app's logic / types / tests | `src/lib/<folder>/` (`*.test.ts` next to the code, run with `npx vitest run <path>`) |
| An app's server routes | `src/app/api/<folder>/` |
| Every AI call | `src/lib/ai/provider.ts` (OpenRouter preferred, Vercel gateway fallback; model `anthropic/claude-opus-5`) |
| Cross-device state | `src/lib/sync/appState.ts` (`loadLocal` / `saveSynced` / `useRemotePull`, Supabase `app_state` table) |
| Password gates | `src/lib/appGate.ts` + `src/middleware.ts` |
| Database schema | `supabase/migrations/` (combined: `supabase/all-schemas.sql`) |
| GPU / desktop helpers that are not the website | `tools/` (music-creator, realtime-lucy, studio3d-builder, unreal-bridge, unreal-builder) |
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
| `std-safe` | `stdsafe` |
| `ea-feature-list` | `ea` (lib: `ea-features`) |
| `website-redesigner` | `redesigner` |
| `seedance-studio` | `seedance` |
| `smart-shot-videos` | `smart-shot` |
| `skills-library` | `skills` |
| `slippery-escape` | `slippery` |
| `projects-timeline` | `src/components/AppShell.tsx` + `src/lib/repo` (the original app; `README.md` describes it) |

## Rules that bite

- Never run two dev servers on the same `.next` dir — it corrupts it. Preview servers use their own `NEXT_DIST_DIR` (`.next-preview-<port>`).
- A self-contained Next app nested inside this repo must be added to the root `tsconfig.json` `exclude`, or `next build` breaks.
- The Vercel AI Gateway free tier serves no Anthropic model — keep OpenRouter as the default.
- Apps must work with no keys set (local demo mode, offline fallback). A missing key degrades visibly, never 500s.
- Private apps holding the owner's data go in `UNPREVIEWABLE` in `catalog.ts` so the hub carousel never frames them.

## How to work with the owner

- Be direct and concise. Lead with what needs action.
- They like dense, database-style UIs over card grids.
- When a decision is made, offer to log it in `aios/decisions/log.md`.
- Default Shift: for any new task, ask "to what extent could AI be leveraged here?"

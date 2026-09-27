# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One primary user: the owner of this repository, working alone. This is a personal
assistant OS and portfolio in one — every app in it is built for, and used by, that
one person, on a Windows 11 laptop (LOQ 15ARP9, RTX 3050 6GB, 32GB RAM) and on an
iPhone. There are no other accounts, no tenants, no onboarding funnel for strangers.

The job: run a whole day of work and life from one place. Ask a question, capture a
thought, file a photo, check a calendar, plan a film, look something up, delegate a
multi-step task — without leaving the surface or re-explaining context that the
system already holds.

Secondary audience: people the owner shows the hub to as a portfolio. They see the
front page and the public apps; they never see the private ones.

## Product Purpose

The hub (`ultimate-assistant-os`) is one Next.js 15 App Router site that holds every
app the owner has built, with a single catalog (`src/lib/catalog.ts`) as the only
source of truth for what exists. Jarvis is the assistant at the centre of it: one
dashboard holding the owner's folders, photos, lists, calendar, memory, routines,
skills, tools, and the film Studio.

Success is that the owner reaches for this instead of reaching for anything else —
and that nothing in it needs a key, a cloud service or a running GPU to stay usable.

## Positioning

The mechanism a neighbouring product could not truthfully copy: **the assistant and
the owner's own data live in the same codebase, and the local machine is part of the
product.** Commercial assistants hold your data on their servers and cannot touch
your computer; a local desktop assistant can touch your computer but has no memory
of your life and no apps. This one does both, because the deployed site talks to a
bridge process on 127.0.0.1 that the owner controls (the pattern already proven by
`tools/studio-bridge`, `tools/unreal-bridge`, `tools/video-studio-runner` and the
`extension/jarvis-record` Chrome extension).

The second, quieter position: the assistant is not a chat window bolted onto a
product. It is the shell. Finished apps migrate *into* it (`src/lib/studio/plugins.ts`),
so the assistant gains capabilities over time rather than the app list growing.

## Operating Context

- **Deployment:** Vercel, live at a single URL, behind an app-level password gate
  (`src/lib/appGate.ts` + `src/middleware.ts`). Supabase (ref `kiiwaiwrfslqankcsnkf`)
  holds cross-device state in an `app_state` table, read and written through
  `src/lib/sync/appState.ts` (`loadLocal` / `saveSynced` / `useRemotePull`).
- **The local machine is a participant, not a client.** Vercel cannot reach the
  owner's PC; the owner's browser can. Local bridges listen on 127.0.0.1 and accept
  jobs only from the live hub origin or a localhost dev server. Anything needing a
  GPU, a shell, a filesystem or a real browser goes through one.
- **Every AI call** goes through `src/lib/ai/provider.ts` — OpenRouter preferred,
  Vercel AI Gateway as fallback, model `anthropic/claude-opus-5`. The Gateway free
  tier serves no Anthropic model, which is why OpenRouter is the default.
- **Development:** one dev server per app on its own port via `.claude/launch.json`
  and `scripts/dev-preview.mjs`, each with its own `NEXT_DIST_DIR` — two servers
  sharing `.next` corrupts it.
- Work is often done by several parallel Claude Code sessions against this one
  folder, so a blanket `git add` can sweep another session's staged work.

## Capabilities and Constraints

Confirmed, load-bearing constraints:

- **Apps must work with no keys set.** A missing key degrades visibly and never
  500s; there is always a local demo or offline fallback path.
- **Anything with an effect outside the app is confirmed before it runs.** The rule
  in `src/lib/jarvis/tools.ts` is deliberately pessimistic: a tool is treated as an
  action requiring a yes unless it is *known* read-only. Getting this wrong in the
  unsafe direction means something leaves without permission.
- **Private apps holding the owner's data** are listed in `UNPREVIEWABLE` so the hub
  carousel never frames them.
- Requests are capped at 4.5 MB by the platform, which is why image budgets exist
  (`src/lib/jarvis/agentChat.ts`) and why the middleware body cap matters.
- A self-contained Next app nested in this repo must be added to the root
  `tsconfig.json` `exclude` or `next build` breaks.
- Voice recognition is the browser's own (`SpeechRecognition`), so it is Chrome /
  Edge / Safari only; speech output prefers fish.audio via `/api/tts` and falls back
  to the browser voice.

Confirmed for the New Jarvis surface specifically (owner's decisions, this session):

- **Computer and browser control go through a new local bridge** on 127.0.0.1 with
  Playwright driving a real browser, plus shell, window, app and file operations.
  The deployed site must remain fully usable, read-only, when the bridge is down.
- **Voice is always-on with a wake word**, using browser STT — no install, works on
  the deployed site. Barge-in must interrupt speech.
- **The existing tabs are preserved and re-mounted, not rebuilt** — Folders, Photos,
  Lists, Memory, Calendar, Record, Studio, Skills, Tools read the same stores
  (`JARVIS_KEY`, `STORE_KEY`) so no data is migrated, copied or put at risk.

Terminology that is fixed and must not be "corrected": Jarvis (the assistant),
the rail (left navigation), the hub (the front page and catalog), a bridge (a local
process on 127.0.0.1), a plugin vs a toolbox app (`src/lib/studio/plugins.ts`), the
Four Cs — Context, Connections, Capabilities, Cadence (the AIS-OS structure in
`aios/`).

Undecided, and not to be invented: whether New Jarvis eventually replaces
`/apps/jarvis` or stands beside it permanently.

## Brand Commitments

- The name **Jarvis** is fixed. The new surface is **New Jarvis**, at
  `/apps/new-jarvis`.
- Voice and tone in the product's own copy: direct, concrete, no filler. Lead with
  what needs action. The existing code comments set the register — they explain *why*
  a rule exists and name the real failure it prevents, never restate the code.
- The hub's existing visual language is the incumbent authority for this build: the
  dark shell, the left rail, `src/components/icons.tsx`, and the Tailwind v4 token
  setup in `src/app/globals.css`.
- Stated preference, binding: **dense, database-style interfaces over card grids.**
  A card grid was explicitly rejected once already (the AI Rankings app) and had to
  be rebuilt.

## Evidence on Hand

Real, in this repository — nothing here needs inventing:

- `src/lib/catalog.ts` — every app, with real titles, categories and overviews.
- `src/components/jarvis/` — 31 components, ~14.3k lines, the incumbent Jarvis.
- `src/lib/jarvis/` — the real store, tool registry, agent loop, voice hook, memory
  client, and their tests (`*.test.ts`, run with `npx vitest run <path>`).
- `aios/` — the owner's actual personal context (the Four Cs), and
  `aios/decisions/log.md` for decisions.
- `tools/studio-bridge/` — a working, documented local bridge to model the new one on.
- `extension/jarvis-record/` — a working Chrome extension with a one-button install.
- `docs/superpowers/{specs,plans}/` — prior specs and plans.

Absences that must not be filled with fiction: there are **no other users**, no
usage metrics, no testimonials, no revenue, no team, and no SLA. ffmpeg is present;
image generation is not available on this machine this session.

## Product Principles

1. **One source of truth, always.** The catalog defines the apps; the store defines
   the data; the provider defines the AI call. A second copy of any of these is a bug
   waiting to be found — a deleted catalog entry is what silently killed an app card
   before.
2. **Degrade, never fail.** No key, no bridge, no GPU, no network: the surface still
   opens, still shows what it knows, and says plainly what it cannot do right now.
3. **Ask before acting outside the app.** Read freely; confirm anything that sends,
   posts, buys, deletes, or touches the machine. The confirmation shows what will
   happen in a sentence, with the exact arguments underneath.
4. **Density is respect.** The owner reads fast and knows the domain. Show the real
   values, the real names and the real counts on one screen rather than paginating
   them behind pretty cards.
5. **Capabilities migrate inward.** A finished app moves into the assistant rather
   than sitting beside it forever, so the thing the owner opens keeps getting more
   capable without the list getting longer.

## Accessibility & Inclusion

No externally imposed standard applies (single private user), but two product-specific
needs are real and must be honoured:

- **Voice is a first-class input, not an accessory.** The surface must be fully
  operable by speech alone, and fully operable by keyboard alone, because the owner
  uses it hands-busy and also uses it at speed with a keyboard.
- **The browser floor is Chromium-based desktop plus mobile Safari.** Speech
  recognition is unavailable outside Chrome/Edge/Safari, and that absence must be
  stated in the UI rather than presented as a broken microphone.

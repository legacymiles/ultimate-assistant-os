# Game Creator

Route: `/apps/game-creator` · Category: Apps · Live

Record reviewed: never — seeded from the edit log on 2026-11-13

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- game-creator "what to change"`.

## What it does

Type an idea for a video game and Unreal Engine 5.8 on your own PC builds it. A builder on the PC picks up each prompt and runs Claude Code with the Unreal game-builder skill: it writes a one-page design, creates a Blueprint project from the right engine template, builds the gameplay through Epic's in-editor MCP tools (Blueprint graphs, level actors, HUD widgets), playtests it in the editor, takes screenshots from the player's eye, and packages a Windows game. Every game lands in a gallery that updates live while it is being built — status, the design document, the build log, what was built and what was left out, and the controls. A finished game opens straight into Unreal or launches to play on the PC that built it.

## Features

_Seeded from this app's edit log. Rewrite it into plain features the next time the app is edited, then set Record reviewed._

- **Prompt -> Unreal Engine game built on your PC** — tools/unreal-bridge: MCP server (registered at user scope) that creates UE 5.8 Blueprint projects from engine templates (with their shared content packs), launches the editor with Epic's built-in MCP…
- **Pick the build model per game (Claude plan or OpenRouter LLMs)** — Model dropdown on the new-game form; the choice is stored on the game and the PC builder runs claude -p --model with it. OpenRouter models route Claude Code through openrouter.ai (custom Authorizatio…
- **Play / Open buttons work through the PC's builder** — The ueos:// link depends on the browser handing it to Windows, which can be blocked or framed away. The buttons now post a request; the builder picks it up on its next check-in (every 4 s) and opens …
- **Chat with the build agent, one build skill per game, realistic shooters** — Chat tab on each game: messages join the running Claude session (stream-json stdin); on a finished game they start a follow-up build that resumes the same session on the same project - Build skill dr…
- **Wait for the editor to really exit; label template chips** — unreal-bridge close(): Unreal stays in the process table for a while after taskkill, and process.kill(pid, 0) stops seeing it before tasklist does, so close() reported "closed" while the editor was s…

## Must keep working

_The flows a user would notice breaking. Sign-in, data rules, routes and keys are listed from the code below by themselves._

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/game-creator` — owner's sign-in
- Page `/apps/game-creator/[id]` — owner's sign-in
- `src/app/api/game-creator/`
- `src/components/game-creator/`
- `src/lib/game-creator/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| GET POST | `/api/game-creator/builder-token` | owner's sign-in |
| POST | `/api/game-creator/builder/claim` | per-account key (no session) |
| POST | `/api/game-creator/builder/fail` | per-account key (no session) |
| POST | `/api/game-creator/builder/messages` | per-account key (no session) |
| POST | `/api/game-creator/builder/progress` | per-account key (no session) |
| POST | `/api/game-creator/builder/screenshot` | per-account key (no session) |
| GET POST | `/api/game-creator/games` | owner's sign-in |
| GET POST DELETE | `/api/game-creator/games/[id]` | owner's sign-in |
| GET | `/api/game-creator/shots/[id]/[n]` | owner's sign-in |

### Data & database rules

- Server docs (server_docs via readDoc/writeDoc) — `src/lib/game-creator/store.ts`

### Keys & outside services

- `GAME_CREATOR_DATA_DIR` — `src/lib/game-creator/store.ts`

### Tests

- `src/lib/game-creator/reducer.test.ts`
<!-- code:end -->

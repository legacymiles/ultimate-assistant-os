# Game Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prompt → a real, packaged Unreal Engine 5.8 game on the user's PC, catalogued with screenshots and info in the hub's Game Creator app.

**Architecture:** A local stdio MCP "bridge" launches the Unreal Editor and proxies Epic's built-in Unreal MCP server (streamable HTTP inside the editor). A Claude Code skill drives that toolchain from prompt to packaged game and writes a manifest. The hub app queues prompts and shows games; a builder daemon on the PC claims queued prompts, runs `claude -p` with the skill, and streams status, log and screenshots back through token-authenticated endpoints.

**Tech Stack:** Node 24 ESM, `@modelcontextprotocol/sdk`, Unreal Engine 5.8 (ModelContextProtocol + AllToolsets + PythonScriptPlugin), Next.js 15 App Router, `docStore`/`blobStore`, vitest 2.

Spec: `docs/superpowers/specs/2026-09-13-game-creator-design.md`.

---

## Verified facts about Epic's MCP server (from `ModelContextProtocolServer.cpp`)

- Routes: `POST /mcp` (JSON-RPC), `GET /mcp` returns BadMethod (no server-push channel), `DELETE /mcp` ends a session.
- `initialize` needs no session and returns the session in the `Mcp-Session-Id` response header. Every later request must send it: missing → 400, unknown → error.
- `notifications/initialized` → 202.
- `tools/list`, `ping`, resources → `application/json` body.
- `tools/call` → `text/event-stream`, kept open; progress notifications and the final JSON-RPC result arrive as SSE `data:` events. `notifications/tools/list_changed` is only delivered on an open tools/call stream.
- Origin header must be absent or localhost.

## File map

```
tools/unreal-bridge/
  package.json              deps: @modelcontextprotocol/sdk
  server.mjs                MCP stdio server: bridge tools + proxied Epic tools
  lib/paths.mjs             engine + projects root discovery
  lib/templates.mjs         template table (id → engine folder, default map)
  lib/project.mjs           createProject(): copy template, write .uproject, registry entry
  lib/registry.mjs          read/write registry.json
  lib/epic.mjs              EpicClient: initialize, listTools, callTool (SSE parse), close
  lib/editor.mjs            launch / wait / close / log tail / running detection
  lib/package.mjs           RunUAT BuildCookRun wrapper
  lib/sse.mjs               parseSse(text) → JSON-RPC messages
  test/*.test.mjs           node:test unit tests (sse, project, registry)
~/.claude/skills/unreal-game-builder/
  SKILL.md
  references/{pipeline,templates,blueprint-dsl,gameplay-patterns,packaging}.md
src/lib/game-creator/
  types.ts                  Game, GameStatus, Manifest, TEMPLATES
  reducer.ts                pure: addGame, claimNext, applyProgress, failGame, removeGame
  reducer.test.ts
  store.ts (server-only)    load/save per-owner doc, builder token mint/verify, screenshot blobs
src/app/api/game-creator/
  games/route.ts            GET list, POST create
  games/[id]/route.ts       GET one, DELETE
  shots/[id]/[n]/route.ts   GET screenshot bytes (session)
  builder-token/route.ts    GET linked?, POST mint
  builder/claim/route.ts    token
  builder/progress/route.ts token
  builder/screenshot/route.ts token
  builder/fail/route.ts     token
src/app/apps/game-creator/page.tsx
src/app/apps/game-creator/[id]/page.tsx
src/components/game-creator/{GameCreator,GameCard,GamePage,BuilderSetup}.tsx, game-creator.css
src/middleware.ts           exact-match exemptions for the four builder paths
src/lib/catalog.ts          new entry
tools/unreal-builder/
  package.json, builder.mjs, lib/hub.mjs, lib/watch.mjs, lib/claude.mjs, open.mjs, install.mjs
```

---

### Task 1: Bridge — SSE parser, registry, project creation (unit-tested)

**Files:** `tools/unreal-bridge/{package.json,lib/sse.mjs,lib/registry.mjs,lib/paths.mjs,lib/templates.mjs,lib/project.mjs,test/*.test.mjs}`

- [ ] Write `test/sse.test.mjs`: `parseSse('event: message\ndata: {"a":1}\n\ndata: {"b":2}\n\n')` → `[{a:1},{b:2}]`; multi-line `data:` joined with `\n`; partial trailing event ignored.
- [ ] Write `test/project.test.mjs`: `buildUproject({template:'FirstPerson'})` has `EngineAssociation "5.8"` and plugins `ModelContextProtocol`, `AllToolsets`, `PythonScriptPlugin`, `EditorScriptingUtilities`, `ToolsetRegistry` all enabled, keeps template plugins; `safeProjectName('My cool game!')` → `MyCoolGame`; names starting with a digit get `G` prefix; max 20 chars.
- [ ] Write `test/registry.test.mjs`: with `GC_PROJECTS_ROOT` pointed at a temp dir, `upsert({id,name,...})` then `get(id)` round-trips; `list()` newest first.
- [ ] Run `node --test tools/unreal-bridge/test` → FAIL (modules missing).
- [ ] Implement modules. `templates.mjs`:
  ```js
  export const TEMPLATES = {
    FirstPerson: { folder: 'TP_FirstPersonBP', map: '/Game/FirstPerson/Lvl_FirstPerson' },
    ThirdPerson: { folder: 'TP_ThirdPersonBP', map: '/Game/ThirdPerson/Lvl_ThirdPerson' },
    TopDown:     { folder: 'TP_TopDownBP',     map: '/Game/TopDown/Lvl_TopDown' },
    Vehicle:     { folder: 'TP_VehicleAdvBP',  map: '/Game/VehicleTemplate/Maps/Lvl_VehicleBasic' },
    Blank:       { folder: 'TP_BlankBP',       map: '/Engine/Maps/Templates/OpenWorld' },
  };
  ```
  `project.mjs` `createProject({name, template, id})`: copy `Config` + `Content` from the engine template (skip `TemplateDefs.ini`), write `<Name>.uproject` from `buildUproject`, create `GameCreator/shots/`, upsert registry, return `{id, name, projectDir, uproject}`. Refuse if the directory exists and is non-empty.
- [ ] Run tests → PASS. Commit `tools/unreal-bridge`.

### Task 2: Bridge — Epic client + editor lifecycle, verified against the live editor

**Files:** `tools/unreal-bridge/lib/{epic.mjs,editor.mjs}`, `tools/unreal-bridge/scripts/probe.mjs`

- [ ] `EpicClient(url)`: `initialize()` POSTs initialize, stores `Mcp-Session-Id`, sends `notifications/initialized`; `request(method, params)` sends JSON with session header and `Accept: application/json, text/event-stream`; if response content-type is event-stream, read the body to completion, `parseSse`, return the message whose `id` matches; `listTools()` follows `nextCursor`; `callTool(name, args, {timeoutMs})`; `close()` sends DELETE. Retries `initialize` once on 400 unknown session.
- [ ] `editor.mjs`: `launch(uproject, port)` spawns `UnrealEditor.exe` detached with `-ModelContextProtocolStartServer -ModelContextProtocolPort=<port>`, records `{pid, uproject, port}` in `<root>/.game-creator/editor.json`; `waitReady(port, timeoutMs, pid)` polls initialize every 5 s, throws with last 40 log lines if the process exits; `isRunning()`; `close({graceMs})` calls Epic `execute_tool_script` with `unreal.SystemLibrary.quit_editor()` after saving all, then kills after grace; `logTail(projectDir, lines, grep)`.
- [ ] `scripts/probe.mjs`: connect to the running probe editor, print tool list, `list_toolsets`, `describe_toolset` for the editor toolsets, run `get_graph_dsl_docs`, run `execute_tool_script` returning the level's actor labels. Run it; save the real output to `tools/unreal-bridge/probe-output.txt` (gitignored) and fold real argument shapes into the skill references in Task 4.
- [ ] Commit.

### Task 3: Bridge — MCP server, packaging, screenshot, registration

**Files:** `tools/unreal-bridge/{server.mjs,lib/package.mjs}`

- [ ] `server.mjs` using low-level `Server` from the SDK (so the tool list can change): bridge tools `unreal_status`, `unreal_new_project`, `unreal_open_project`, `unreal_close_editor`, `unreal_editor_log`, `unreal_screenshot`, `unreal_package`, `unreal_play`, `unreal_list_games`. When Epic is connected, append Epic's tools verbatim and forward `tools/call` for any non-bridge name; otherwise return `isError` "Editor not running — call unreal_open_project first". Send `notifications/tools/list_changed` after connect/disconnect. On startup, if `editor.json` names a live pid whose port answers, attach automatically.
- [ ] `unreal_screenshot({name, width=1920, height=1080})`: via Epic `execute_tool_script`, run `unreal.AutomationLibrary.take_high_res_screenshot(w,h,path)` with path `<project>/GameCreator/shots/<name>.png`; poll up to 20 s for the file; return the path.
- [ ] `package.mjs` `packageGame(uproject, outDir, onLine)`: spawn `Engine\Build\BatchFiles\RunUAT.bat BuildCookRun -project=<uproject> -noP4 -platform=Win64 -clientconfig=Development -cook -build -stage -pak -archive -archivedirectory=<outDir> -unattended -utf8output`; resolve `{ok, exe, logTail}` where exe is found under `outDir/Windows/*.exe`. Editor must be closed first (the tool saves and closes it).
- [ ] Smoke: `node server.mjs` under the SDK's in-memory or stdio client script `scripts/smoke.mjs` lists bridge tools, calls `unreal_status`.
- [ ] Register: `claude mcp add --scope user unreal -- node "C:\Users\honey\OneDrive\Desktop\claude code files\tools\unreal-bridge\server.mjs"`; `claude mcp list` shows `unreal` connected.
- [ ] Commit.

### Task 4: Skill + proof game

**Files:** `~/.claude/skills/unreal-game-builder/SKILL.md`, `references/*.md`

- [ ] Write SKILL.md (frontmatter description with triggers; the six stages; rules; `game.json` schema; stage file protocol: write `GameCreator/status.json` `{stage, note}` at each stage start so the builder can follow along).
- [ ] Build the proof game through the bridge in this session: first-person target shooting (targets spawn, shoot them for points, 60 s timer, HUD with score and time, end screen). Record every DSL/tool pitfall hit into `references/blueprint-dsl.md` and `gameplay-patterns.md`.
- [ ] Screenshot, package, play the exe, confirm it runs. Write `game.json`.
- [ ] Commit nothing from the skill dir (outside repo); copy the skill into `skills/unreal-game-builder/` in the repo for backup and commit that.

### Task 5: Hub data layer (TDD)

**Files:** `src/lib/game-creator/{types.ts,reducer.ts,reducer.test.ts,store.ts}`

- [ ] Tests in `reducer.test.ts`: `addGame` puts newest first with status `queued`; `claimNext` picks the OLDEST queued game, sets `designing` + `startedAt`, returns null when none; `applyProgress` merges manifest fields, appends log lines capped at 500, ignores status regressions from `ready`, sets `finishedAt` on `ready`; `failGame` sets `failed` + error; `removeGame`.
- [ ] Run `npx vitest run src/lib/game-creator` → FAIL. Implement. → PASS.
- [ ] `store.ts`: doc `game-creator` `{ tokens: Record<uid,sha256>, games: Record<uid, Game[]> }`, `dataDir()` = `GAME_CREATOR_DATA_DIR || process.cwd()/.data`; `mintToken`, `uidForToken`, `hasToken`, `listGames`, `getGame`, `createGame`, `claim`, `progress`, `fail`, `remove`, `putShot`, `getShot` (bucket `game-shots`, key `<uid>/<gameId>/<n>.png`, `ensureBucket`). Serialise writes per process with a promise chain to avoid lost updates from rapid progress posts.
- [ ] Commit.

### Task 6: Hub API + middleware

- [ ] Session routes read uid from the `hub_uid` cookie (fallback `local`), as the inbox routes do.
- [ ] Builder routes read `Authorization: Bearer <token>` → `uidForToken`, 401 otherwise.
- [ ] Middleware: replace the single exact match with a `TOKEN_PATHS` Set containing the inbox push path and the four builder paths; update the comment.
- [ ] Verify with curl against the dev server: builder route without token → 401; mint token (local, no Supabase) → claim returns 204 when empty; create game → claim returns it; progress → GET shows merged log; screenshot upload → GET shot returns png bytes.
- [ ] Commit.

### Task 7: Hub UI + catalog

- [ ] `GameCreator.tsx`: prompt textarea, template chips, Build button, gallery grid of `GameCard` (status pill, first screenshot or animated placeholder, title/prompt, relative time), polling every 5 s while any game is active, `BuilderSetup` panel (token mint + copy, `npm run builder` command, "builder hasn't checked in" state using `lastSeen` stored on claim polls).
- [ ] `GamePage.tsx`: screenshots strip with lightbox, summary/controls/features/cut, design markdown via existing `Markdown` component, live log, **Open in Unreal** (`ueos://open?id=`) and **Play** (`ueos://play?id=`) buttons, paths with copy buttons, delete.
- [ ] Catalog entry per spec.
- [ ] Browser verify: gallery empty state, create game, card appears queued, game page renders, mobile width. Screenshot.
- [ ] Commit.

### Task 8: Builder daemon + ueos handler

- [ ] `lib/hub.mjs`: `claim()`, `progress(gameId, body)`, `screenshot(gameId, file, caption)`, `fail(gameId, error)` with bearer token.
- [ ] `lib/claude.mjs`: spawn `claude -p <prompt> --output-format stream-json --verbose --permission-mode bypassPermissions` with cwd = projects root; parse NDJSON; emit `{type:'text'|'tool', line}`.
- [ ] `lib/watch.mjs`: poll `<projectsRoot>/<Name>/GameCreator/` every 3 s for `status.json`, `Design.md`, new pngs, `game.json`. Project folder is learned from the registry entry with `id === game.id`.
- [ ] `builder.mjs`: loop per spec, `.env` loading, 90 min cap, one job at a time, heartbeat claim every 15 s.
- [ ] `open.mjs` handles `ueos://open?id=` and `ueos://play?id=`; `install.mjs` writes `HKCU\Software\Classes\ueos` via `reg add` pointing to `node open.mjs "%1"`.
- [ ] Commit.

### Task 9: End to end + docs + memory

- [ ] Dev server + builder at `http://localhost:3000`; queue a small game from the UI; watch it reach `ready` with screenshots; click Open in Unreal; run the exe.
- [ ] Memory: `game-creator-app.md`, `unreal-bridge-mcp.md`, index lines.
- [ ] Commit with explicit paths, push.

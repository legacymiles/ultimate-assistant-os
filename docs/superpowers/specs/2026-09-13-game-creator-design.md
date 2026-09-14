# Game Creator — design

Date: 2026-09-13. Status: approved in conversation, awaiting written review.

## What it is

Three pieces that together turn "build this game" into a playable Unreal Engine
game on the user's PC, catalogued in the OS hub:

1. **`unreal` MCP server (the bridge)** — a local stdio MCP server that manages
   the Unreal Editor's lifecycle and proxies Epic's built-in Unreal MCP toolsets.
2. **`unreal-game-builder` skill** — the recipe Claude follows to go from a
   prompt to a compiled, tested, packaged game using those tools.
3. **Game Creator app** in the hub (`/apps/game-creator`) plus a **builder
   daemon** on the PC — the prompt box, the live gallery of games, and the
   program that runs the skill for each queued prompt.

The web app never touches Unreal. It queues prompts and shows results. All
building happens on the user's PC, where Unreal Engine 5.8 is installed.

## Facts this design rests on (verified on the machine, 2026-09-13)

- Unreal Engine 5.8 at `C:\Program Files\Epic Games\UE_5.8`.
- Epic ships an official, prebuilt **ModelContextProtocol** plugin
  (`Engine/Plugins/Experimental/ModelContextProtocol`). It is a streamable-HTTP
  MCP server inside the editor at `http://127.0.0.1:8000/mcp`, protocol
  2025-11-25. Disabled by default; enabled per project in the `.uproject`.
  Starts with the `-ModelContextProtocolStartServer` command-line flag, port via
  `-ModelContextProtocolPort=N`. Console: `ModelContextProtocol.StartServer`,
  `.StopServer`, `.RefreshTools`, `.GenerateClientConfig ClaudeCode`.
- With `bEnableToolSearch` (default true) the server exposes three MCP tools:
  `list_toolsets`, `describe_toolset`, `call_tool`. All editor tools are
  dispatched through `call_tool`.
- Epic's toolsets live in `Engine/Plugins/Experimental/Toolsets/*` (aggregator
  plugin **AllToolsets**). **EditorToolset** covers actors, assets, Blueprints
  (including a text **graph DSL**: `get_graph_dsl_docs`, `write_graph_dsl`,
  `read_graph_dsl`), materials, data tables/assets, static/skeletal meshes,
  textures, string tables, scene, and `execute_tool_script` (arbitrary editor
  Python). Others: UMG, Niagara, StateTree, AIModule (behavior trees), GAS,
  GameplayTags, PCG, Physics, Animation/Sequencer, AutomationTest, LiveCoding,
  ConfigSettings, Plugin, SemanticSearch, SlateInspector.
- Engine templates: `TP_FirstPersonBP`, `TP_ThirdPersonBP`, `TP_TopDownBP`,
  `TP_VehicleAdvBP`, `TP_BlankBP` (Blueprint-only, no compiler needed).
  C++ twins exist and Visual Studio Build Tools 2026 is installed, but v1 is
  Blueprint-only.
- Claude Code CLI 2.1.114 is installed (`claude -p` works headless). Node 24.
  No `gh`, no `ffmpeg`.
- Hub: Next.js 15 App Router, Supabase login wall via `src/middleware.ts`,
  `src/lib/server/docStore.ts` (JSON docs, Postgres or local file) and
  `blobStore.ts` (Supabase Storage or local file). The iPhone inbox pattern
  (`/api/dashboard/inbox/push`, per-user hashed token, exact-match middleware
  exemption) is the model for the builder's endpoints.

## Piece 1 — `unreal` bridge MCP

Location: `tools/unreal-bridge/` in the hub repo (plain ESM `.mjs`, own
`package.json` with `@modelcontextprotocol/sdk`; excluded from the Next build
by living outside `src/`). Registered at **user scope** in Claude Code so it is
available from any folder:

```
claude mcp add --scope user unreal -- node "<repo>\tools\unreal-bridge\server.mjs"
```

Why a bridge instead of Epic's plain HTTP entry: Claude Code connects to MCP
servers at session start. Epic's server only exists while the editor is open,
so a plain HTTP entry shows as failed whenever the editor is not already
running. The bridge always starts, and brings the editor up itself.

### Bridge's own tools

| tool | does |
|---|---|
| `unreal_status` | engine path, running editor (pid, project, port), whether Epic's `/mcp` answers |
| `unreal_new_project` | `{name, template, dir?}` → copies the engine template, writes the `.uproject` with `ModelContextProtocol` + `AllToolsets` (+ `PythonScriptPlugin`) enabled, registers the game in the PC registry, returns paths |
| `unreal_open_project` | `{uproject}` → launches `UnrealEditor.exe <uproject> -ModelContextProtocolStartServer -ModelContextProtocolPort=8000`, waits for `/mcp` to answer `initialize` (timeout 15 min for first-run shader compile), connects the proxy, emits `tools/list_changed` |
| `unreal_close_editor` | asks the editor to save-all and quit; falls back to kill after a grace period |
| `unreal_editor_log` | `{lines?, grep?}` → tail of `Saved/Logs/<Project>.log` |
| `unreal_screenshot` | `{name}` → high-res viewport screenshot into `<project>/GameCreator/shots/`, returns path |
| `unreal_package` | runs `RunUAT.bat BuildCookRun` for Win64 Development into `<project>/Packaged/`, streams progress, returns exe path |
| `unreal_play` | launches the packaged exe (or `-game` on the editor if not packaged) |

### Proxy

When the editor's `/mcp` is reachable, the bridge lists Epic's tools and
re-exposes them under the same names (`list_toolsets`, `describe_toolset`,
`call_tool`, or the full native set if tool search is off). Calls are forwarded
unchanged, results returned unchanged. While the editor is down, those tools
are absent and any stale call returns a clear "editor not running — call
unreal_open_project" error instead of hanging.

### PC registry

`%USERPROFILE%\Documents\Unreal Projects\.game-creator\registry.json`:
`{ [gameId]: { name, uproject, projectDir, packagedExe?, createdAt } }`.
Used by the bridge, the builder, and the `ueos://` protocol handler.

## Piece 2 — `unreal-game-builder` skill

Location: `~/.claude/skills/unreal-game-builder/` (same place as the user's
other custom skills). Triggers on: build/make/create a game, "in Unreal",
"Unreal Engine", "UE5", game prompts naming a genre plus mechanics.

`SKILL.md` — the pipeline, kept short. `references/`:
- `pipeline.md` — stage-by-stage checklist with the exact tool sequence.
- `templates.md` — what each engine template already gives you (character,
  input mappings, camera, HUD), so the skill builds on it instead of from zero.
- `blueprint-dsl.md` — notes on Epic's graph DSL learned during verification
  (always call `get_graph_dsl_docs` first; the notes cover the pitfalls, not
  the syntax).
- `gameplay-patterns.md` — recipes: spawner, pickup, score + HUD, health and
  damage, timer and win/lose, simple enemy AI with a behavior tree, checkpoint,
  projectile.
- `packaging.md` — BuildCookRun flags, common failures, how to read the UAT log.

### Stages (each emits a progress event, see Piece 3)

1. **design** — one-page `Design.md`: title, pitch, core loop, controls,
   win/lose, the 3–6 features that will actually be built, template choice.
   Written into `<project>/GameCreator/Design.md`.
2. **project** — `unreal_new_project`, `unreal_open_project`.
3. **build** — gameplay via Epic toolsets: Blueprints with the DSL, actors
   placed in the level, materials, data tables, UMG HUD. Compile every
   Blueprint with `warnings_as_errors` off, fix errors before moving on.
4. **test** — run the project's automation tests if any, play-in-editor smoke
   run via `execute_tool_script` (start PIE, wait, read log for errors, stop),
   take 3–5 screenshots at meaningful moments (menu, gameplay, win/lose).
5. **package** — `unreal_package`; on failure, read the UAT log, fix, retry once.
6. **report** — write `<project>/GameCreator/game.json`:
   `{ id, title, summary, genre, controls[], features[], cut[], template, uproject,
   packagedExe, screenshots[], design: "Design.md", stage: "ready" }`.

Rules baked into the skill: Blueprint-only unless the prompt demands C++;
never leave a Blueprint uncompiled; prefer template systems over rebuilding
them; every feature in `Design.md` must be either built or explicitly listed
under "cut" in the report with a reason; time-box the build to what the
template plus ~6 Blueprints can express.

## Piece 3 — Game Creator app + builder daemon

### Data

One server document per owner, `game-creator:<userId>`, in `server_docs`:

```
Game {
  id, ownerId, prompt, template, createdAt,
  status: "queued" | "designing" | "building" | "testing" | "packaging" | "ready" | "failed",
  title?, summary?, genre?, controls?[], features?[], cut?[],
  design?: string (markdown),
  log: { t, line }[]  (capped at last 500),
  screenshots: { key, caption? }[]  (blob keys),
  paths?: { uproject, projectDir, packagedExe? },
  error?: string, startedAt?, finishedAt?
}
```

Screenshots go to Supabase Storage bucket `game-shots` (`<ownerId>/<gameId>/n.png`)
through `blobStore.ts`, local file fallback in dev.

### Routes and API

- `/apps/game-creator` — prompt box (prompt + template select + Build), then
  the gallery: one card per game, newest first, status pill, first screenshot,
  title or truncated prompt. Polls every 5 s while any game is not ready/failed.
- `/apps/game-creator/[id]` — game page: screenshots strip, summary, controls,
  features (with cut list), design doc, live log, and the **Open in Unreal**
  and **Play** buttons plus the visible paths with copy buttons.
- Session-authenticated API (`/api/game-creator/...`): `games` GET/POST,
  `games/[id]` GET/DELETE, `builder-token` POST (create/rotate; hashed at rest,
  shown once, same as the inbox token).
- Builder API, **token-authenticated and session-exempt** by exact match in
  `src/middleware.ts` (the comment there is updated to list all exempt paths):
  - `POST /api/game-creator/builder/claim` → oldest queued game → `designing`,
    returns it (or 204).
  - `POST /api/game-creator/builder/progress` → `{ gameId, status?, lines?[],
    design?, manifest? }` merges into the game.
  - `POST /api/game-creator/builder/screenshot` → multipart png, appended.
  - `POST /api/game-creator/builder/fail` → `{ gameId, error }`.

### Open in Unreal / Play

A browser cannot launch a local program by path, so the builder installs a
per-user URL protocol `ueos:` (HKCU registry, no admin) that runs
`tools/unreal-builder/open.mjs <url>`. Buttons: `ueos://open?id=<gameId>`
opens the `.uproject` in UnrealEditor; `ueos://play?id=<gameId>` launches the
packaged exe. Both resolve through the PC registry. The page also shows the
raw paths so nothing depends on the handler.

### Builder daemon

`tools/unreal-builder/builder.mjs`, started with `npm run builder` (env file
`tools/unreal-builder/.env`: `HUB_URL`, `BUILDER_TOKEN`). Loop:

1. Every 15 s `claim`. On a job the server marks it `designing`.
2. Run `claude -p` with a prompt that names the skill and the game prompt, in
   `--output-format stream-json`, `--permission-mode bypassPermissions`,
   working directory the Unreal projects folder. Optional model override via
   env.
3. Tail Claude's stream: assistant text and tool-call names become log lines
   (batched, posted every 2 s). Watch `<project>/GameCreator/`: `Design.md`
   → posts design + status `building`; new pngs in `shots/` → uploaded;
   `game.json` with `stage` → status updates, and `ready` finishes the job
   with the manifest.
4. Non-zero exit or 90 min wall clock → `fail` with the last 20 log lines.
5. One job at a time. The editor is closed between jobs.

`npm run builder:install` writes the `ueos:` registry keys and prints a Task
Scheduler command for running at login (user runs it if wanted).

### Catalog entry

`slug: "game-creator"`, category `Apps`, `status: "live"`, `appUrl:
"/apps/game-creator"`, iconStyle `orbit`, hues around 265/330. Overview
explains prompt → Unreal on your PC → catalogue with screenshots and a link to
the real game.

## Error handling

- Editor never comes up: bridge reports the last 40 log lines; builder fails
  the job with them.
- Blueprint compile errors: skill reads them from the compile result and
  retries; after 3 failed attempts on the same graph it simplifies the feature
  and records it under `cut`.
- Packaging failure: one fix-and-retry, then the game is still marked `ready`
  with `packagedExe` absent and a note; Open in Editor still works.
- Builder offline: games sit `queued`; the app shows "waiting for your PC's
  builder" with the command to start it.
- Token missing or wrong: 401, never touches the doc.

## Testing

- Bridge: unit tests for `.uproject` generation and registry handling; a real
  integration run against the editor (initialize, `list_toolsets`, one
  `call_tool`, screenshot, close) recorded in the plan as the acceptance step.
- Skill: verified by building the proof game end to end; DSL findings folded
  into `references/blueprint-dsl.md`.
- App: vitest for the game-doc reducer (claim, progress merge, log cap);
  browser check of gallery, game page, builder-offline state; API auth checks
  (no token → 401, session route without session → redirect).
- End to end: dev server + builder pointed at `http://localhost:3000`, queue a
  first-person target-shooting game from the app, watch it reach `ready`,
  open it with the `ueos://` link, play the packaged exe.

## Out of scope for v1

C++ projects, multiplayer, in-browser play (Pixel Streaming), gameplay video
capture, downloading builds from the site, multiple concurrent builds, Mac.

## Build order

1. Bridge MCP + registration + editor integration test.
2. Skill + proof game built interactively (this validates the DSL notes).
3. Game Creator app (data, API, pages, catalog) with the builder-offline state.
4. Builder daemon + `ueos:` handler.
5. End-to-end run from the app; memory notes; commit and push.

---
name: unreal-game-builder
description: >-
  Build a real, playable Unreal Engine 5.8 game from a prompt, end to end: design, create the
  project, build the gameplay with Blueprints, playtest, screenshot, and package a Windows .exe.
  Use this WHENEVER the user wants to make, build, create, prototype or generate a video game or
  game level — "build this game", "make me a game where…", "create a first-person shooter / racer /
  platformer / top-down / horror game", "in Unreal", "Unreal Engine", "UE5", "UE 5.8", "make a
  playable demo" — or when a Game Creator job (a prompt with a game id) is handed to you. Also use
  it to extend or fix a game project this pipeline already created. Requires the `unreal` MCP
  server (tools named unreal_*); if those tools are missing, tell the user the bridge is not
  connected instead of improvising.
---

# Unreal Game Builder

You turn a prompt into a packaged Unreal Engine 5.8 game on this PC. The `unreal` MCP server
gives you two kinds of tools:

- **Bridge tools** (`unreal_*`): project creation, editor lifecycle, screenshots, packaging.
- **Epic's editor tools**, available once the editor is open, through three dispatchers:
  `list_toolsets`, `describe_toolset`, `call_tool {toolset_name, tool_name, arguments}`.

Read `references/pipeline.md` before starting — it has the exact tool sequence. Read
`references/blueprint-dsl.md` before writing any Blueprint logic. Read
`references/gameplay-patterns.md` when building a mechanic it covers.

## Stages

Write `GameCreator/status.json` in the project folder at the START of each stage:
`{"stage": "<stage>", "note": "<one line of what you are doing>"}`. The Game Creator builder
watches that file to show live progress; before the project exists, keep the note in your reply.

1. **design** — Turn the prompt into a one-page design (title, pitch, core loop, controls,
   win/lose, 3–6 features you will actually build, template). Pick the template whose character and
   camera already match (see `references/templates.md`). Keep scope to what the template plus about
   six Blueprints can express; say what you are leaving out.
2. **project** — `unreal_new_project` (pass the Game Creator `id` if you were given one), write
   `GameCreator/Design.md`, then `unreal_open_project`. First launch compiles shaders: be patient.
3. **build** — Build each feature with Epic's tools. Blueprints via the DSL, actors placed into the
   template level, HUD with UMG. Compile after each Blueprint; fix every compile error before moving
   on. Save with `AssetTools.save_assets {asset_paths: []}` after each feature.
4. **test** — `EditorAppToolset.StartPIE`, let it run, read `LogsToolset.GetLogEntries` for errors
   and your PrintString checkpoints, take gameplay screenshots with `unreal_screenshot view:"player"`,
   `EditorAppToolset.StopPIE`. Fix what broke, then test again.
5. **package** — `unreal_package`. On failure read its errors, fix, package once more.
6. **report** — Write `GameCreator/game.json` (schema below) with `"stage": "ready"`, then give the
   user a short summary: what the game is, controls, what was cut, and the exe path.

## Rules

- **Never guess a Blueprint node type id or pin name.** Look it up with `find_node_types` first.
  Guessed ids fail (`Math|Conversions|ToString(integer)` does not exist; it is
  `Utilities|String|ToString(Integer)`).
- **Pass every argument Epic's tools list, including "optional" ones.** Omitting one fails with
  "needs a default value" or "is required": send `null`, `[]`, `""` or `{}` explicitly.
- Object arguments are references: `{"refPath": "/Game/Folder/BP_X.BP_X"}`. Classes too:
  `{"refPath": "/Script/Engine.Actor"}`, and a Blueprint's class is `/Game/.../BP_X.BP_X_C`.
- Blueprint-only. Do not add C++ unless the user insists; this PC packages Blueprint projects
  without a compiler, and C++ would break that.
- Build on the template: its character, input actions, camera and game mode already work.
  Extend or replace them only when the design requires it.
- Every feature in the design ends up either built or listed in `cut` with a reason.
- Epic's script tool (`ProgrammaticToolset.execute_tool_script`) is sandboxed: it can batch tool
  calls, but cannot import `unreal`. Use it to cut round-trips, not to reach the engine API.
- Screenshots: at least three — a wide shot of the level, one or more in-game `view:"player"` shots
  showing the core mechanic, and the HUD. Give each a caption.

## game.json

```json
{
  "id": "<game id>",
  "title": "Neon Target Range",
  "summary": "Two sentences a player would read.",
  "genre": "First-person shooter",
  "template": "FirstPerson",
  "controls": ["WASD — move", "Mouse — look", "Left click — shoot"],
  "features": ["Targets spawn every 2 s", "60-second round timer", "Score HUD"],
  "cut": [{"feature": "Online leaderboard", "reason": "Needs a backend; out of scope"}],
  "screenshots": [{"file": "shots/01-overview.png", "caption": "The range"}],
  "uproject": "C:\Users\...\NeonTargetRange.uproject",
  "packagedExe": "C:\Users\...\Packaged\Windows\NeonTargetRange.exe",
  "stage": "ready"
}
```

If the build cannot finish, still write game.json with `"stage": "failed"` and an `"error"` field
explaining what blocked it, so the gallery shows an honest result.

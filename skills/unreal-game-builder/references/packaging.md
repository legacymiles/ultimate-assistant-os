# Packaging

`unreal_package {id}` saves every asset, closes the editor, and runs Unreal's AutomationTool
`BuildCookRun` for Win64 Development into `<project>/Packaged/Windows/<Name>.exe`. A fresh
FirstPerson project takes about 6 minutes on this PC; later packages reuse cooked data.

## What the bridge does for you (verified on UE 5.8)

- **Content-only build, no compiler.** This PC has Visual Studio Build Tools but not the .NET
  Framework SDK, so anything that makes Unreal compile C++ fails (`RulesError: Could not find
  NetFxSDK install dir`). The bridge packages without `-build`, staging the engine's prebuilt
  `UnrealGame.exe`.
- **Runtime plugins are left out of the package.** AutomationTool treats a Blueprint project as
  code-based if it enables any runtime plugin the engine does not enable by default — the stock
  FirstPerson template's own `GameplayStateTree` triggers it. For the length of the package run the
  bridge rewrites the `.uproject` to keep only editor-only plugins (`TargetAllowList: ["Editor"]`),
  then restores it. The result lists them as `pluginsLeftOutOfPackage`.

## What that means for the game you build

- Do not rely on a runtime plugin the engine does not enable by default. Engine modules that are
  always on (AI, Enhanced Input, UMG, Chaos physics, Niagara, audio) are fine.
- If `pluginsLeftOutOfPackage` names a plugin your game actually uses, the cook reports errors for
  the assets that reference it. Rebuild that feature without the plugin, or record it under `cut`
  with the reason "needs a plugin that requires a C++ build on this PC".
- Never add C++ classes or a `Source` folder. That turns the project into a code project and
  packaging will fail on this machine.

## Reading a failure

`unreal_package` returns `errors` (last error-looking lines) and `logTail`. Common ones:

| error | cause | fix |
|---|---|---|
| `Could not find file ...Binaries\Win64\<Name>Editor.target` | project treated as code-based | a runtime plugin or a Source folder crept in; remove it |
| `RulesError` / `NetFxSDK` | something asked UnrealBuildTool to compile | same as above |
| `LogCook: Error: ... Failed to load` | an asset references something missing or a left-out plugin | open the asset, fix or remove the reference, save, package again |
| `Blueprint ... failed to compile` during cook | a Blueprint has compile errors | open the project, `compile_blueprint`, fix, save |

Package at most twice. If the second attempt fails, report the game with `"stage": "failed"`
and the error — the project still opens in the editor.

## After packaging

`unreal_play {id}` launches the exe. The Game Creator page's Play button does the same through the
`ueos://play` link, and the registry records `packagedExe` for it.

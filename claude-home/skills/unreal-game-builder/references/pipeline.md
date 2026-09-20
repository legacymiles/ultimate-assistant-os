# Pipeline — exact tool sequence

Toolset names used below (pass as `toolset_name` to `call_tool`, with the SHORT `tool_name`):

| short | full toolset_name |
|---|---|
| APP | `EditorToolset.EditorAppToolset` |
| LOGS | `EditorToolset.LogsToolset` |
| BP | `editor_toolset.toolsets.blueprint.BlueprintTools` |
| ACTOR | `editor_toolset.toolsets.actor.ActorTools` |
| SCENE | `editor_toolset.toolsets.scene.SceneTools` |
| ASSET | `editor_toolset.toolsets.asset.AssetTools` |
| OBJ | `editor_toolset.toolsets.object.ObjectTools` |
| UMG | `UMGToolSet.UMGToolSet` |
| MAT | `editor_toolset.toolsets.material.MaterialTools`, `editor_toolset.toolsets.material_instance.MaterialInstanceTools` |
| SCRIPT | `editor_toolset.toolsets.programmatic.ProgrammaticToolset` |

Before the first use of a toolset in a session, call `describe_toolset {toolset_name}` and read the schemas.

## 0. Check

`unreal_status`. If an editor is open on a different project, `unreal_close_editor`.

## 1. Design

Write the design in your reply first: title, pitch, loop, controls, win/lose, features, cut,
template. Scope honestly — about six Blueprints on top of the template.

## 2. Project

```
unreal_new_project {name, template, variant?, id?} -> {id, projectDir, uproject, map, contentPacks}
write <projectDir>/GameCreator/status.json        {"stage":"project","note":"Creating the project"}
write <projectDir>/GameCreator/Design.md
```

## 2b. Assets (realistic games — references/realism.md)

```
status.json {"stage":"assets","note":"Importing real models and surfaces"}
unreal_find_assets {type:"models", query}          confirm ids
unreal_find_assets {type:"textures", query}
unreal_add_assets {id, models:[...], surfaces:[...]}   ONE call, editor closed; ~30 s + downloads
unreal_open_project {id}                           first launch takes minutes (shaders)
```

Adding more later works the same way, but it closes the editor: save first, reopen after.

## 3. Build (repeat per feature)

```
status.json {"stage":"building","note":"<feature>"}
BP.create {folder_path:"/Game/<GameName>/Blueprints", asset_name, asset_type:{refPath}}
BP.add_variable ...                                 all variables first
BP.list_graphs                                      -> EventGraph ref
BP.find_node_types {graph, type_id_filter, context_pins:[]}   every node id you will use
BP.write_graph_dsl {graph, code}
BP.compile_blueprint {blueprint, warnings_as_errors:false}    fix errors now
SCENE.add_to_scene_from_asset {asset_path, name, xform, parent:null, snap_to_ground:true}
  or SCENE.add_to_scene_from_class {actor_type:{refPath:"/Game/.../BP_X.BP_X_C"}, name, xform, parent:null, snap_to_ground:true}
ASSET.save_assets {asset_paths:[]}
```

Game mode or default pawn changes: edit the template GameMode Blueprint's defaults through
`BP.get_default_object`, then `OBJ.list_properties` and `OBJ.set_properties`. The default map keeps
working without touching config files.

HUD: the UMG toolset creates a Widget Blueprint and its TextBlocks. In the player controller or
character BeginPlay, create the widget and add it to the viewport (look up the exact node ids).
Update text from gameplay events.

## 4. Test

```
status.json {"stage":"testing","note":"Playtesting"}
APP.StartPIE {options:{bSimulate:false, playMode:"PlayMode_InViewPort", warmupSeconds:3}}
LOGS.GetLogEntries {category:"", pattern:"Error|Warning|<checkpoint text>", maxEntries:50}
APP.StopPIE {}
ASSET.save_assets {asset_paths:[]}
unreal_game_shot {name:"01-spawn", caption:"...", seconds:8}       the REAL game view
unreal_game_shot {name:"02-combat", caption:"...", seconds:30}     enemies closed in
```

`unreal_game_shot` launches the project in -game mode (the saved state) and the engine screenshots
its own window: weapon, arms, HUD, post-process, no editor icons. Read the PNG back and judge it
honestly before moving on. It works with the editor still open.

`StartPIE` returns within seconds when every Blueprint compiles. If it hangs, a Blueprint has
compile errors and the editor is showing a modal dialog. Run
`unreal_editor_log {grep:"LogBlueprint: Error"}`, then `unreal_close_editor`, fix, and reopen.

Editor-view shots (wide level overviews only): `APP.SetCameraTransform {transform}`, then
`unreal_screenshot {name, view:"editor"}`. Editor billboard icons (lights, player start) appear in
them and there is no weapon or HUD, so they never stand in for gameplay. For third-person and vehicle games pass `thirdPersonDistance` (for
example 450).

## 5. Package

```
status.json {"stage":"packaging","note":"Packaging the Windows build"}
unreal_package {id}          saves and closes the editor; several minutes
unreal_game_shot {id, name:"03-packaged", seconds:10, packaged:true}
```

## 6. Report

Write `GameCreator/game.json` with `"stage":"ready"` (schema in SKILL.md) and tell the user.

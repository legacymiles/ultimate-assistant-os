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
unreal_new_project {name, template, id?}          -> {id, projectDir, uproject, map, contentPacks}
write <projectDir>/GameCreator/status.json        {"stage":"project","note":"Opening the editor"}
write <projectDir>/GameCreator/Design.md
unreal_open_project {id}                           first launch takes minutes (shaders)
```

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
unreal_screenshot {name:"02-gameplay", caption:"...", view:"player"}
APP.StopPIE {}
```

`StartPIE` returns within seconds when every Blueprint compiles. If it hangs, a Blueprint has
compile errors and the editor is showing a modal dialog. Run
`unreal_editor_log {grep:"LogBlueprint: Error"}`, then `unreal_close_editor`, fix, and reopen.

Editor-view shots: `APP.SetCameraTransform {transform}`, then `unreal_screenshot {name, view:"editor"}`.
Editor billboard icons (lights, player start) appear in editor-view shots, so frame away from them
or prefer player-view shots. For third-person and vehicle games pass `thirdPersonDistance` (for
example 450).

## 5. Package

```
status.json {"stage":"packaging","note":"Packaging the Windows build"}
unreal_package {id}          saves and closes the editor; several minutes
```

## 6. Report

Write `GameCreator/game.json` with `"stage":"ready"` (schema in SKILL.md) and tell the user.

# Blueprint graph DSL — field notes

Epic's `BlueprintTools.write_graph_dsl` turns S-expressions into Blueprint nodes and compiles. Call
`BlueprintTools.get_graph_dsl_docs` once per session for the grammar; these notes are what the docs
do not warn you about, all verified against UE 5.8.

## The loop that works

```
create {folder_path:"/Game/Game/Blueprints", asset_name:"BP_Target", asset_type:{refPath:"/Script/Engine.Actor"}}
  -> {refPath:"/Game/Game/Blueprints/BP_Target.BP_Target"}
list_graphs {blueprint}            -> [...:UserConstructionScript, ...:EventGraph]
add_variable {blueprint, name:"Score", type_name:"int", graph:null, container_type:null}
find_node_types {graph, type_id_filter:"ToString", context_pins:[]}   <- ALWAYS before writing
write_graph_dsl {graph, code}       -> null on success, isError with the failing form otherwise
compile_blueprint {blueprint, warnings_as_errors:false}
read_graph_dsl {graph}              -> confirm what was written
AssetTools.save_assets {asset_paths:[]}
```

All toolset names in `call_tool` are the FULL toolset name (e.g.
`editor_toolset.toolsets.blueprint.BlueprintTools`) plus the SHORT tool name (`create`). A fully
qualified tool name is rejected as "Unknown tool".

## Pitfalls

- **Node ids are not guessable.** Search with `find_node_types` (substring filter) and copy the id
  exactly, parentheses and capitalisation included. Verified ids:
  - `Development|PrintString`
  - `Utilities|String|ToString(Integer)`
  - `Variables|Default|GetScore` / `Variables|Default|SetScore` (appear after `add_variable`)
  - `Game|SpawnActorfromClass`, `Utilities|Time|SetTimerbyFunctionName`
  - Events: `EventBeginPlay`, `EventTick (DeltaSeconds)`, `Collision|EventActorBeginOverlap (OtherActor)`
- **`find_node_types` requires `context_pins`** even though it is described as optional. Pass `[]`.
  Same for `find_node_categories`.
- **Quote non-variables.** Class paths, enum values and asset paths must be strings, or the DSL
  reads them as undefined variables.
- **Bind, never repeat.** Each call form is a new node that runs again. Bind impure results
  (`GetActorLocation`, random, traces) once and reuse the variable.
- **Variables before graphs.** `add_variable` first, then the `Variables|Default|Get<Name>` ids
  exist. Compile after structural changes (components, variables, function signatures) or they are
  not visible to spawned instances.
- **Component events.** Get the component with `ActorTools.get_components`, then
  `BlueprintTools.add_component_bound_event {component, event_name:"OnComponentBeginOverlap", graph}`
  before referencing it in DSL.
- **Physics needs Movable.** Set the component's `Mobility` to Movable with
  `ObjectTools.set_properties` before simulating or applying impulses.
- **Discover property names.** `ObjectTools.list_properties {instance}` before `set_properties`;
  names vary per class and wrong ones fail silently. `set_properties` takes `values` as a JSON
  STRING, not an object.
- A graph write replaces the events you write but leaves other events in place; `read_graph_dsl`
  after writing shows the whole graph.

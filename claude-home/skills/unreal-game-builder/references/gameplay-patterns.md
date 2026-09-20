# Gameplay patterns

Each pattern names the pieces and the logic. Look up exact node ids with `find_node_types` before
writing DSL. Ids shown here were verified; anything else, search for.

## Score + HUD

- Variable `Score:int` on the GameMode (or PlayerState) Blueprint, and a function `AddScore(Amount)`.
- Widget Blueprint `WBP_HUD` with a TextBlock. The player controller creates it on BeginPlay and
  adds it to the viewport.
- Anything that awards points gets the GameMode, casts to your GameMode class, calls `AddScore`,
  and refreshes the HUD.

## Round timer + end of round

- GameMode: `TimeLeft:float`. BeginPlay starts a looping timer with
  `Utilities|Time|SetTimerbyFunctionName :Object self :FunctionName "Tick1s" :Time 1.0 :bLooping true`.
- `Tick1s` decrements, updates the HUD, and at zero clears the timer, shows an end widget with the
  score, and pauses the game or reopens the current level.

## Spawner

- Actor `BP_Spawner` with a class variable `SpawnClass` (default: your Blueprint class) and
  `Interval:float`. BeginPlay sets a looping timer calling `SpawnOne`.
- `SpawnOne`: bind a random point inside a box around the spawner, then
  `Game|SpawnActorfromClass :Class SpawnClass :SpawnTransform (Math|Transform|MakeTransform :Location p) :CollisionHandlingOverride "AdjustIfPossibleButAlwaysSpawn"`.
- Cap the live count with an int variable, decremented from the spawned actor's destroyed event.

## Shootable target

- The FirstPerson template character already has a fire input. Read its graph with
  `read_graph_dsl` first and reuse it.
- Target actor: a static mesh component (Movable, collision BlockAll). On damage or hit: add score,
  spawn an effect or play a sound, then destroy the actor.
- If nothing fires: add an event for the Shoot input action (search `find_node_types` with filter
  `EnhancedInputAction`), line trace from the camera, and apply damage to the hit actor.

## Pickup

- Actor with a sphere collision component. Create the overlap event with
  `add_component_bound_event {component, event_name:"OnComponentBeginOverlap", graph}`.
- In the event: check the other actor is the player pawn (player pawn at index 0), apply the
  effect, destroy the pickup.
- Idle motion: on Tick, add local yaw rotation.

## Health + damage + lose

- On the character: `Health:float` default 100. The damage event subtracts; at zero or below show
  the lose widget and disable input.
- Hazards: overlap volumes that apply damage on overlap, or on a timer while overlapping.

## Simple chasing enemy

- Character Blueprint whose AI controller class is `AIController`, auto-possessed when placed or
  spawned. Set both on its default object with `OBJ.set_properties`.
- BeginPlay: looping 0.5 s timer calling `Chase`, which moves toward the player pawn.
- Movement needs a NavMeshBoundsVolume over the floor:
  `SCENE.add_to_scene_from_class {actor_type:{refPath:"/Script/NavigationSystem.NavMeshBoundsVolume"}, ...}`,
  scaled over the play area.
- Contact damage: overlap, as in "Health + damage".
- Richer behaviour: `aimodule_toolset.toolsets.behavior_tree.BehaviorTreeTools` builds Behavior
  Trees. Describe it before use.

## Checkpoint / goal

- Trigger box actor. On player overlap, store its transform on the GameMode; for a goal, show the
  win widget with the time taken.

## Level dressing

- Place prototyping meshes with `SCENE.add_to_scene_from_asset` from `/Game/LevelPrototyping/Meshes/*`.
- Colour: create a Material Instance of the template's prototyping material, set its colour
  parameter, and assign it to the mesh component's material slot.
- Template levels already have lighting. For mood, edit the DirectionalLight and SkyLight
  COMPONENTS (get_components first), never the actor itself.

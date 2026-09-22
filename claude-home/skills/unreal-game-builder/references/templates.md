# Templates (UE 5.8, Blueprint)

`unreal_new_project` copies the engine template AND the shared content packs it depends on
(characters, input actions, prototyping meshes). Without those packs the template's own
Blueprints fail to compile and Play-In-Editor stops on a modal dialog — the bridge handles it.

| template | start level | you already get | good for |
|---|---|---|---|
| FirstPerson | `/Game/FirstPerson/Lvl_FirstPerson` | `BP_FirstPersonCharacter` (move, look, jump, first-person arms), `BP_FirstPersonPlayerController`, `BP_FirstPersonGameMode`, Enhanced Input actions in `/Game/Input/Actions`, orange prototyping blocks, jump pads, doors and targets in `/Game/LevelPrototyping/Interactable` | shooters, puzzle rooms, horror, parkour |
| ThirdPerson | `/Game/ThirdPerson/Lvl_ThirdPerson` | third-person Manny/Quinn character with follow camera, Enhanced Input, prototyping level | platformers, action/adventure, collectathons |
| TopDown | `/Game/TopDown/Lvl_TopDown` | click-to-move character, cursor pack, top-down camera | twin-stick, strategy-lite, dungeon crawlers |
| Vehicle | `/Game/VehicleTemplate/Maps/Lvl_VehicleBasic` | Chaos drivable car, track, Enhanced Input | racing, driving challenges |
| Blank | `/Engine/Maps/Templates/OpenWorld` | nothing | only when no template fits |

## Variants (`unreal_new_project {..., variant}`)

| template + variant | start level | adds |
|---|---|---|
| FirstPerson + `ArenaShooter` | `/Game/Variant_Shooter/Lvl_ArenaShooter` | `/Game/Variant_Shooter`: `BP_ShooterCharacter` (first-person arms holding weapons, fire/reload montages, recoil), `BP_ShooterGameMode`, `BP_ShooterPlayerController`, weapons (`BP_ShooterWeapon_*`: rifle, pistol, grenade launcher), projectiles, pickups, bullet-counter HUD (`UI_Shooter`). `/Game/Weapons`: textured SK/SM rifle, pistol, grenade launcher, fire sound. Its StateTree enemy AI is deliberately left out (it cannot be packaged here) — build enemies yourself. |
| FirstPerson + `SurvivalHorror` | `/Game/Variant_Horror/Lvl_Horror` | sprint, torch, dark map, horror HUD |

Useful level-prototyping assets (FirstPerson/ThirdPerson): `/Game/LevelPrototyping/Meshes/*`
(cubes, ramps, cylinders), `/Game/LevelPrototyping/Interactable/Target`, `/JumpPad`, `/Door`.
Find exact asset paths with `AssetTools.find_assets {folder_path:"/Game/LevelPrototyping", name:"", asset_type:null, recursive:true, tags:null}`.

Player pawn class paths (Blueprint class = asset path + `_C`), e.g.
`/Game/FirstPerson/Blueprints/BP_FirstPersonCharacter.BP_FirstPersonCharacter_C`.

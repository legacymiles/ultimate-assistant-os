# Realism — making a game look real, not grey-box

A template level is orange-and-white prototype blocks. Left like that, every game scores ~2/10
on looks no matter how good the Blueprints are. Whenever the prompt asks for "realistic",
"real", "like Call of Duty / Battlefield / Resident Evil", "gritty", "AAA", or names any real
game as the look, do ALL of this. For stylised prompts do the lighting part and skip the rest.

## 1. Start from the richest template variant

| prompt | template + variant | what the variant adds |
|---|---|---|
| any shooter (FPS, zombies, war, arena) | `FirstPerson` + `variant:"ArenaShooter"` | textured rifle / pistol / grenade launcher, first-person arms with fire + reload animations, muzzle/recoil, weapon sounds, bullet-counter HUD, pickups — start map `/Game/Variant_Shooter/Lvl_ArenaShooter` |
| horror, exploration, "scary" non-shooter | `FirstPerson` + `variant:"SurvivalHorror"` | sprint, torch, a dark atmospheric map |

`unreal_new_project {name, template:"FirstPerson", variant:"ArenaShooter", id}`.

Verified facts about the ArenaShooter start (2026-09-18 game shot):
- **The player spawns unarmed** — weapons are pickups. For a CoD-style game give the rifle at
  spawn (on BeginPlay spawn the `BP_ShooterWeapon_*` rifle and hand it to the character the way the
  pickup does — read `BP_ShooterPickup`'s graph for the exact call) so the first frame shows a gun.
- **Unpackaged `unreal_game_shot` images show an on-screen sky warning** ("YOUR SCENE CONTAINS A
  SKYDOME MESH…"); the packaged exe does not (verified). Ignore it in critique, or check with
  `unreal_game_shot {packaged:true}` after packaging. If the look calls for night, replace the sky
  anyway (SkyAtmosphere + SkyLight + dark fog) — the stock sky is bright daytime.
- The HUD already has a health bar and a two-team score (0 | 0); relabel or replace the score for
  waves/kills.
- Two harmless load errors come from Epic's own template (a door-frame mesh and the wobble target's
  material); delete those actors rather than chasing the assets.
- "Preparing Shaders/Textures" text in a game shot only means first run — shoot again.

**The variant's enemy AI is not in the project** (`Variant_Shooter/Blueprints/AI`, `BP_ShooterNPC`,
`BP_ShooterNPCSpawner`, the StateTree assets and the level's spawner actors are left out on
purpose). It runs on the GameplayStateTree runtime plugin, which this PC strips when packaging (no
.NET Framework SDK), and its StateTrees then fail the cook ("does not have a schema"). Never add
StateTree or Behavior-Tree-asset AI. Make enemies as a plain `Character` Blueprint with `AI MoveTo`
(see "Enemies" below).

## 2. Real assets from Poly Haven (CC0, no key)

`unreal_find_assets {type:"models"|"textures", query}` → ids. Then ONE
`unreal_add_assets {id, models:[...], surfaces:[...]}` with everything the level needs (it closes
the editor to import; reopen with `unreal_open_project`). Do this right after `unreal_new_project`,
BEFORE the first `unreal_open_project`, so no reopen is needed.

Results land in `/Game/PolyHaven`:
- model → `/Game/PolyHaven/Models/<id>/.../StaticMeshes/<mesh>` with its own PBR materials and
  collision against the visible triangles (players and line traces hit what they see).
- surface → `/Game/PolyHaven/Surfaces/<id>/MI_<id>`, a material instance of
  `/Game/PolyHaven/Materials/M_PH_Surface`. Parameters: `Tiling` (UV repeats — set it so one repeat
  is ~2-4 m of world: a 40 m floor plane wants Tiling ≈ 12), `Tint` (multiply colour; darken to
  ~0.6 for grime/night).

Proven picks by setting (verify ids with unreal_find_assets; the catalogue changes):

| setting | models | surfaces |
|---|---|---|
| ruined / night city, zombies, war | `modular_urban_apartments_facade`, `modular_factory_facade`, `concrete_road_barrier`, `concrete_road_barrier_02`, `covered_car`, `Barrel_01`, `barrel_03`, `barrel_stove`, `metal_trash_can`, `street_lamp_01`, `street_lamp_02`, `modular_fire_escape`, `fire_hydrant`, `utility_box_01`, `old_tyre`, `modular_chainlink_fence`, `rollershutter_door`, `modular_electricity_poles`, `cardboard_box_01`, `water_manhole_cover` | `road_damaged`, `asphalt_02`, `worn_asphalt`, a dirty `brick` and a `concrete`/`plaster` wall set (search `brick dirty`, `concrete wall`) |
| industrial / warehouse | `industrial_storage_cart`, `steel_frame_shelves_01`, `portable_generator`, `propane_tank`, `modular_industrial_pipes_01`, `mounted_fluorescent_lights`, `plastic_crate_03`, `ladder_sectioned_01` | `concrete_floor` sets, `metal` plates, `rusty` metal |
| nature / forest | search `tree`, `rock`, `dry_branches`, `stump` | `forest_ground`, `forrest_leaves`, `rocky_trail` style sets |

Budget: 10-25 models + 3-5 surfaces at the defaults (models 1k, surfaces 2k). More costs import
time and GPU memory on this 6 GB laptop GPU.

## 3. Replace the grey box

- Delete or hide every `/Game/LevelPrototyping` block the design does not need (find them with
  `SCENE.find_actors`; the template floor can stay but gets a real material).
- Every remaining prototype mesh gets a Poly Haven `MI_` material (`OBJ.set_properties` on the
  StaticMeshComponent's `OverrideMaterials`, or the MaterialInstance tools). No orange, no grid
  texture, no `WorldGridMaterial` anywhere a player can see.
- Build the play space from Poly Haven meshes: facades as walls around the arena, barriers and
  cars as cover, props clustered (3-5 together) rather than evenly spaced, some rotated/tilted to
  look abandoned. Imported meshes are real-world scale; a facade is several storeys tall.

## 4. Lighting and camera look (does the most for "real")

Set these on the level's existing actors where present, add them where not:

- **DirectionalLight** (moon/sun): night = intensity 0.5-2 lux, colour cool blue-white, low angle;
  day = 6-10 lux warm. Cast shadows on.
- **SkyLight**: real-time capture on, intensity 0.3-1.0 at night.
- **ExponentialHeightFog**: density 0.02-0.05, `bEnableVolumetricFog` on, dark blue-grey inscatter
  at night. Volumetric fog + point lights = visible light shafts through smoke.
- **Point/Spot lights** for fires, lamps, car headlights: warm 2000-3000 K fire colour,
  `VolumetricScatteringIntensity` 2-4, attenuation 800-1500. Each streetlamp model gets a light.
- **PostProcessVolume** with `bUnbound` on: exposure min=max (fixed, no eye adaptation pumping),
  bloom 0.6-1.0, vignette 0.4-0.6, film grain 0.2-0.4, slight chromatic aberration 0.2, colour
  grading toward desaturated teal shadows / warm highlights (saturation 0.8, contrast 1.1).
- Lumen global illumination and reflections are the project default — leave them on.

## 5. Enemies (zombies, soldiers, monsters)

A `Character` Blueprint whose `Mesh` is the mannequin from the Characters pack
(`/Game/Characters/Mannequins/Meshes/SKM_Quinn` for female, `SKM_Manny` for male — find exact
paths with `ASSET.find_assets {folder_path:"/Game/Characters", name:"SKM_", ...}`) with the pack's
unarmed Anim Blueprint (`ASSET.find_assets name:"ABP_"`), so it walks and runs with real
animation driven by its velocity. Never ship a bare capsule.
- Zombie look: a dark, desaturated material instance (skin tint ~0.25-0.35 grey-green, roughness
  high), slower `MaxWalkSpeed` (200-350) for shamblers or 500+ for runners, and mix Quinn and Manny.
- Chase with `AI MoveTo` toward the player (NavMeshBoundsVolume covering the arena), melee damage
  on overlap with a cooldown, `ApplyDamage` / health, ragdoll or fall-over on death
  (`SetSimulatePhysics` on the mesh) and destroy after a few seconds.
- They must react to the variant's weapons: the weapon's projectile/line trace applies damage —
  implement `AnyDamage` / `PointDamage` events on the enemy.

## 6. HUD and polish

- Keep the variant's bullet-counter HUD. Add health and wave in the same style (UMG), anchored to
  screen corners, never `PrintString` for anything the player should read.
- Remove any leftover placeholder text ("Text Block") and debug prints before packaging.
- Hit feedback: camera shake on firing and on taking damage, a red screen-edge flash when hurt.

## 7. Judge it the way a player sees it

Only `unreal_game_shot` shows the real game (weapon in hand, HUD, post-process). `unreal_screenshot`
is an editor view with light-bulb icons and no weapon — use it only for wide level overviews. Save
assets before every game shot. Take at least: spawn view at ~8 s, combat at ~25-40 s (enemies
close), and one more angle. These are the images the gauntlet critics score.

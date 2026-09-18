// The engine's Blueprint-only game templates. Each needs no C++ compiler, so a
// fresh project opens straight into the editor.
//
// `map` is the level the template starts in (from its DefaultEngine.ini). The
// skill builds the game into this level unless the design calls for a new one.

export const TEMPLATES = {
  FirstPerson: {
    folder: "TP_FirstPersonBP",
    map: "/Game/FirstPerson/Lvl_FirstPerson",
    blurb: "First-person character with a camera, movement, jump and look already wired.",
    // Blueprint content packs the new-project wizard offers as "Variants".
    // `wizardName` is the name in the template's TemplateDefs.ini.
    variants: {
      ArenaShooter: {
        wizardName: "ArenaShooter",
        map: "/Game/Variant_Shooter/Lvl_ArenaShooter",
        // Its enemy AI runs on StateTree (GameplayStateTree runtime plugin), which
        // content-only packaging on this PC must strip — the cook then fails with
        // "state tree does not have a schema". Leave the AI out, plus the level's
        // NPC spawner actors that point into it. Enemies are built as plain
        // Blueprints instead (skill: references/realism.md).
        exclude: { Variant_Shooter: ["Blueprints/AI"] },
        blurb:
          "Adds Epic's shooter kit: textured rifle/pistol/grenade launcher, first-person arms with fire and reload animations, weapon sounds, recoil, bullet-counter HUD, pickups.",
      },
      SurvivalHorror: {
        wizardName: "SurvivalHorror",
        map: "/Game/Variant_Horror/Lvl_Horror",
        blurb: "Adds a sprint mechanic, a torch and a dark, atmospheric map.",
      },
    },
  },
  ThirdPerson: {
    folder: "TP_ThirdPersonBP",
    map: "/Game/ThirdPerson/Lvl_ThirdPerson",
    blurb: "Third-person character with a follow camera, movement and jump.",
  },
  TopDown: {
    folder: "TP_TopDownBP",
    map: "/Game/TopDown/Lvl_TopDown",
    blurb: "Top-down camera with click-to-move character.",
  },
  Vehicle: {
    folder: "TP_VehicleAdvBP",
    map: "/Game/VehicleTemplate/Maps/Lvl_VehicleBasic",
    blurb: "Drivable Chaos vehicle on a test track.",
  },
  Blank: {
    folder: "TP_BlankBP",
    map: "/Engine/Maps/Templates/OpenWorld",
    blurb: "Empty project; everything is built from scratch.",
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);

export function templateFor(id) {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`Unknown template "${id}". Use one of: ${TEMPLATE_IDS.join(", ")}`);
  return t;
}

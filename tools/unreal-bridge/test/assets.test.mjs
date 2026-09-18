import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRes } from "../lib/assets.mjs";
import { parseVariants, withStartupMap } from "../lib/project.mjs";

test("pickRes prefers the asked size, then smaller, then anything", () => {
  assert.equal(pickRes({ "1k": 1, "2k": 2 }, "2k"), 2);
  assert.equal(pickRes({ "1k": 1, "4k": 4 }, "2k"), 1);
  assert.equal(pickRes({ "4k": 4 }, "1k"), 4);
  assert.equal(pickRes(undefined, "1k"), null);
});

test("parseVariants reads each variant's extra packs", () => {
  const ini = [
    'SharedContentPacks=(MountName="Input",DetailLevels=("High"))',
    'Variants=(Name="ArenaShooter",LocalizedDisplayNames=((Language="en",Text="Arena Shooter")),SharedContentPacks=((DetailLevels=(Standard),MountName="Weapons"),(DetailLevels=(Standard),MountName="Variant_Shooter")) )',
    'Variants=(Name="SurvivalHorror",SharedContentPacks=((DetailLevels=(Standard),MountName="Variant_Horror")) )',
  ].join("\n");
  const v = parseVariants(ini);
  assert.deepEqual(v.map((x) => x.name), ["ArenaShooter", "SurvivalHorror"]);
  assert.deepEqual(v[0].packs.map((p) => p.mount), ["Weapons", "Variant_Shooter"]);
  assert.deepEqual(v[0].packs[0].levels, ["Standard"]);
});

test("withStartupMap rewrites both map keys", () => {
  const ini = "[/Script/EngineSettings.GameMapsSettings]\nEditorStartupMap=/Game/A/L.L\nGameDefaultMap=/Game/A/L.L\nServerDefaultMap=/Engine/Maps/Entry\n";
  const out = withStartupMap(ini, "/Game/Variant_Shooter/Lvl_ArenaShooter");
  assert.match(out, /EditorStartupMap=\/Game\/Variant_Shooter\/Lvl_ArenaShooter\.Lvl_ArenaShooter/);
  assert.match(out, /GameDefaultMap=\/Game\/Variant_Shooter\/Lvl_ArenaShooter\.Lvl_ArenaShooter/);
  assert.match(out, /ServerDefaultMap=\/Engine\/Maps\/Entry/);
});

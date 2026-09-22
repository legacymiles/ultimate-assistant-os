"""Post-crash fix: give PhoenixGameMode a real PGD so InitGame stops null-derefing."""
import json, sys
sys.path.insert(0, "src")
from unreal_mcp.editor_client import EditorClient

SNIPPET = r'''
import unreal, json
result = {"testgm": {}, "gm_props": [], "set": {}, "world": None}

# 1. does the devkit ship a TestGameMode to parent from?
for p in ("/Game/PrimalEarth/CoreBlueprints/TestGameMode_C",
          "/Game/PrimalEarth/CoreBlueprints/TestGameMode",
          "/Game/Mods/GenericMod/TestGameMode"):
    result["testgm"][p] = bool(unreal.EditorAssetLibrary.does_asset_exist(p))

# 2. find the PGD/game-data property on our GameMode
gm_bp = unreal.EditorAssetLibrary.load_asset("/PhoenixPods/PhoenixGameMode")
gm_cls = gm_bp.generated_class()
cdo = unreal.get_default_object(gm_cls)
result["gm_props"] = [p for p in dir(cdo) if "game_data" in p.lower() or "singleton" in p.lower()][:10]

# 3. plug our PGD into whatever game-data slot exists
pgd_cls = unreal.EditorAssetLibrary.load_asset("/PhoenixPods/PrimalGameData_BP_PhoenixPods").generated_class()
for prop in result["gm_props"]:
    if "game_data" in prop and "override" in prop or prop in ("game_data_class", "default_game_data", "game_data"):
        try:
            cdo.set_editor_property(prop, pgd_cls)
            result["set"][prop] = True
        except Exception as e:
            result["set"][prop] = "ERR " + str(e)[:100]
unreal.EditorAssetLibrary.save_asset("/PhoenixPods/PhoenixGameMode")
print("UMCP_RESULT:" + json.dumps(result))
'''
client = EditorClient(discover_timeout=15.0)
data = client.run_snippet(SNIPPET)
print(json.dumps(data, indent=2))
client.close()

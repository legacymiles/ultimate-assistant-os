"""Differential: point map override at VANILLA TestGameMode (none of our BPs)."""
import json, sys
sys.path.insert(0, "src")
from unreal_mcp.editor_client import EditorClient

SNIPPET = r'''
import unreal, json
result = {"override_set": None, "map": None}
test_cls = unreal.EditorAssetLibrary.load_asset("/Game/PrimalEarth/CoreBlueprints/TestGameMode").generated_class()
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
result["map"] = str(world.get_name())
ws = world.get_world_settings() if hasattr(world, "get_world_settings") else None
if ws is None:
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    ws = next((a for a in actors if isinstance(a, unreal.WorldSettings)), None)
if ws:
    ws.set_editor_property("default_game_mode", test_cls)
    result["override_set"] = "vanilla TestGameMode on " + result["map"]
print("UMCP_RESULT:" + json.dumps(result))
'''
client = EditorClient(discover_timeout=15.0)
data = client.run_snippet(SNIPPET)
print(json.dumps(data, indent=2))
client.close()

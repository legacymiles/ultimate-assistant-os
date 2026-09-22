"""Drive 3: verify /PhoenixPods mount, then create the child blueprints inside it."""
import json, sys
sys.path.insert(0, "src")
from unreal_mcp.editor_client import EditorClient

SNIPPET = r'''
import unreal, json
result = {"mounted": False, "created": {}, "saved": {}}
result["mounted"] = bool(unreal.EditorAssetLibrary.does_directory_exist("/PhoenixPods"))
if result["mounted"]:
    at = unreal.AssetToolsHelpers.get_asset_tools()
    targets = [
        ("PrimalItem_PhoenixPod", "/Game/Extinction/CoreBlueprints/Weapons/PrimalItem_WeaponEmptyCryopod"),
        ("WeapPhoenixPod", "/Game/Extinction/CoreBlueprints/Weapons/WeapEmptyCryopod"),
    ]
    for new_name, parent_path in targets:
        dest = "/PhoenixPods/" + new_name
        if unreal.EditorAssetLibrary.does_asset_exist(dest):
            result["created"][new_name] = "already exists"
            continue
        parent_bp = unreal.EditorAssetLibrary.load_asset(parent_path)
        parent_cls = parent_bp.generated_class()
        factory = unreal.BlueprintFactory()
        factory.set_editor_property("parent_class", parent_cls)
        bp = at.create_asset(new_name, "/PhoenixPods", None, factory)
        result["created"][new_name] = bool(bp)
        if bp:
            result["saved"][new_name] = bool(unreal.EditorAssetLibrary.save_asset(dest))
print("UMCP_RESULT:" + json.dumps(result))
'''
client = EditorClient(discover_timeout=15.0)
data = client.run_snippet(SNIPPET)
print(json.dumps(data, indent=2))
client.close()

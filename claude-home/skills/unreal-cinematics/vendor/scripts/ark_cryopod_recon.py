"""First real cargo over the ARK DevKit bridge: cryopod reconnaissance.

Locates the vanilla cryopod assets and reports what exists where, as the
target list for the ArkMCP layer (pod-with-dino minting feature).

Run:  .venv/Scripts/python.exe scripts/ark_cryopod_recon.py
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, "src")

from unreal_mcp.editor_client import EditorClient  # noqa: E402

SNIPPET = r'''
import unreal, json

result = {"exists": {}, "listing": {}}

# Known ASE-era paths (ASA largely kept naming); verify what survives in ASA.
candidates = [
    "/Game/Extinction/CoreBlueprints/Weapons/PrimalItem_WeaponEmptyCryopod",
    "/Game/Extinction/CoreBlueprints/Weapons/WeapEmptyCryopod",
    "/Game/Extinction/CoreBlueprints/Weapons/StorageBox_Cryofridge",
    "/Game/Extinction/Structures/Cryofridge/Cryofridge",
]
for p in candidates:
    result["exists"][p] = bool(unreal.EditorAssetLibrary.does_asset_exist(p))

# Directory sweeps: list what actually lives in the likely folders.
for d in [
    "/Game/Extinction/CoreBlueprints/Weapons",
    "/Game/Extinction/CoreBlueprints/Items",
]:
    try:
        assets = unreal.EditorAssetLibrary.list_assets(d, recursive=False, include_folder=False)
        hits = [a.split(".")[0] for a in assets if "cryo" in a.lower()]
        result["listing"][d] = hits[:25]
    except Exception as e:
        result["listing"][d] = f"ERROR: {e}"

print("UMCP_RESULT:" + json.dumps(result))
'''


def main() -> int:
    client = EditorClient(discover_timeout=15.0)
    print("[recon] connecting + running cryopod sweep...")
    data = client.run_snippet(SNIPPET)
    print(json.dumps(data, indent=2))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

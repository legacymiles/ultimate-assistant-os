"""Overnight P2: clear GM override, save, headless PIE boot test."""
import json, sys, time
sys.path.insert(0, "src")
from unreal_mcp.editor_client import EditorClient

CLEAR = r'''
import unreal, json
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
ws = world.get_world_settings() if hasattr(world, "get_world_settings") else None
if ws is None:
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    ws = next((a for a in actors if isinstance(a, unreal.WorldSettings)), None)
cleared = False
if ws:
    ws.set_editor_property("default_game_mode", None)
    cleared = True
saved = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
print("UMCP_RESULT:" + json.dumps({"cleared": cleared, "saved": bool(saved)}))
'''

START_PIE = r'''
import unreal, json
unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()
print("UMCP_RESULT:" + json.dumps({"pie_requested": True}))
'''

CHECK_PIE = r'''
import unreal, json
gw = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()
alive = gw is not None
name = str(gw.get_name()) if alive else None
print("UMCP_RESULT:" + json.dumps({"game_world": alive, "name": name}))
'''

END_PIE = r'''
import unreal, json
unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_end_play()
print("UMCP_RESULT:" + json.dumps({"ended": True}))
'''

def main():
    c = EditorClient(discover_timeout=15.0)
    print("[P2] clearing override + saving level...")
    print(json.dumps(c.run_snippet(CLEAR)))
    print("[P2] requesting PIE...")
    print(json.dumps(c.run_snippet(START_PIE)))
    c.close()
    print("[P2] waiting 60s for PIE spin-up (or crash)...")
    time.sleep(60)
    c2 = EditorClient(discover_timeout=20.0)
    r = c2.run_snippet(CHECK_PIE)
    print("[P2] PIE state:", json.dumps(r))
    if r.get("game_world"):
        print("[P2] *** PIE BOOTED WITHOUT CRASH *** ending play...")
        print(json.dumps(c2.run_snippet(END_PIE)))
    c2.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

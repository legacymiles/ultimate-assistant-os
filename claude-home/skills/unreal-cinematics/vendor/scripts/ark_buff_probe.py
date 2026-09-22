"""Shot 2: does PrimalBuff carry the exec-command event family? (production handler home)"""
import json, sys
sys.path.insert(0, "src")
from unreal_mcp.editor_client import EditorClient

SNIPPET = r'''
import unreal, json
result = {}
for clsname in ("PrimalBuff", "PrimalBuffPersistentData", "PrimalCharacter", "ShooterCharacter", "PrimalStructure"):
    cls = getattr(unreal, clsname, None)
    if cls is None:
        result[clsname] = "MISSING"
        continue
    hits = [m for m in dir(cls) if "exec_command" in m.lower() or "console_command" in m.lower() or ("command" in m.lower() and "rerun" not in m.lower())]
    result[clsname] = hits[:12] if hits else "none"
print("UMCP_RESULT:" + json.dumps(result))
'''
client = EditorClient(discover_timeout=15.0)
data = client.run_snippet(SNIPPET)
print(json.dumps(data, indent=2))
client.close()

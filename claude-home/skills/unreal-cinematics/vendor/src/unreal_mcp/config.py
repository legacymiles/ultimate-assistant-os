"""Connection + project configuration. Env-overridable so .mcp.json can point us at a project."""

import glob
import json
import os
import re

# --- UE Python Remote Execution endpoints ---
# These MUST match the editor's Project Settings > Plugins > Python and the vendored
# remote_execution.py defaults. Multicast is how we *discover* a running editor; the TCP
# command port is the actual channel we send Python snippets over.
MULTICAST_GROUP_ENDPOINT = ("239.0.0.1", 6766)
# 127.0.0.1 matches vanilla UE editors (Epic default). The ASA Dev Kit ships
# MulticastBindAddress=0.0.0.0 — override with UNREAL_MCP_MULTICAST_BIND=0.0.0.0
# so both sides join the group on the same interface (mismatched joins = mutual deafness).
MULTICAST_BIND_ADDRESS = os.environ.get("UNREAL_MCP_MULTICAST_BIND", "127.0.0.1")
COMMAND_ENDPOINT_PORT = 6776

# --- Project under control (the editor we attach to) ---
UNREAL_PROJECT_DIR = os.environ.get("UNREAL_PROJECT_DIR", r"C:\Projects\PrimalErrorsUnreal")

# --- Snippet result protocol ---
# Every snippet we send into the editor prints exactly one line of the form
# "UMCP_RESULT:<json>". The bridge fishes that line out of the editor's captured stdout
# (Remote Execution only hands us text, so a sentinel + JSON is how we get structure back).
RESULT_SENTINEL = "UMCP_RESULT:"


# --------------------------------------------------------------------------- #
# Editor launch (used by the restart_editor supervisor)
# --------------------------------------------------------------------------- #
# The .uproject is found from UNREAL_PROJECT_DIR unless given explicitly, and the editor
# binary is DERIVED FROM THE PROJECT'S OWN EngineAssociation rather than hardcoded.
#
# WHY (2026-07-26): the editor path was pinned to UE_5.7. Driving a 5.8 project,
# restart_editor cleanly quit the editor and then died with
# "[WinError 2] The system cannot find the file specified" — leaving the editor CLOSED
# with no way to bring it back through the MCP. Worst possible failure shape: the
# destructive half succeeded and the recovery half didn't. A supervisor that can kill but
# not revive is a footgun, so resolution is now automatic and validated before we quit.

EPIC_ROOT = os.environ.get("EPIC_ENGINE_ROOT", r"C:\Program Files\Epic Games")


def _uproject_from_dir(project_dir: str) -> str:
    """First .uproject in project_dir, or the conventional <dirname>.uproject path."""
    hits = sorted(glob.glob(os.path.join(project_dir, "*.uproject")))
    if hits:
        return hits[0]
    return os.path.join(project_dir, f"{os.path.basename(project_dir.rstrip(os.sep))}.uproject")


def _engine_association(uproject: str) -> str | None:
    """Read EngineAssociation out of a .uproject (UTF-8 or UTF-16 — UE rewrites as UTF-16)."""
    for enc in ("utf-8-sig", "utf-16", "utf-8"):
        try:
            with open(uproject, "r", encoding=enc) as fh:
                v = json.load(fh).get("EngineAssociation") or ""
            v = v.strip()
            # Source builds use a GUID association; only version strings map to a UE_x.y dir.
            return v if re.fullmatch(r"\d+\.\d+", v) else None
        except (UnicodeError, json.JSONDecodeError):
            continue
        except OSError:
            return None
    return None


def _editor_exe_for(version: str | None) -> str | None:
    """Path to UnrealEditor.exe for a version, else the newest installed engine."""
    def exe(root: str) -> str:
        return os.path.join(root, "Engine", "Binaries", "Win64", "UnrealEditor.exe")

    if version:
        candidate = exe(os.path.join(EPIC_ROOT, f"UE_{version}"))
        if os.path.isfile(candidate):
            return candidate

    # Fall back to the newest UE_x.y that actually has an editor binary.
    installs = []
    for path in glob.glob(os.path.join(EPIC_ROOT, "UE_*")):
        m = re.search(r"UE_(\d+)\.(\d+)", os.path.basename(path))
        if m and os.path.isfile(exe(path)):
            installs.append(((int(m.group(1)), int(m.group(2))), exe(path)))
    return max(installs)[1] if installs else None


UNREAL_UPROJECT = os.environ.get("UNREAL_UPROJECT") or _uproject_from_dir(UNREAL_PROJECT_DIR)

UNREAL_EDITOR_EXE = (
    os.environ.get("UNREAL_EDITOR_EXE")
    or _editor_exe_for(_engine_association(UNREAL_UPROJECT))
    or ""
)


def describe_launch_config() -> dict:
    """What restart_editor will actually do — surfaced so failures are diagnosable."""
    return {
        "project_dir": UNREAL_PROJECT_DIR,
        "uproject": UNREAL_UPROJECT,
        "uproject_exists": os.path.isfile(UNREAL_UPROJECT),
        "engine_association": _engine_association(UNREAL_UPROJECT),
        "editor_exe": UNREAL_EDITOR_EXE,
        "editor_exe_exists": bool(UNREAL_EDITOR_EXE) and os.path.isfile(UNREAL_EDITOR_EXE),
    }

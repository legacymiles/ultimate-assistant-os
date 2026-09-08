"""Running ComfyUI in-process and talking to it over HTTP.

ComfyUI is the practical way to run H3 on a single GPU: the H3 nodes are
native from 0.30 on, the quantised weights are packaged for it, and the turbo
LoRAs only exist in that format. So the worker boots ComfyUI once per cold
start and then drives it over its local HTTP API.

The part worth reading is `describe_node`. Node input names are not a stable
public contract, and a workflow built against a guessed socket name fails at
render time — after the GPU minutes are already spent. So the worker asks
ComfyUI what the nodes actually take, and the workflow builder adapts. When
something genuinely does not line up, the error names the real sockets rather
than saying "invalid prompt".
"""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

COMFY_HOST = os.environ.get("COMFY_HOST", "127.0.0.1")
COMFY_PORT = int(os.environ.get("COMFY_PORT", "8188"))
COMFY_DIR = Path(os.environ.get("COMFY_DIR", "/opt/ComfyUI"))
BASE = f"http://{COMFY_HOST}:{COMFY_PORT}"

CLIENT_ID = str(uuid.uuid4())


class ComfyError(RuntimeError):
    pass


# ----- process --------------------------------------------------------------

_process: subprocess.Popen | None = None


def start(extra_model_paths: str | None = None) -> None:
    """Boot ComfyUI if it is not already up. Safe to call repeatedly."""
    global _process
    if is_up():
        return
    if _process and _process.poll() is None:
        return

    if extra_model_paths:
        cfg = COMFY_DIR / "extra_model_paths.yaml"
        cfg.write_text(extra_model_paths, encoding="utf-8")

    cmd = [
        "python",
        "-u",
        str(COMFY_DIR / "main.py"),
        "--listen",
        COMFY_HOST,
        "--port",
        str(COMFY_PORT),
        "--disable-auto-launch",
        "--disable-metadata",
    ]
    if os.environ.get("COMFY_EXTRA_ARGS"):
        cmd += os.environ["COMFY_EXTRA_ARGS"].split()

    _process = subprocess.Popen(cmd, cwd=str(COMFY_DIR))


def is_up() -> bool:
    try:
        _get("/system_stats", timeout=2)
        return True
    except Exception:
        return False


def wait_until_ready(timeout_s: int = 900, on_progress=None) -> None:
    """Block until ComfyUI answers, or give up with a useful message.

    Generous by default: the first boot on a fresh worker loads tens of
    gigabytes off a network volume, and that is normal rather than a hang.
    """
    started = time.time()
    last_note = 0.0
    while time.time() - started < timeout_s:
        if is_up():
            return
        if _process and _process.poll() is not None:
            raise ComfyError(f"ComfyUI exited during startup with code {_process.returncode}")
        now = time.time()
        if on_progress and now - last_note > 20:
            last_note = now
            on_progress(f"Loading model — {int(now - started)}s")
        time.sleep(2)
    raise ComfyError(f"ComfyUI did not become ready within {timeout_s}s")


# ----- HTTP -----------------------------------------------------------------


def _get(path: str, timeout: int = 30) -> bytes:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=timeout) as r:
        return r.read()


def _get_json(path: str, timeout: int = 30) -> Any:
    return json.loads(_get(path, timeout).decode("utf-8"))


def _post_json(path: str, payload: dict, timeout: int = 60) -> Any:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}{path}", data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:2000]
        raise ComfyError(f"ComfyUI {e.code} on {path}: {detail}") from e


# ----- introspection --------------------------------------------------------

_object_info: dict[str, Any] | None = None


def object_info(refresh: bool = False) -> dict[str, Any]:
    global _object_info
    if _object_info is None or refresh:
        _object_info = _get_json("/object_info", timeout=120)
    return _object_info


def describe_node(class_type: str) -> dict[str, Any]:
    """Required and optional input sockets for one node class.

    Raises with the nearest available names when the class is missing, which
    is the common symptom of a ComfyUI too old for H3.
    """
    info = object_info()
    if class_type not in info:
        near = [k for k in info if "minimax" in k.lower() or "hailuo" in k.lower() or "h3" in k.lower()]
        raise ComfyError(
            f"ComfyUI has no node '{class_type}'. "
            f"MiniMax-ish nodes present: {sorted(near) or 'none'}. "
            "H3 needs ComfyUI 0.30.0 or newer with LOCAL weight support. "
            "Note that the 'MinimaxHailuo03*' nodes are cloud API nodes that call "
            "Comfy.org and bill separately — they are not what this worker uses."
        )
    node = info[class_type]
    spec = node.get("input", {}) or {}
    return {
        "required": spec.get("required", {}) or {},
        "optional": spec.get("optional", {}) or {},
    }


def input_names(class_type: str) -> list[str]:
    d = describe_node(class_type)
    return list(d["required"].keys()) + list(d["optional"].keys())


def enum_options(class_type: str, socket: str) -> list[str]:
    """The allowed values of a dropdown socket, e.g. CLIPLoader's `type`.

    ComfyUI has described combo widgets three different ways across versions,
    and a worker that understands only one of them fails at render time on a
    node as ordinary as KSamplerSelect. All three are handled:

        [["euler", "heun"], {...}]                 classic V1
        ["COMBO", {"options": ["euler", ...]}]      newer typed form
        {"type": "COMBO", "options": [...]}         dict form

    Returns [] when the socket is not a combo at all.
    """
    d = describe_node(class_type)
    spec = d["required"].get(socket)
    if spec is None:
        spec = d["optional"].get(socket)
    return _options_from(spec)


def _names(options: Any) -> list[str]:
    """Option names, whether they are plain values or dynamic-combo objects.

    A COMFY_DYNAMICCOMBO_V3 lists its choices as objects carrying a `key`
    plus the extra inputs that choice unlocks, e.g.
    {"key": "mp4", "inputs": {...}}. Reading only plain strings makes such a
    socket look like it has no options at all, which is how a required
    argument silently went unset and killed a render at the last node.
    """
    if not isinstance(options, list):
        return []
    out = []
    for o in options:
        if isinstance(o, dict):
            key = o.get("key", o.get("value", o.get("name")))
            if key is not None:
                out.append(str(key))
        else:
            out.append(str(o))
    return out


def _options_from(spec: Any) -> list[str]:
    if spec is None:
        return []
    # {"type": "COMBO", "options": [...]}
    if isinstance(spec, dict):
        return _names(spec.get("options") or spec.get("choices"))
    if isinstance(spec, list) and spec:
        head = spec[0]
        # [["euler", ...], {...}]
        if isinstance(head, list):
            return _names(head)
        # ["COMBO" | "COMFY_DYNAMICCOMBO_V3", {"options": [...]}]
        if len(spec) > 1 and isinstance(spec[1], dict):
            found = _names(spec[1].get("options") or spec[1].get("choices"))
            if found:
                return found
        # ["euler", "heun", ...] — already a bare list of choices
        if all(isinstance(x, str) for x in spec) and len(spec) > 1:
            return [str(x) for x in spec]
    return []


def autogrow_item(class_type: str, socket: str) -> str | None:
    """The per-item input name behind a growable socket.

    ComfyUI models a variable-length input as COMFY_AUTOGROW_V3 carrying a
    template of the single item it repeats. `/object_info` therefore reports
    only the container ("ref_images"), while a workflow addresses each slot
    as "ref_images.ref_image_0". This digs the item name out of the template
    so those keys can be built rather than guessed.
    """
    d = describe_node(class_type)
    spec = d["required"].get(socket)
    if spec is None:
        spec = d["optional"].get(socket)
    meta = spec[1] if isinstance(spec, list) and len(spec) > 1 and isinstance(spec[1], dict) else None
    if not isinstance(meta, dict):
        return None
    template = ((meta.get("template") or {}).get("input") or {}).get("required") or {}
    names = list(template.keys())
    return names[0] if names else None


def raw_input_spec(class_type: str) -> dict[str, Any]:
    """The untouched `input` block for a node, for diagnostics."""
    info = object_info()
    return (info.get(class_type) or {}).get("input", {}) or {}


def pick_enum(class_type: str, socket: str, prefer: list[str], fallback: str | None = None) -> str:
    """Choose a dropdown value, preferring the first listed option that exists.

    This is how the worker survives a renamed enum: it asks for the real
    options and matches loosely rather than hardcoding one string.
    """
    options = enum_options(class_type, socket)
    if not options:
        if fallback is not None:
            return fallback
        raise ComfyError(f"{class_type}.{socket} has no selectable options")
    lowered = {o.lower(): o for o in options}
    for want in prefer:
        if want.lower() in lowered:
            return lowered[want.lower()]
    for want in prefer:
        for o in options:
            if want.lower() in o.lower():
                return o
    if fallback and fallback in options:
        return fallback
    return options[0]


# ----- running a workflow ---------------------------------------------------


def upload_image(name: str, data: bytes) -> str:
    """Put an image into ComfyUI's input folder. Returns the stored name."""
    boundary = f"----h3worker{uuid.uuid4().hex}"
    parts = [
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{name}"\r\n'.encode(),
        b"Content-Type: application/octet-stream\r\n\r\n",
        data,
        f"\r\n--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="overwrite"\r\n\r\n',
        b"true\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    req = urllib.request.Request(
        f"{BASE}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise ComfyError(f"upload failed: {e.read().decode('utf-8', 'replace')[:500]}") from e
    stored = out.get("name") or name
    sub = out.get("subfolder")
    return f"{sub}/{stored}" if sub else stored


def submit(workflow: dict) -> str:
    out = _post_json("/prompt", {"prompt": workflow, "client_id": CLIENT_ID})
    errors = out.get("node_errors") or {}
    if errors:
        raise ComfyError(f"ComfyUI rejected the workflow: {json.dumps(errors)[:1500]}")
    prompt_id = out.get("prompt_id")
    if not prompt_id:
        raise ComfyError(f"ComfyUI returned no prompt_id: {json.dumps(out)[:500]}")
    return str(prompt_id)


def wait_for(prompt_id: str, timeout_s: int, on_progress=None) -> dict:
    """Poll history until the prompt finishes. Returns its outputs."""
    started = time.time()
    last_note = 0.0
    while time.time() - started < timeout_s:
        try:
            history = _get_json(f"/history/{prompt_id}", timeout=30)
        except Exception:
            history = {}
        # History stays empty while the prompt is queued or running, then
        # gains an entry whose status is either success or error.
        entry = history.get(prompt_id)
        if entry:
            status = entry.get("status") or {}
            if status.get("status_str") == "error":
                raise ComfyError(f"Render failed: {json.dumps(status.get('messages', []))[:1500]}")
            if entry.get("outputs"):
                return entry["outputs"]
            if status.get("completed"):
                return entry.get("outputs", {})
        now = time.time()
        if on_progress and now - last_note > 15:
            last_note = now
            on_progress(f"Rendering — {int(now - started)}s")
        time.sleep(2)
    raise ComfyError(f"Render did not finish within {timeout_s}s")


def find_video(outputs: dict) -> tuple[str, str, str] | None:
    """Locate the produced video in a history `outputs` blob.

    ComfyUI reports saved media under different keys depending on which save
    node ran, so this looks at all of them and takes the first video-ish file
    rather than assuming one shape.
    """
    keys = ("videos", "gifs", "video", "files", "images", "audio")
    for node_output in outputs.values():
        if not isinstance(node_output, dict):
            continue
        for key in keys:
            for item in node_output.get(key, []) or []:
                if not isinstance(item, dict):
                    continue
                filename = item.get("filename") or ""
                if not filename:
                    continue
                if key in ("images",) and not filename.lower().endswith((".mp4", ".webm", ".mkv")):
                    continue
                return (filename, item.get("subfolder", ""), item.get("type", "output"))
    return None


def fetch_output(filename: str, subfolder: str, type_: str) -> bytes:
    q = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": type_})
    return _get(f"/view?{q}", timeout=600)
